import type { AgentName } from '../shared';
import type { RunState } from '../agent/types';
import type { IncomingMessage } from '../client/types';
import type { AppConfig } from '../config/types';
import type { SessionRecord } from '../storage/types';
import type { BridgeContext } from './types';

export const INTERRUPT_COMMANDS = new Set(['/interrupt', '/stop', '/cancel']);

export function parseCommandText(text: string): { rawCommand: string; rawArgs: string } {
  const match = text.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/u);
  return {
    rawCommand: match?.[1] || text.trim(),
    rawArgs: match?.[2] || '',
  };
}

export function stripCommandSuffix(command: string): string {
  return command.replace(/@.+$/u, '');
}

export function unwrapQuotedArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function formatStatusText(current: SessionRecord, activeRun: RunState | null = null, workingDir: string): string {
  const activeAgent = current.activeAgent;
  const providerSessionId = activeRun?.providerSessionId || current.providerSessionIds?.[activeAgent] || 'none';
  const lines = [
    `• 会话 ID：\`${current.id}\``,
    `• 当前 Agent：\`${activeAgent}\``,
    `• Provider 会话：\`${providerSessionId}\``,
    `• 工作目录：\`${workingDir}\``,
    `• 运行状态：${activeRun && !activeRun.aborted ? '进行中' : '空闲'}`,
  ];

  if (activeRun?.messageId) {
    lines.push(`• 当前消息 ID：\`${activeRun.messageId}\``);
  }

  return ['📊 会话状态', ...lines].join('\n\n');
}

function formatCommandReply(title: string, sections: string[] = []): string {
  const normalizedSections = sections
    .map((section) => String(section || '').trim())
    .filter(Boolean);
  return [title, ...normalizedSections].join('\n\n');
}

function formatAgentOptions(agents: string[]): string {
  return agents.map((agent) => `\`${agent}\``).join('、');
}

function formatImageStatusText(config: AppConfig, session: SessionRecord): string {
  if (!config.bridge.imageEnabled) {
    return '• 图片输入：已关闭';
  }

  if (session.platform === 'telegram') {
    return '• 图片输入：当前平台 Telegram 暂不支持';
  }

  if (session.activeAgent === 'claude') {
    return '• 图片输入：当前 Agent `claude` 暂不支持，请先发送 `/use codex`';
  }

  return `• 图片输入：可用（当前 Agent：\`${session.activeAgent}\`）`;
}

export function buildHelpText(config: AppConfig): string {
  const imageSupportText = config.bridge.imageEnabled
    ? `• 当前支持飞书/钉钉单图输入（仅 \`codex\` agent；格式：image/png、image/jpeg、image/webp、image/gif；大小：${config.bridge.imageMaxMb}MB）`
    : '• 当前已关闭图片输入，仅支持文本消息';

  return [
    '📚 支持命令',
    '• `/help` 查看帮助',
    '• `/new` 新建逻辑会话',
    `• \`/use <${config.agents.enabled.join('|')}>\` 切换当前 agent`,
    '• `/set_working_dir <path>` 设置当前会话工作目录, 沙箱限制',
    '• `/status` 查看当前会话状态',
    '• `/interrupt` 中断当前处理中任务',
    'ℹ️ 说明',
    imageSupportText,
    '• 单轮最多 1 张图片，超限会直接拒绝',
    `• 当前回复模式：\`${config.bridge.replyMode}\``,
    '• 其他文本会直接转发给当前 agent',
  ].join('\n\n');
}

