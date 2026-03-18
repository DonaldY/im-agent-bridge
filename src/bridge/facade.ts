import fs from 'node:fs/promises';
import path from 'node:path';
import { streamAgentTurn } from '../agent/runner.js';
import { buildHelpText, handleBridgeCommand } from './commands.js';
import { handleBridgePrompt } from './prompt.js';
import type { RunState } from '../agent/types.js';
import type { ReplyTextOptions } from '../client/message-format.js';
import { splitMarkdownBlocks } from '../client/message-format.js';
import type { ClientLike, IncomingMessage, PlatformReplyContext, SentMessageRef } from '../client/types.js';
import type { AppConfig } from '../config/types.js';
import type { LoggerLike, PlatformKind } from '../shared/index.js';
import type { StateStore } from '../storage/index.js';
import type { SessionRecord } from '../storage/types.js';
import { formatLogValue, sleep } from '../utils.js';
import type { AgentRunContext, BridgeContext, StreamAgentTurnImpl } from './types.js';

function isSupportedConversationType(conversationType?: string): boolean {
  if (!conversationType) {
    return true;
  }

  return !['2', 'group', 'supergroup', 'channel'].includes(String(conversationType).toLowerCase());
}

function getPlatformAllowedUserIds(config: AppConfig, platform: PlatformKind): string[] {
  if (platform === 'dingtalk') {
    return config.dingtalk.allowedUserIds;
  }
  if (platform === 'feishu') {
    return config.feishu.allowedUserIds;
  }
  return config.telegram.allowedUserIds;
}

