import { DWClient, EventAck, TOPIC_ROBOT } from 'dingtalk-stream-sdk-nodejs';
import type { LoggerLike } from '../shared';
import type { DingTalkConfig } from '../config/types';
import { renderReply } from './message-format';
import type { ReplyTextOptions } from './message-format';
import type {
  DingTalkReplyContext,
  DownloadImageOptions,
  DownloadedImageFile,
  IncomingImageAttachment,
  IncomingMessage,
} from './types';
import { BaseClient } from './base-client';
import { formatLogValue, toErrorMessage, toUtf8String } from '../utils';

interface DingTalkClientOptions {
  fetchImpl?: typeof fetch;
  clientFactory?: (config: DingTalkConfig) => any;
  logger?: LoggerLike;
  debug?: boolean;
}

interface DingTalkTextPayload {
  msgtype: 'text';
  text: { content: string };
}

interface DingTalkMarkdownPayload {
  msgtype: 'markdown';
  markdown: { title: string; text: string };
}

interface DingTalkRobotPayload {
  senderStaffId?: string;
  senderId?: string;
  senderNick?: string;
  conversationId?: string;
  conversationType?: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  robotCode?: string;
  msgId?: string;
  msgtype?: string;
  text?: { content?: string };
  content?: string;
}

interface DingTalkMessageContent {
  downloadCode?: string;
  pictureDownloadCode?: string;
  richText?: Array<{
    type?: string;
    downloadCode?: string;
    pictureDownloadCode?: string;
  }>;
}

interface DingTalkMessageFileResponse {
  downloadUrl?: string;
  download_url?: string;
  errmsg?: string;
  message?: string;
}

interface DingTalkAccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errmsg?: string;
}

interface DingTalkEnvelope {
  headers?: { messageId?: string; topic?: string };
  data?: string | DingTalkRobotPayload;
  type?: string;
}

function extractTextContent(payload: DingTalkRobotPayload): string {
  if (payload?.msgtype !== 'text') {
    return '';
  }
  return typeof payload.text?.content === 'string' ? payload.text.content.trim() : '';
}

function parseMessageContent(payload: DingTalkRobotPayload): DingTalkMessageContent {
  if (typeof payload?.content !== 'string' || !payload.content.trim()) {
    return {};
  }

  try {
    return JSON.parse(payload.content) as DingTalkMessageContent;
  } catch {
    return {};
  }
}

function extractImageAttachments(payload: DingTalkRobotPayload): IncomingImageAttachment[] {
  const content = parseMessageContent(payload);
  const keys: string[] = [];

  if (payload?.msgtype === 'picture') {
    const key = content.pictureDownloadCode || content.downloadCode;
    if (key) {
      keys.push(key);
    }
  }

  if (payload?.msgtype === 'richText' && Array.isArray(content.richText)) {
    for (const item of content.richText) {
      if (item?.type !== 'picture') {
        continue;
      }
      const key = item.pictureDownloadCode || item.downloadCode;
      if (key) {
        keys.push(key);
      }
    }
  }

  return [...new Set(keys)]
    .map((fileKey) => fileKey.trim())
    .filter(Boolean)
    .map((fileKey) => ({ fileKey }));
}