export async function handleBridgeCommand(
  context: BridgeContext,
  incomingMessage: IncomingMessage,
  session: SessionRecord,
  text: string,
): Promise<void> {
  const { rawCommand, rawArgs } = parseCommandText(text);
  const command = stripCommandSuffix(rawCommand).toLowerCase();
  const activeRun = context.getRunState(session.id);

  if (command === '/start' || command === '/help') {
    await context.replyText(incomingMessage.replyContext, buildHelpText(context.config), {
      messageId: incomingMessage.messageId,
      sessionId: session.id,
    });
    return;
  }

  if (INTERRUPT_COMMANDS.has(command)) {
    if (!activeRun) {
      await context.replyText(
        incomingMessage.replyContext,
        formatCommandReply('ℹ️ 当前没有正在处理的任务。', [
          formatStatusText(session, activeRun, context.getSessionWorkingDir(session)),
        ]),
        {
          messageId: incomingMessage.messageId,
          sessionId: session.id,
          providerSessionId: session.providerSessionIds?.[session.activeAgent] || 'none',
        },
      );
      return;
    }

    activeRun.aborted = true;
    activeRun.abortController.abort();
    context.logDebug('[bridge] interrupted run', {
      messageId: activeRun.messageId,
      sessionId: session.id,
      agent: activeRun.agent,
      providerSessionId: activeRun.providerSessionId,
    });
    await context.replyText(
      incomingMessage.replyContext,
      formatCommandReply('🛑 已中断当前会话任务。', [
        formatStatusText(session, activeRun, context.getSessionWorkingDir(session)),
      ]),
      {
        messageId: incomingMessage.messageId,
        sessionId: session.id,
        providerSessionId: activeRun.providerSessionId || 'starting',
      },
    );
    return;
  }

  if (command === '/new') {
    if (activeRun) {
      await context.replyText(incomingMessage.replyContext, formatCommandReply('⏳ 当前会话正在处理中。', [
        '请先发送 `/interrupt` 中断当前任务，再执行该命令。',
        formatStatusText(session, activeRun, context.getSessionWorkingDir(session)),
      ]), {
        messageId: incomingMessage.messageId,
        sessionId: session.id,
        providerSessionId: activeRun.providerSessionId || 'starting',
      });
      return;
    }

    const nextSession = await context.store.replaceActiveSession(
      incomingMessage.userId,
      session.activeAgent,
      context.getSessionWorkingDir(session),
      incomingMessage.platform,
    );
    await context.replyText(
      incomingMessage.replyContext,
      formatCommandReply('✅ 已创建新会话。', [
        formatStatusText(nextSession, null, context.getSessionWorkingDir(nextSession)),
      ]),
      {
        messageId: incomingMessage.messageId,
        sessionId: nextSession.id,
      },
    );
    return;
  }

  if (command === '/use') {
    if (activeRun) {
      await context.replyText(incomingMessage.replyContext, formatCommandReply('⏳ 当前会话正在处理中。', [
        '请先发送 `/interrupt` 中断当前任务，再执行该命令。',
        formatStatusText(session, activeRun, context.getSessionWorkingDir(session)),
      ]), {
        messageId: incomingMessage.messageId,
        sessionId: session.id,
        providerSessionId: activeRun.providerSessionId || 'starting',
      });
      return;
    }

    const targetAgent = rawArgs.trim() as AgentName;
    if (!targetAgent) {
      await context.replyText(incomingMessage.replyContext, formatCommandReply('⚠️ 请指定要切换的 agent。', [
        `可选：${formatAgentOptions(context.config.agents.enabled)}`,
        '示例：`/use codex`',
      ]), {
        messageId: incomingMessage.messageId,
        sessionId: session.id,
      });
      return;
    }
    if (!context.config.agents.enabled.includes(targetAgent)) {
      await context.replyText(incomingMessage.replyContext, formatCommandReply(`❌ 不支持的 agent：\`${targetAgent}\``, [
        `可选：${formatAgentOptions(context.config.agents.enabled)}`,
      ]), {
        messageId: incomingMessage.messageId,
        sessionId: session.id,
      });
      return;
    }
    const updated = await context.store.setActiveAgent(incomingMessage.userId, targetAgent);
    await context.replyText(incomingMessage.replyContext, formatCommandReply('✅ 已切换当前 Agent。', [
      `• 当前 Agent：\`${updated.activeAgent}\``,
      `• 会话 ID：\`${updated.id}\``,
    ]), {
      messageId: incomingMessage.messageId,
      sessionId: updated.id,
    });
    return;
  }

  if (command === '/status') {
    const current = context.store.getActiveSession(incomingMessage.userId) || session;
    const currentRun = context.getRunState(current.id);
    const statusText = formatStatusText(current, currentRun, context.getSessionWorkingDir(current));
    const imageStatusText = formatImageStatusText(context.config, current);
    await context.replyText(
      incomingMessage.replyContext,
      `${statusText}\n\n${imageStatusText}`,
      {
        messageId: incomingMessage.messageId,
        sessionId: current.id,
        providerSessionId: currentRun?.providerSessionId || current.providerSessionIds?.[current.activeAgent] || 'none',
      },
    );
    return;
  }

  if (command === '/set_working_dir') {
    if (activeRun) {
      await context.replyText(incomingMessage.replyContext, formatCommandReply('⏳ 当前会话正在处理中。', [
        '请先发送 `/interrupt` 中断当前任务，再执行该命令。',
        formatStatusText(session, activeRun, context.getSessionWorkingDir(session)),
      ]), {
        messageId: incomingMessage.messageId,
        sessionId: session.id,
        providerSessionId: activeRun.providerSessionId || 'starting',
      });
      return;
    }

    const nextPath = unwrapQuotedArg(rawArgs);
    if (!nextPath) {
      await context.replyText(incomingMessage.replyContext, formatCommandReply('⚠️ 请提供工作目录路径。', [
        '示例：`/set_working_dir ~/workspace/project-a`',
        '路径含空格时：`/set_working_dir "../repo with spaces"`',
      ]), {
        messageId: incomingMessage.messageId,
        sessionId: session.id,
      });
      return;
    }

    const resolvedWorkingDir = await context.resolveWorkingDir(session, nextPath);
    const updated = await context.store.setWorkingDir(incomingMessage.userId, session.activeAgent, resolvedWorkingDir);
    const providerSessionId = updated.providerSessionIds?.[updated.activeAgent] || 'reset';
    await context.replyText(
      incomingMessage.replyContext,
      formatCommandReply('✅ 已更新工作目录。', [
        formatStatusText(updated, null, context.getSessionWorkingDir(updated)),
        `• 当前 ${updated.activeAgent} 会话：\`${providerSessionId}\``,
      ]),
      {
        messageId: incomingMessage.messageId,
        sessionId: updated.id,
        providerSessionId,
      },
    );
    return;
  }

  await context.replyText(incomingMessage.replyContext, formatCommandReply(`❓ 未知命令：\`${rawCommand}\``, [
    '请参考以下帮助：',
    buildHelpText(context.config),
  ]), {
    messageId: incomingMessage.messageId,
    sessionId: session.id,
  });
}
