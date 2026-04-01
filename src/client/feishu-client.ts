import * as Lark from '@larksuiteoapi/node-sdk';
import { Readable } from 'node:stream';
import type { LoggerLike } from '../shared/index.js';
import type { FeishuConfig } from '../config/types.js';
import { renderReply } from './message-format.js';
import type { ReplyTextOptions } from './message-format.js';
import type {
  DownloadImageOptions,
  DownloadedImageFile,
  FeishuReplyContext,
  IncomingImageAttachment,
  IncomingMessage,
  OutgoingAttachment,
  SentMessageRef,
} from './types.js';
import { BaseClient } from './base-client.js';
import { toErrorMessage } from '../utils.js';

interface FeishuClientOptions {
  sdk?: typeof Lark;
  apiClient?: any;
  wsClient?: any;
  fetchImpl?: typeof fetch;
  logger?: LoggerLike;
  debug?: boolean;
}

interface FeishuSenderId {
  user_id?: string;
  open_id?: string;
  union_id?: string;
}

interface FeishuMessageEvent {
  sender?: {
    sender_id?: FeishuSenderId;
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    thread_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
}

interface FeishuMessageContent {
  text?: string;
  image_key?: string;
}

interface FeishuTenantTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuUploadImageResponse {
  code?: number;
  msg?: string;
  data?: {
    image_key?: string;
  };
}

interface FeishuUploadFileResponse {
  code?: number;
  msg?: string;
  data?: {
    file_key?: string;
  };
}

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

function extractTextContent(event: FeishuMessageEvent): string {
  if (event?.message?.message_type !== 'text') {
    return '';
  }

  try {
    const content = JSON.parse(event.message.content || '{}') as { text?: string };
    return typeof content.text === 'string' ? content.text.trim() : '';
  } catch {
    return '';
  }
}

function parseMessageContent(event: FeishuMessageEvent): FeishuMessageContent {
  try {
    return JSON.parse(event?.message?.content || '{}') as FeishuMessageContent;
  } catch {
    return {};
  }
}

function extractImageAttachments(event: FeishuMessageEvent): IncomingImageAttachment[] {
  if (event?.message?.message_type !== 'image') {
    return [];
  }

  const content = parseMessageContent(event);
  if (!content.image_key) {
    return [];
  }

  return [{ fileKey: content.image_key.trim() }];
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

function readHeaderValue(headers: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  const target = key.toLowerCase();
  for (const [header, value] of Object.entries(headers)) {
    if (header.toLowerCase() !== target) {
      continue;
    }
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  }

  return undefined;
}

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error(`image size exceeds limit ${maxBytes} bytes`);
    }
    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks, total);
}

function buildTextPayload(text: string): { msg_type: 'text'; content: string } {
  const normalized = typeof text === 'string' && text.trim()
    ? text.replace(/\r\n/gu, '\n')
    : ' ';

  return {
    msg_type: 'text',
    content: JSON.stringify({
      text: normalized,
    }),
  };
}

function buildMessagePayload<TMessageType extends 'text' | 'image' | 'file'>(
  msgType: TMessageType,
  content: Record<string, string>,
): { msg_type: TMessageType; content: string } {
  return {
    msg_type: msgType,
    content: JSON.stringify(content),
  };
}

function inferFeishuFileType(attachment: OutgoingAttachment): string {
  const fileName = attachment.fileName.toLowerCase();
  if (fileName.endsWith('.opus')) {
    return 'opus';
  }
  if (fileName.endsWith('.mp4')) {
    return 'mp4';
  }
  if (fileName.endsWith('.pdf')) {
    return 'pdf';
  }
  if (fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return 'doc';
  }
  if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
    return 'xls';
  }
  if (fileName.endsWith('.ppt') || fileName.endsWith('.pptx')) {
    return 'ppt';
  }
  return 'stream';
}

function extractMessageId(result: any): string | null {
  return result?.data?.message_id || result?.message_id || result?.data?.data?.message_id || null;
}