function isAllowedUser(config: AppConfig, incomingMessage: IncomingMessage): boolean {
  const candidates = [
    incomingMessage.userId,
    ...(Array.isArray(incomingMessage.userIds) ? incomingMessage.userIds : []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const allowedSet = new Set(getPlatformAllowedUserIds(config, incomingMessage.platform));
  return candidates.some((value) => allowedSet.has(value));
}

function getMessageDedupeKey(incomingMessage: IncomingMessage): string {
  return [
    incomingMessage.platform || 'unknown',
    incomingMessage.conversationId || incomingMessage.userId || 'unknown',
    incomingMessage.messageId || 'unknown',
  ].join(':');
}

export { buildHelpText } from './commands.js';

export class BridgeFacade {
  private config: AppConfig;
  private store: StateStore;
  private client: ClientLike;
  private streamAgentTurnImpl: StreamAgentTurnImpl;
  private logger: LoggerLike;
  public activeRuns: Map<string, RunState>;

  constructor(
    config: AppConfig,
    store: StateStore,
    client: ClientLike,
    options: {
      streamAgentTurnImpl?: StreamAgentTurnImpl;
      logger?: LoggerLike;
    } = {},
  ) {
    this.config = config;
    this.store = store;
    this.client = client;
    this.streamAgentTurnImpl = options.streamAgentTurnImpl || streamAgentTurn;
    this.logger = options.logger || console;
    this.activeRuns = new Map();
  }

  private createContext(): BridgeContext {
    return {
      config: this.config,
      store: this.store,
      logger: this.logger,
      activeRuns: this.activeRuns,
      streamAgentTurnImpl: this.streamAgentTurnImpl,
      getSessionWorkingDir: this.getSessionWorkingDir.bind(this),
      getRunState: this.getRunState.bind(this),
      logDebug: this.logDebug.bind(this),
      replyText: this.replyText.bind(this),
      updateText: this.updateText.bind(this),
      sendTyping: this.sendTyping.bind(this),
      resolveWorkingDir: this.resolveWorkingDir.bind(this),
      resolveAgentRunContext: this.resolveAgentRunContext.bind(this),
    };
  }

  getSessionWorkingDir(session: SessionRecord): string {
    return session.workingDir || this.config.bridge.workingDir;
  }

  isDebugEnabled(): boolean {
    return Boolean(this.config.bridge.debug);
  }

  logDebug(message: string, details: Record<string, unknown> | null = null): void {
    if (!this.isDebugEnabled()) {
      return;
    }

    const logger = typeof this.logger.info === 'function'
      ? this.logger.info.bind(this.logger)
      : this.logger.log.bind(this.logger);

    if (!details) {
      logger(message);
      return;
    }

    const parts = Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatLogValue(value)}`);

    logger(parts.length > 0 ? `${message} ${parts.join(' ')}` : message);
  }

  getRunState(sessionId?: string): RunState | null {
    return sessionId ? this.activeRuns.get(sessionId) || null : null;
  }

  async replyText(
    replyContext: PlatformReplyContext,
    text: string,
    details: Record<string, unknown> | null = null,
    options: ReplyTextOptions = {},
  ): Promise<SentMessageRef | null> {
    const chunks = splitMarkdownBlocks(text, this.config.bridge.replyChunkChars);
    const messages = chunks.length > 0 ? chunks : [''];
    let firstMessage: SentMessageRef | null = null;

    for (let index = 0; index < messages.length; index += 1) {
      this.logDebug('[bridge] reply', {
        ...(details || {}),
        chunk: index + 1,
        chunkCount: messages.length,
        mode: options.mode || 'final',
        text: messages[index],
      });
      const sent = await this.client.replyText(replyContext, messages[index], options);
      if (!firstMessage && sent) {
        firstMessage = sent;
      }
      if (index < messages.length - 1) {
        await sleep(150);
      }
    }

    return firstMessage;
  }

  async updateText(
    replyContext: PlatformReplyContext,
    message: SentMessageRef,
    text: string,
    details: Record<string, unknown> | null = null,
    options: ReplyTextOptions = {},
  ): Promise<void> {
    if (typeof this.client.updateText !== 'function') {
      await this.replyText(replyContext, text, details, options);
      return;
    }

    const chunks = splitMarkdownBlocks(text, this.config.bridge.replyChunkChars);
    const [firstChunk = ' ', ...restChunks] = chunks.length > 0 ? chunks : [' '];

    this.logDebug('[bridge] reply update', {
      ...(details || {}),
      mode: options.mode || 'final',
      chunk: 1,
      chunkCount: chunks.length || 1,
      text: firstChunk,
    });
    await this.client.updateText(replyContext, message, firstChunk, options);

    for (let index = 0; index < restChunks.length; index += 1) {
      await this.replyText(replyContext, restChunks[index], {
        ...(details || {}),
        overflow: true,
      }, options);
    }
  }

  async sendTyping(replyContext: PlatformReplyContext, details: Record<string, unknown> | null = null): Promise<void> {
    if (typeof this.client.sendTyping !== 'function') {
      return;
    }

    this.logDebug('[bridge] typing', details);
    await this.client.sendTyping(replyContext);
  }

  async handleIncomingMessage(incomingMessage: IncomingMessage): Promise<void> {
    if (!incomingMessage?.userId) {
      return;
    }

    this.logDebug('[bridge] incoming', {
      platform: incomingMessage.platform,
      messageId: incomingMessage.messageId,
      conversationId: incomingMessage.conversationId,
      conversationType: incomingMessage.conversationType,
      userId: incomingMessage.userId,
      text: incomingMessage.text,
    });

    if (!isAllowedUser(this.config, incomingMessage)) {
      await this.replyText(incomingMessage.replyContext, '你没有权限使用该机器人。', {
        messageId: incomingMessage.messageId,
      });
      return;
    }

    if (!isSupportedConversationType(incomingMessage.conversationType)) {
      return;
    }

    if (!incomingMessage.text) {
      await this.replyText(incomingMessage.replyContext, '当前仅支持文本消息。', {
        messageId: incomingMessage.messageId,
      });
      return;
    }

    const dedupeKey = getMessageDedupeKey(incomingMessage);
    if (await this.store.hasProcessedMessage(dedupeKey)) {
      this.logDebug('[bridge] skip duplicated message', { messageId: dedupeKey });
      return;
    }
    await this.store.rememberMessage(dedupeKey, this.config.bridge.dedupeTtlMs);

    const session = await this.store.ensureActiveSession(
      incomingMessage.userId,
      this.config.bridge.defaultAgent,
      this.config.bridge.workingDir,
      incomingMessage.platform,
    );

    if (incomingMessage.text.startsWith('/')) {
      await this.handleCommand(incomingMessage, session, incomingMessage.text);
      return;
    }

    await this.handlePrompt(incomingMessage, session, incomingMessage.text);
  }

  async handleCommand(incomingMessage: IncomingMessage, session: SessionRecord, text: string): Promise<void> {
    await handleBridgeCommand(this.createContext(), incomingMessage, session, text);
  }

  async resolveWorkingDir(session: SessionRecord, rawPath: string): Promise<string> {
    const baseDir = this.getSessionWorkingDir(session);
    const candidate = path.isAbsolute(rawPath) ? rawPath : path.resolve(baseDir, rawPath);
    const resolved = path.resolve(candidate);
    const stats = await fs.stat(resolved);

    if (!stats.isDirectory()) {
      throw new Error(`${resolved} is not a directory`);
    }

    return resolved;
  }

  async resolveAgentRunContext(session: SessionRecord): Promise<AgentRunContext> {
    const agent = session.activeAgent;
    const workingDir = this.getSessionWorkingDir(session);
    const providerWorkingDir = session.providerWorkingDirs?.[agent];
    let currentSession = session;
    let upstreamSessionId = currentSession.providerSessionIds?.[agent] || null;

    if (upstreamSessionId && providerWorkingDir && providerWorkingDir !== workingDir) {
      currentSession.providerSessionIds[agent] = null;
      currentSession.providerWorkingDirs[agent] = null;
      currentSession = await this.store.saveSession(currentSession);
      upstreamSessionId = null;
    }

    return { session: currentSession, agent, workingDir, upstreamSessionId };
  }

  async handlePrompt(incomingMessage: IncomingMessage, session: SessionRecord, prompt: string): Promise<void> {
    await handleBridgePrompt(this.createContext(), incomingMessage, session, prompt);
  }
}
