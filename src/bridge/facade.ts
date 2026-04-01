import fs from 'node:fs/promises';
import path from 'node:path';
import { streamAgentTurn } from '../agent/runner.js';
import { buildHelpText, handleBridgeCommand } from './commands.js';
import { handleBridgePrompt } from './prompt.js';
import type { RunState } from '../agent/types.js';
import type { ReplyTextOptions } from '../client/message-format.js';
import { splitMarkdownBlocks } from '../client/message-format.js';
import type {
  ClientLike,
  IncomingImageAttachment,
  IncomingMessage,
  OutgoingAttachment,
  OutgoingAttachmentKind,
  PlatformReplyContext,
  SentMessageRef,
} from '../client/types.js';
import type { AppConfig } from '../config/types.js';
import type { LoggerLike, PlatformKind } from '../shared/index.js';
import type { StateStore } from '../storage/index.js';
import type { SessionRecord } from '../storage/types.js';
import { formatLogValue, sleep, toErrorMessage } from '../utils.js';
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
  const allowedUserIds = getPlatformAllowedUserIds(config, incomingMessage.platform);
  if (allowedUserIds.length === 0) {
    return true;
  }

  const candidates = [
    incomingMessage.userId,
    ...(Array.isArray(incomingMessage.userIds) ? incomingMessage.userIds : []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const allowedSet = new Set(allowedUserIds);
  return candidates.some((value) => allowedSet.has(value));
}

function getMessageDedupeKey(incomingMessage: IncomingMessage): string {
  return [
    incomingMessage.platform || 'unknown',
    incomingMessage.conversationId || incomingMessage.userId || 'unknown',
    incomingMessage.messageId || 'unknown',
  ].join(':');
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function normalizeImageMimeType(mimeType?: string): string | null {
  if (typeof mimeType !== 'string') {
    return null;
  }

  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function toImageExtension(mimeType: string): string {
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  if (mimeType === 'image/gif') {
    return 'gif';
  }
  return 'jpg';
}

function toSafePathSegment(value: string): string {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/gu, '_');
  return normalized || 'turn';
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
      getSupportedOutgoingAttachmentKinds: this.getSupportedOutgoingAttachmentKinds.bind(this),
      sendImage: this.sendImage.bind(this),
      sendFile: this.sendFile.bind(this),
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

  getSupportedOutgoingAttachmentKinds(platform: PlatformReplyContext['platform']): OutgoingAttachmentKind[] {
    if (platform === 'feishu') {
      const kinds: OutgoingAttachmentKind[] = [];
      if (typeof this.client.sendImage === 'function') {
        kinds.push('image');
      }
      if (typeof this.client.sendFile === 'function') {
        kinds.push('file');
      }
      return kinds;
    }

    if (platform === 'dingtalk' && typeof this.client.sendImage === 'function') {
      return ['image'];
    }

    return [];
  }

  async sendImage(
    replyContext: PlatformReplyContext,
    attachment: OutgoingAttachment,
    details: Record<string, unknown> | null = null,
  ): Promise<SentMessageRef | null> {
    if (typeof this.client.sendImage !== 'function') {
      throw new Error(`platform ${replyContext.platform} does not support image attachments`);
    }

    this.logDebug('[bridge] send image', {
      ...(details || {}),
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
      mimeType: attachment.mimeType,
      filePath: attachment.filePath,
    });
    const sent = await this.client.sendImage(replyContext, attachment);
    return sent || null;
  }

  async sendFile(
    replyContext: PlatformReplyContext,
    attachment: OutgoingAttachment,
    details: Record<string, unknown> | null = null,
  ): Promise<SentMessageRef | null> {
    if (typeof this.client.sendFile !== 'function') {
      throw new Error(`platform ${replyContext.platform} does not support file attachments`);
    }

    this.logDebug('[bridge] send file', {
      ...(details || {}),
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
      mimeType: attachment.mimeType,
      filePath: attachment.filePath,
    });
    const sent = await this.client.sendFile(replyContext, attachment);
    return sent || null;
  }

  getImageMaxBytes(): number {
    return Math.floor(this.config.bridge.imageMaxMb * 1024 * 1024);
  }

  async rejectImageInput(incomingMessage: IncomingMessage, text: string): Promise<void> {
    await this.replyText(incomingMessage.replyContext, text, {
      messageId: incomingMessage.messageId,
    });
  }

  async validateImageAttachment(
    incomingMessage: IncomingMessage,
    image: IncomingImageAttachment,
    maxBytes: number,
  ): Promise<string | null> {
    if (!this.config.bridge.imageEnabled) {
      await this.rejectImageInput(incomingMessage, '当前未开启图片输入能力。');
      return null;
    }

    const mimeType = normalizeImageMimeType(image.mimeType || undefined);
    if (mimeType && !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      await this.rejectImageInput(
        incomingMessage,
        '图片格式不支持，仅允许 image/png、image/jpeg、image/webp、image/gif。',
      );
      return null;
    }

    if (typeof image.sizeBytes === 'number' && image.sizeBytes > maxBytes) {
      await this.rejectImageInput(incomingMessage, `图片大小超过限制（${this.config.bridge.imageMaxMb}MB）。`);
      return null;
    }

    return mimeType;
  }

  async buildImagePrompt(incomingMessage: IncomingMessage, session: SessionRecord, text: string): Promise<string | null> {
    const images = Array.isArray(incomingMessage.images) ? incomingMessage.images : [];
    if (images.length === 0) {
      return text;
    }

    if (!this.config.bridge.imageEnabled) {
      await this.rejectImageInput(incomingMessage, '当前未开启图片输入能力。');
      return null;
    }

    if (session.activeAgent === 'claude') {
      await this.rejectImageInput(incomingMessage, '当前 Agent `claude` 暂不支持图片输入，请先发送 `/use codex` 后再重试。');
      return null;
    }

    if (images.length > 1) {
      await this.rejectImageInput(incomingMessage, '单轮仅支持 1 张图片，请重新发送。');
      return null;
    }

    if (typeof this.client.downloadImage !== 'function') {
      await this.rejectImageInput(incomingMessage, '当前平台暂不支持图片输入。');
      return null;
    }

    const image = images[0];
    const maxBytes = this.getImageMaxBytes();
    const hintedMime = await this.validateImageAttachment(incomingMessage, image, maxBytes);
    if (!hintedMime && image.mimeType) {
      return null;
    }

    let downloaded;
    try {
      downloaded = await this.client.downloadImage(incomingMessage, image, { maxBytes });
    } catch (error) {
      await this.rejectImageInput(incomingMessage, `图片下载失败：${toErrorMessage(error)}`);
      return null;
    }

    const actualMime = normalizeImageMimeType(downloaded?.mimeType || hintedMime || undefined);
    if (!actualMime || !SUPPORTED_IMAGE_MIME_TYPES.has(actualMime)) {
      await this.rejectImageInput(
        incomingMessage,
        '图片格式不支持，仅允许 image/png、image/jpeg、image/webp、image/gif。',
      );
      return null;
    }

    const actualSize = downloaded?.sizeBytes || downloaded?.buffer?.length || 0;
    if (actualSize > maxBytes) {
      await this.rejectImageInput(incomingMessage, `图片大小超过限制（${this.config.bridge.imageMaxMb}MB）。`);
      return null;
    }

    let filePath: string;
    try {
      const imageDir = path.join(this.getSessionWorkingDir(session), '.im-agent-bridge', 'images', session.id);
      await fs.mkdir(imageDir, { recursive: true });

      const baseName = incomingMessage.messageId || `img-${Date.now()}`;
      const ext = toImageExtension(actualMime);
      filePath = path.join(imageDir, `${baseName}-${Date.now()}.${ext}`);
      await fs.writeFile(filePath, downloaded.buffer);
    } catch (error) {
      await this.rejectImageInput(incomingMessage, `图片保存失败：${toErrorMessage(error)}`);
      return null;
    }

    const lines = [
      `Analyze this image: ${filePath}`,
      '你将收到一张用户上传的图片，请先读取并理解图片内容，再回答用户问题。',
      `图片文件路径：${filePath}`,
      `图片类型：${actualMime}`,
      `图片大小：${actualSize} bytes`,
    ];

    if (text) {
      lines.push(`用户文本：${text}`);
    } else {
      lines.push('用户没有附加文本，请先描述图片，再给出关键信息。');
    }

    return lines.join('\n\n');
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
      imageCount: incomingMessage.images?.length || 0,
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

    const inputText = String(incomingMessage.text || '').trim();
    const imageCount = incomingMessage.images?.length || 0;

    if (!inputText && imageCount === 0) {
      await this.replyText(incomingMessage.replyContext, '当前仅支持文本和图片消息。', {
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

    if (imageCount === 0 && inputText.startsWith('/')) {
      await this.handleCommand(incomingMessage, session, inputText);
      return;
    }

    const prompt = await this.buildImagePrompt(incomingMessage, session, inputText);
    if (!prompt) {
      return;
    }

    await this.handlePrompt(incomingMessage, session, prompt);
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

  async resolveAgentRunContext(session: SessionRecord, messageId?: string): Promise<AgentRunContext> {
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

    const turnOutputDir = path.join(
      workingDir,
      '.im-agent-bridge',
      'outgoing',
      currentSession.id,
      toSafePathSegment(messageId || `turn-${Date.now()}`),
    );

    return {
      session: currentSession,
      agent,
      workingDir,
      upstreamSessionId,
      turnOutputDir,
      manifestPath: path.join(turnOutputDir, 'manifest.json'),
    };
  }

  async handlePrompt(incomingMessage: IncomingMessage, session: SessionRecord, prompt: string): Promise<void> {
    await handleBridgePrompt(this.createContext(), incomingMessage, session, prompt);
  }
}