export function normalizeFeishuMessage(event: FeishuMessageEvent): IncomingMessage | null {
  if (!event?.message?.message_id || !event?.sender?.sender_id) {
    return null;
  }

  const senderIds = event.sender.sender_id;
  const userIds = [senderIds.user_id, senderIds.open_id, senderIds.union_id]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  const userId = userIds[0] || '';

  if (!userId) {
    return null;
  }

  return {
    platform: 'feishu',
    userId,
    userIds,
    conversationId: event.message.chat_id,
    conversationType: event.message.chat_type,
    messageId: event.message.message_id,
    text: extractTextContent(event),
    images: extractImageAttachments(event),
    replyContext: {
      platform: 'feishu',
      chatId: event.message.chat_id,
      messageId: event.message.message_id,
      threadId: event.message.thread_id,
    },
    raw: event,
  };
}

export class FeishuClient extends BaseClient<FeishuConfig> {
  private sdk: typeof Lark;
  private apiClient: any;
  private wsClient: any;
  private fetchImpl: typeof fetch;
  private tenantAccessToken: string | null;
  private tenantAccessTokenExpiredAt: number;

  constructor(config: FeishuConfig, options: FeishuClientOptions = {}) {
    super(config, options);
    this.sdk = options.sdk || Lark;
    this.apiClient = options.apiClient || new this.sdk.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    });
    this.wsClient = options.wsClient || new this.sdk.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: this.sdk.LoggerLevel?.error,
    });
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.tenantAccessToken = null;
    this.tenantAccessTokenExpiredAt = 0;
  }

  async start(onMessage: (incomingMessage: IncomingMessage) => Promise<void> | void): Promise<void> {
    const eventDispatcher = new this.sdk.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: FeishuMessageEvent) => {
        try {
          const incomingMessage = normalizeFeishuMessage(data);
          if (incomingMessage) {
            this.logDebug('[feishu] event', incomingMessage.raw);
            await onMessage(incomingMessage);
          }
        } catch (error) {
          this.logger.error?.('[feishu] handle message failed:', toErrorMessage(error));
        }
      },
    });

    await this.wsClient.start({ eventDispatcher });
  }

  async stop(): Promise<void> {
    if (this.wsClient && typeof this.wsClient.close === 'function') {
      this.wsClient.close({ force: true });
    }
  }

  private async fetchTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tenantAccessTokenExpiredAt - 60_000) {
      return this.tenantAccessToken;
    }

    const response = await this.fetchImpl(`${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Feishu auth failed with status ${response.status}`);
    }

    const result = await response.json() as FeishuTenantTokenResponse;
    if (result.code && result.code !== 0) {
      throw new Error(result.msg || `Feishu auth failed: ${result.code}`);
    }
    if (!result.tenant_access_token) {
      throw new Error('missing Feishu tenant_access_token');
    }

    this.tenantAccessToken = result.tenant_access_token;
    this.tenantAccessTokenExpiredAt = Date.now() + Number(result.expire || 7200) * 1000;
    return this.tenantAccessToken;
  }

  private async uploadImage(attachment: OutgoingAttachment): Promise<string> {
    const accessToken = await this.fetchTenantAccessToken();
    const form = new FormData();
    form.append('image_type', 'message');
    form.append(
      'image',
      new Blob([new Uint8Array(attachment.buffer)], { type: attachment.mimeType || 'application/octet-stream' }),
      attachment.fileName,
    );

    const response = await this.fetchImpl(`${FEISHU_BASE_URL}/im/v1/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Feishu image upload failed with status ${response.status}`);
    }

    const result = await response.json() as FeishuUploadImageResponse;
    if (result.code && result.code !== 0) {
      throw new Error(result.msg || `Feishu image upload failed: ${result.code}`);
    }
    if (!result.data?.image_key) {
      throw new Error('missing Feishu image_key');
    }

    return result.data.image_key;
  }

  private async uploadFile(attachment: OutgoingAttachment): Promise<string> {
    const accessToken = await this.fetchTenantAccessToken();
    const form = new FormData();
    form.append('file_type', inferFeishuFileType(attachment));
    form.append('file_name', attachment.fileName);
    form.append(
      'file',
      new Blob([new Uint8Array(attachment.buffer)], { type: attachment.mimeType || 'application/octet-stream' }),
      attachment.fileName,
    );

    const response = await this.fetchImpl(`${FEISHU_BASE_URL}/im/v1/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`Feishu file upload failed with status ${response.status}`);
    }

    const result = await response.json() as FeishuUploadFileResponse;
    if (result.code && result.code !== 0) {
      throw new Error(result.msg || `Feishu file upload failed: ${result.code}`);
    }
    if (!result.data?.file_key) {
      throw new Error('missing Feishu file_key');
    }

    return result.data.file_key;
  }

  private async sendMessagePayload(
    replyContext: FeishuReplyContext,
    payload: { msg_type: 'text' | 'image' | 'file'; content: string },
  ): Promise<SentMessageRef | null> {
    if (replyContext?.messageId) {
      const result = await this.apiClient.im.v1.message.reply({
        data: payload,
        path: {
          message_id: replyContext.messageId,
        },
      });
      const messageId = extractMessageId(result);
      return messageId
        ? {
          platform: 'feishu',
          messageId,
          chatId: replyContext.chatId,
        }
        : null;
    }

    if (!replyContext?.chatId) {
      throw new Error('chatId or messageId is required for Feishu replies');
    }

    const result = await this.apiClient.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: replyContext.chatId,
        ...payload,
      },
    });

    const messageId = extractMessageId(result);
    return messageId
      ? {
        platform: 'feishu',
        messageId,
        chatId: replyContext.chatId,
      }
      : null;
  }

  async replyText(replyContext: FeishuReplyContext, text: string, options: ReplyTextOptions = {}): Promise<SentMessageRef | null> {
    const rendered = renderReply('feishu', text, options);
    return this.sendMessagePayload(replyContext, buildTextPayload(rendered.text));
  }

  async updateText(_replyContext: FeishuReplyContext, message: SentMessageRef, text: string, options: ReplyTextOptions = {}): Promise<void> {
    if (!message?.messageId) {
      throw new Error('messageId is required for Feishu updates');
    }

    const rendered = renderReply('feishu', text, options);
    await this.apiClient.im.v1.message.update({
      path: {
        message_id: message.messageId,
      },
      data: buildTextPayload(rendered.text),
    });
  }

  async sendImage(replyContext: FeishuReplyContext, attachment: OutgoingAttachment): Promise<SentMessageRef | null> {
    const imageKey = await this.uploadImage(attachment);
    return this.sendMessagePayload(replyContext, buildMessagePayload('image', { image_key: imageKey }));
  }

  async sendFile(replyContext: FeishuReplyContext, attachment: OutgoingAttachment): Promise<SentMessageRef | null> {
    const fileKey = await this.uploadFile(attachment);
    return this.sendMessagePayload(replyContext, buildMessagePayload('file', { file_key: fileKey }));
  }

  async downloadImage(
    incomingMessage: IncomingMessage,
    image: IncomingImageAttachment,
    options: DownloadImageOptions,
  ): Promise<DownloadedImageFile> {
    if (!incomingMessage?.messageId) {
      throw new Error('messageId is required for Feishu image download');
    }
    if (!image?.fileKey) {
      throw new Error('fileKey is required for Feishu image download');
    }

    const resource = await this.apiClient.im.v1.messageResource.get({
      path: {
        message_id: incomingMessage.messageId,
        file_key: image.fileKey,
      },
      params: {
        type: 'image',
      },
    });

    const rawLength = Number(readHeaderValue(resource?.headers, 'content-length'));
    if (Number.isFinite(rawLength) && rawLength > options.maxBytes) {
      throw new Error(`image size exceeds limit ${options.maxBytes} bytes`);
    }

    const stream = resource?.getReadableStream?.();
    if (!stream) {
      throw new Error('failed to read Feishu image stream');
    }

    const buffer = await streamToBuffer(stream, options.maxBytes);
    const sizeBytes = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : buffer.length;

    return {
      buffer,
      sizeBytes,
      mimeType: normalizeMimeType(readHeaderValue(resource?.headers, 'content-type')) || image.mimeType,
      fileName: image.fileName,
    };
  }
}
