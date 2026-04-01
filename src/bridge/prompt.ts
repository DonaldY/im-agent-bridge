import fs from 'node:fs/promises';
import { takeStableMarkdownStream } from '../client/message-format.js';
import type { RunState } from '../agent/types.js';
import type { OutgoingAttachment, SentMessageRef } from '../client/types.js';
import { toErrorMessage } from '../utils.js';
import type { IncomingMessage } from '../client/types.js';
import type { SessionRecord } from '../storage/types.js';
import type { BridgeContext } from './types.js';
import { buildOutgoingArtifactsPrompt, loadOutgoingAttachments } from './artifacts.js';

const ACK_TEXT = '🤖 已收到，正在思考中…';
const STREAM_UPDATE_INTERVAL_MS = 900;
const STREAM_MIN_LENGTH = 160;
const ERROR_SUMMARY_MAX_CHARS = 200;

function supportsEditableReply(incomingMessage: IncomingMessage): boolean {
  return incomingMessage.platform === 'telegram' || incomingMessage.platform === 'feishu';
}

function summarizeErrorMessage(message: string): string {
  const firstLine = message
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return '未知错误';
  }

  const normalized = firstLine.replace(/^[A-Za-z]*Error:\s*/u, '');

  if (normalized.length <= ERROR_SUMMARY_MAX_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, ERROR_SUMMARY_MAX_CHARS - 3)}...`;
}

function buildFailureReply(message: string): string {
  return `处理失败：${summarizeErrorMessage(message)}`;
}

function buildFailureNotice(agent: string, message: string): string {
  return `本次 ${agent} 调用异常，以上内容可能不完整。\n原因：${summarizeErrorMessage(message)}`;
}

function buildAttachmentFailureNotice(message: string): string {
  return `附件回传失败：${summarizeErrorMessage(message)}`;
}

async function sendOutgoingAttachments(
  context: BridgeContext,
  incomingMessage: IncomingMessage,
  attachments: OutgoingAttachment[],
  details: {
    messageId?: string;
    sessionId: string;
    agent: string;
    providerSessionId?: string | null;
  },
): Promise<string[]> {
  const errors: string[] = [];

  for (const attachment of attachments) {
    try {
      if (attachment.kind === 'image') {
        await context.sendImage(incomingMessage.replyContext, attachment, {
          ...details,
          phase: 'attachment',
        });
      } else {
        await context.sendFile(incomingMessage.replyContext, attachment, {
          ...details,
          phase: 'attachment',
        });
      }
    } catch (error) {
      errors.push(`${attachment.fileName}: ${toErrorMessage(error)}`);
    }
  }

  return errors;
}

export async function handleBridgePrompt(
  context: BridgeContext,
  incomingMessage: IncomingMessage,
  session: SessionRecord,
  prompt: string,
): Promise<void> {
  const startedAt = Date.now();
  const runContext = await context.resolveAgentRunContext(session, incomingMessage.messageId);
  const { agent } = runContext;
  let currentSession = runContext.session;
  let finalText = '';
  let partialText = '';
  let pendingStreamText = '';
  let streamedOutput = false;
  let replyMessage: SentMessageRef | null = null;
  let lastStreamUpdateAt = 0;
  const errors: string[] = [];
  const attachmentErrors: string[] = [];
  let outgoingAttachments: OutgoingAttachment[] = [];
  const existingRun = context.getRunState(currentSession.id);
  const streamReplies = context.config.bridge.replyMode === 'stream';
  const canEditReply = supportsEditableReply(incomingMessage);
  const canSendAttachments = context.supportsOutgoingAttachments(incomingMessage.replyContext.platform);
  const agentPrompt = canSendAttachments
    ? `${prompt}\n\n${buildOutgoingArtifactsPrompt(runContext.turnOutputDir, runContext.manifestPath)}`
    : prompt;

  if (existingRun) {
    await context.replyText(
      incomingMessage.replyContext,
      '当前会话正在处理中，请等待任务完成，或发送 `/interrupt` 中断当前任务。',
      {
        messageId: incomingMessage.messageId,
        sessionId: currentSession.id,
        providerSessionId: existingRun.providerSessionId || runContext.upstreamSessionId || 'starting',
      },
    );
    return;
  }

  const activeRun: RunState = {
    sessionId: currentSession.id,
    agent,
    messageId: incomingMessage.messageId,
    providerSessionId: runContext.upstreamSessionId,
    abortController: new AbortController(),
    aborted: false,
  };
  context.activeRuns.set(currentSession.id, activeRun);

  await context.store.appendConversationLog(currentSession.id, {
    direction: 'in',
    platform: incomingMessage.platform,
    agent,
    messageId: incomingMessage.messageId,
    conversationId: incomingMessage.conversationId,
    providerSessionId: runContext.upstreamSessionId,
    text: prompt,
  });

  context.logDebug('[bridge] prompt -> model', {
    messageId: incomingMessage.messageId,
    sessionId: currentSession.id,
    agent,
    providerSessionId: runContext.upstreamSessionId || 'new',
    workingDir: runContext.workingDir,
    prompt,
  });

  try {
    try {
      await context.sendTyping(incomingMessage.replyContext, {
        messageId: incomingMessage.messageId,
        sessionId: currentSession.id,
        agent,
      });
    } catch (error) {
      context.logDebug('[bridge] typing failed', {
        messageId: incomingMessage.messageId,
        sessionId: currentSession.id,
        error: toErrorMessage(error),
      });
    }

    if (canSendAttachments) {
      await fs.mkdir(runContext.turnOutputDir, { recursive: true });
    }

    replyMessage = await context.replyText(
      incomingMessage.replyContext,
      ACK_TEXT,
      {
        messageId: incomingMessage.messageId,
        sessionId: currentSession.id,
        agent,
        providerSessionId: activeRun.providerSessionId || 'starting',
        phase: 'ack',
      },
      { mode: 'ack' },
    );

    for await (const event of context.streamAgentTurnImpl({
      config: context.config,
      agent: runContext.agent,
      prompt: agentPrompt,
      workingDir: runContext.workingDir,
      upstreamSessionId: runContext.upstreamSessionId,
      abortSignal: activeRun.abortController.signal,
    })) {
      if (event.type === 'session_started' && event.sessionId) {
        activeRun.providerSessionId = event.sessionId;
        currentSession.providerSessionIds[runContext.agent] = event.sessionId;
        currentSession.providerWorkingDirs[runContext.agent] = runContext.workingDir;
        currentSession = await context.store.saveSession(currentSession);
        context.logDebug('[bridge] model session started', {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: event.sessionId,
        });
      }

      if (event.type === 'partial_text' && event.text) {
        partialText = `${partialText}${event.text}`;
        pendingStreamText = `${pendingStreamText}${event.text}`;
        context.logDebug('[bridge] model partial', {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          text: event.text,
        });

        if (!streamReplies) {
          continue;
        }

        const now = Date.now();
        if (now - lastStreamUpdateAt < STREAM_UPDATE_INTERVAL_MS) {
          continue;
        }

        if (replyMessage && canEditReply) {
          await context.updateText(
            incomingMessage.replyContext,
            replyMessage,
            partialText,
            {
              messageId: incomingMessage.messageId,
              sessionId: currentSession.id,
              agent,
              providerSessionId: activeRun.providerSessionId || 'starting',
              phase: 'progress',
            },
            { mode: 'progress' },
          );
          lastStreamUpdateAt = now;
          continue;
        }

        const { stable, rest } = takeStableMarkdownStream(pendingStreamText, STREAM_MIN_LENGTH);
        if (!stable) {
          continue;
        }

        await context.replyText(
          incomingMessage.replyContext,
          stable,
          {
            messageId: incomingMessage.messageId,
            sessionId: currentSession.id,
            agent,
            providerSessionId: activeRun.providerSessionId || 'starting',
            phase: 'progress',
          },
          { mode: 'final' },
        );
        pendingStreamText = rest;
        streamedOutput = true;
        lastStreamUpdateAt = now;
      }

      if (event.type === 'final_text' && event.text) {
        finalText = event.text;
        context.logDebug('[bridge] model final', {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          text: event.text,
        });
      }

      if (event.type === 'error' && event.message) {
        errors.push(event.message);
        context.logDebug('[bridge] model error', {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          error: event.message,
        });
      }
    }

    if (activeRun.aborted) {
      await context.store.appendConversationLog(currentSession.id, {
        direction: 'out',
        platform: incomingMessage.platform,
        agent,
        providerSessionId: activeRun.providerSessionId,
        status: 'aborted',
        partialText,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    if (canSendAttachments) {
      const outgoing = await loadOutgoingAttachments(runContext.turnOutputDir, runContext.manifestPath);
      outgoingAttachments = outgoing.attachments;
      attachmentErrors.push(...outgoing.errors);
    }

    const reply = finalText
      || partialText
      || (outgoingAttachments.length > 0 ? `已生成并回传 ${outgoingAttachments.length} 个附件。` : '')
      || (errors[0] ? buildFailureReply(errors[0]) : '未获得可用回复。');
    const failureNotice = errors[0] && (finalText || partialText)
      ? buildFailureNotice(agent, errors[0])
      : null;

    if (replyMessage && canEditReply) {
      await context.updateText(
        incomingMessage.replyContext,
        replyMessage,
        reply,
        {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          phase: 'final',
        },
        { mode: 'final' },
      );
      if (failureNotice) {
        await context.replyText(
          incomingMessage.replyContext,
          failureNotice,
          {
            messageId: incomingMessage.messageId,
            sessionId: currentSession.id,
            agent,
            providerSessionId: activeRun.providerSessionId || 'starting',
            phase: 'error',
          },
          { mode: 'final' },
        );
      }
    } else if (streamReplies) {
      const tail = finalText && partialText && finalText !== partialText
        ? finalText
        : pendingStreamText || (!streamedOutput ? reply : '');

      if (tail) {
        await context.replyText(
          incomingMessage.replyContext,
          tail,
          {
            messageId: incomingMessage.messageId,
            sessionId: currentSession.id,
            agent,
            providerSessionId: activeRun.providerSessionId || 'starting',
            phase: 'final',
          },
          { mode: 'final' },
        );
      }
      if (failureNotice) {
        await context.replyText(
          incomingMessage.replyContext,
          failureNotice,
          {
            messageId: incomingMessage.messageId,
            sessionId: currentSession.id,
            agent,
            providerSessionId: activeRun.providerSessionId || 'starting',
            phase: 'error',
          },
          { mode: 'final' },
        );
      }
    } else {
      await context.replyText(
        incomingMessage.replyContext,
        reply,
        {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          phase: 'final',
        },
        { mode: 'final' },
      );
      if (failureNotice) {
        await context.replyText(
          incomingMessage.replyContext,
          failureNotice,
          {
            messageId: incomingMessage.messageId,
            sessionId: currentSession.id,
            agent,
            providerSessionId: activeRun.providerSessionId || 'starting',
            phase: 'error',
          },
          { mode: 'final' },
        );
      }
    }

    attachmentErrors.push(...await sendOutgoingAttachments(context, incomingMessage, outgoingAttachments, {
      messageId: incomingMessage.messageId,
      sessionId: currentSession.id,
      agent,
      providerSessionId: activeRun.providerSessionId || 'starting',
    }));

    for (const message of attachmentErrors) {
      await context.replyText(
        incomingMessage.replyContext,
        buildAttachmentFailureNotice(message),
        {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          phase: 'attachment_error',
        },
        { mode: 'final' },
      );
    }

    await context.store.appendConversationLog(currentSession.id, {
      direction: 'out',
      platform: incomingMessage.platform,
      agent,
      providerSessionId: activeRun.providerSessionId,
      finalText: reply,
      errors: [...errors, ...attachmentErrors],
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (activeRun.aborted) {
      await context.store.appendConversationLog(currentSession.id, {
        direction: 'out',
        platform: incomingMessage.platform,
        agent,
        providerSessionId: activeRun.providerSessionId,
        status: 'aborted',
        errors,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const rawErrorMessage = toErrorMessage(error);
    const message = buildFailureReply(rawErrorMessage);
    await context.store.appendConversationLog(currentSession.id, {
      direction: 'out',
      platform: incomingMessage.platform,
      agent,
      providerSessionId: activeRun.providerSessionId,
      errors: [rawErrorMessage],
      durationMs: Date.now() - startedAt,
    });

    if (replyMessage && canEditReply) {
      await context.updateText(
        incomingMessage.replyContext,
        replyMessage,
        message,
        {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          phase: 'error',
        },
        { mode: 'final' },
      );
    } else {
      await context.replyText(
        incomingMessage.replyContext,
        message,
        {
          messageId: incomingMessage.messageId,
          sessionId: currentSession.id,
          agent,
          providerSessionId: activeRun.providerSessionId || 'starting',
          phase: 'error',
        },
        { mode: 'final' },
      );
    }
    context.logger.error?.('[bridge] handle prompt failed:', message);
  } finally {
    if (context.activeRuns.get(currentSession.id) === activeRun) {
      context.activeRuns.delete(currentSession.id);
    }
  }
}