function normalizeMimeType(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.split(';')[0].trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function parseEnvelopeData(data: unknown): DingTalkEnvelope | null {
  if (!data) {
    return null;
  }

  const text = toUtf8String(data);
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as DingTalkEnvelope;
}

function isHeartbeatMessage(message: DingTalkEnvelope): boolean {
  const topic = message?.headers?.topic;
  return message?.type === 'SYSTEM' && (topic === 'KEEPALIVE' || topic === 'ping');
}

function truncateMarkdownTitle(text: string): string {
  const plain = String(text || '')
    .replace(/[#>*_`~\[\]()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!plain) {
    return 'im-agent-bridge';
  }

  return plain.length > 64 ? `${plain.slice(0, 61)}...` : plain;
}

function buildMarkdownPayload(text: string): DingTalkMarkdownPayload {
  const content = typeof text === 'string' && text.length > 0 ? text : ' ';
  return {
    msgtype: 'markdown',
    markdown: {
      title: truncateMarkdownTitle(content),
      text: content,
    },
  };
}

export function normalizeRobotMessage(eventEnvelope: DingTalkEnvelope): IncomingMessage | null {
  if (!eventEnvelope?.data) {
    return null;
  }

  const payload = typeof eventEnvelope.data === 'string'
    ? JSON.parse(eventEnvelope.data) as DingTalkRobotPayload
    : eventEnvelope.data;

  const userId = payload.senderStaffId || payload.senderId || '';
  if (!userId) {
    return null;
  }

  return {
    platform: 'dingtalk',
    userId,
    userName: payload.senderNick,
    conversationId: payload.conversationId,
    conversationType: payload.conversationType,
    messageId: payload.msgId || eventEnvelope.headers?.messageId,
    text: extractTextContent(payload),
    images: extractImageAttachments(payload),
    replyContext: {
      platform: 'dingtalk',
      sessionWebhook: payload.sessionWebhook || '',
      sessionWebhookExpiredTime: payload.sessionWebhookExpiredTime,
      conversationId: payload.conversationId,
      robotCode: payload.robotCode,
    },
    raw: payload,
  };
}

export class DingTalkClient extends BaseClient<DingTalkConfig> {
  private fetchImpl: typeof fetch;
  private clientFactory?: (config: DingTalkConfig) => any;
  private client: any;
  private accessToken: string | null;
  private accessTokenExpiredAt: number;

  constructor(config: DingTalkConfig, options: DingTalkClientOptions = {}) {
    super(config, options);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.clientFactory = options.clientFactory;
    this.client = null;
    this.accessToken = null;
    this.accessTokenExpiredAt = 0;
  }

  protected override logDebug(message: string, payload?: unknown): void {
    super.logDebug(message, payload, formatLogValue);
  }

  installSdkPatches(client: any): void {
    if (!client) {
      return;
    }

    if ('debug' in client) {
      client.debug = false;
    }

    if (typeof client.printDebug === 'function') {
      client.printDebug = () => {};
    }

    if (typeof client.getEndpoint === 'function') {
      const originalGetEndpoint = client.getEndpoint.bind(client);
      client.getEndpoint = async (...args: unknown[]) => {
        const originalConsoleLog = console.log;
        console.log = (...logArgs: unknown[]) => {
          if (logArgs[0] === client.config || logArgs[0] === 'res.data') {
            if (this.debug && logArgs[0] === 'res.data') {
              this.logDebug('[dingtalk] gateway endpoint', logArgs[1]);
            }
            return;
          }
          originalConsoleLog(...logArgs);
        };

        try {
          return await originalGetEndpoint(...args);
        } finally {
          console.log = originalConsoleLog;
        }
      };
    }

    if (typeof client.onDownStream === 'function') {
      client.onDownStream = (data: unknown) => {
        const decoded = toUtf8String(data);
        let message: DingTalkEnvelope | null;

        try {
          message = parseEnvelopeData(decoded);
        } catch (error) {
          this.logger.error?.('[dingtalk] invalid downstream payload:', toErrorMessage(error));
          this.logDebug('[dingtalk] invalid raw payload', decoded);
          return;
        }

        if (!message) {
          return;
        }

        if (!isHeartbeatMessage(message)) {
          this.logDebug('[dingtalk] downstream', decoded);
        }

        switch (message.type) {
          case 'SYSTEM':
            client.onSystem(message);
            break;
          case 'EVENT':
            client.onEvent(message);
            break;
          case 'CALLBACK':
            client.onCallback(message);
            break;
          default:
            this.logDebug('[dingtalk] unknown downstream type', message);
        }
      };
    }
  }

  async start(onMessage: (incomingMessage: IncomingMessage) => Promise<void> | void): Promise<void> {
    const client = this.clientFactory
      ? this.clientFactory(this.config)
      : new DWClient({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        keepAlive: true,
      });

    this.installSdkPatches(client);

    client.registerCallbackListener(TOPIC_ROBOT, async (eventEnvelope: DingTalkEnvelope) => {
      try {
        const incomingMessage = normalizeRobotMessage(eventEnvelope);
        if (incomingMessage) {
          this.logDebug('[dingtalk] callback', {
            messageId: incomingMessage.messageId,
            conversationId: incomingMessage.conversationId,
            userId: incomingMessage.userId,
            text: incomingMessage.text,
            raw: incomingMessage.raw,
          });
          await onMessage(incomingMessage);
        }
      } catch (error) {
        this.logger.error?.('[dingtalk] handle message failed:', toErrorMessage(error));
      }

      return {
        status: EventAck.SUCCESS,
      };
    });

    await client.connect();
    this.client = client;
  }

  async stop(): Promise<void> {
    if (this.client && typeof this.client.disconnect === 'function') {
      this.client.disconnect();
    }
  }

  async fetchAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiredAt - 60_000) {
      return this.accessToken;
    }

    const url = `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(this.config.clientId)}&appsecret=${encodeURIComponent(this.config.clientSecret)}`;
    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`DingTalk gettoken failed with status ${response.status}`);
    }

    const result = await response.json() as DingTalkAccessTokenResponse;
    if (!result?.access_token) {
      throw new Error(result?.errmsg || 'missing dingtalk access_token');
    }

    this.accessToken = result.access_token;
    this.accessTokenExpiredAt = Date.now() + Number(result.expires_in || 7200) * 1000;
    return this.accessToken;
  }

  async downloadImage(
    incomingMessage: IncomingMessage,
    image: IncomingImageAttachment,
    options: DownloadImageOptions,
  ): Promise<DownloadedImageFile> {
    if (!image?.fileKey) {
      throw new Error('fileKey is required for DingTalk image download');
    }

    const replyContext = incomingMessage.replyContext as DingTalkReplyContext;
    const robotCode = replyContext?.robotCode || this.config.robotCode;
    if (!robotCode) {
      throw new Error('robotCode is required for DingTalk image download');
    }

    const accessToken = await this.fetchAccessToken();
    const downloadResponse = await this.fetchImpl('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify({
        downloadCode: image.fileKey,
        robotCode,
      }),
    });

    if (!downloadResponse.ok) {
      throw new Error(`DingTalk messageFiles.download failed with status ${downloadResponse.status}`);
    }

    const downloadResult = await downloadResponse.json() as DingTalkMessageFileResponse;
    const downloadUrl = downloadResult.downloadUrl || downloadResult.download_url;
    if (!downloadUrl) {
      throw new Error(downloadResult.errmsg || downloadResult.message || 'missing DingTalk image downloadUrl');
    }

    const fileResponse = await this.fetchImpl(downloadUrl, { headers: { accept: '*/*' } });
    if (!fileResponse.ok) {
      throw new Error(`DingTalk image download failed with status ${fileResponse.status}`);
    }

    const contentLength = Number(fileResponse.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      throw new Error(`image size exceeds limit ${options.maxBytes} bytes`);
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    if (buffer.length > options.maxBytes) {
      throw new Error(`image size exceeds limit ${options.maxBytes} bytes`);
    }

    return {
      buffer,
      sizeBytes: contentLength > 0 ? contentLength : buffer.length,
      mimeType: normalizeMimeType(fileResponse.headers.get('content-type') || undefined) || image.mimeType,
      fileName: image.fileName,
    };
  }

  async replyText(replyContext: DingTalkReplyContext, text: string, options: ReplyTextOptions = {}): Promise<void> {
    if (!replyContext?.sessionWebhook) {
      throw new Error('sessionWebhook is required for DingTalk replies');
    }

    if (
      typeof replyContext.sessionWebhookExpiredTime === 'number' &&
      replyContext.sessionWebhookExpiredTime > 0 &&
      replyContext.sessionWebhookExpiredTime < Date.now()
    ) {
      throw new Error('sessionWebhook has expired');
    }

    const rendered = renderReply('dingtalk', text, options);
    const response = await this.fetchImpl(replyContext.sessionWebhook, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildMarkdownPayload(rendered.text) satisfies DingTalkMarkdownPayload),
    });

    if (!response.ok) {
      throw new Error(`DingTalk reply failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return;
    }

    const result = await response.json() as { errcode?: number; errmsg?: string };
    if (typeof result.errcode === 'number' && result.errcode !== 0) {
      throw new Error(result.errmsg || `DingTalk reply failed: ${result.errcode}`);
    }
  }
}
