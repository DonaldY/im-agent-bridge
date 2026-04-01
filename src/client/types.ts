import type { PlatformKind } from '../shared';
import type { ReplyTextOptions } from './message-format';

export interface PlatformReplyContextBase {
  platform: PlatformKind;
}

export interface DingTalkReplyContext extends PlatformReplyContextBase {
  platform: 'dingtalk';
  sessionWebhook: string;
  sessionWebhookExpiredTime?: number;
  conversationId?: string;
  robotCode?: string;
}

export interface FeishuReplyContext extends PlatformReplyContextBase {
  platform: 'feishu';
  chatId?: string;
  messageId?: string;
  threadId?: string;
}

export interface TelegramReplyContext extends PlatformReplyContextBase {
  platform: 'telegram';
  chatId?: number;
  replyToMessageId?: number;
}

export type PlatformReplyContext = DingTalkReplyContext | FeishuReplyContext | TelegramReplyContext;

export interface SentMessageRef {
  platform: PlatformKind;
  messageId: string;
  chatId?: string | number;
}

export interface IncomingImageAttachment {
  fileKey: string;
  mimeType?: string;
  sizeBytes?: number;
  fileName?: string;
}

export interface DownloadedImageFile {
  buffer: Buffer;
  mimeType?: string;
  sizeBytes?: number;
  fileName?: string;
}

export interface DownloadImageOptions {
  maxBytes: number;
}

export interface IncomingMessage {
  platform: PlatformKind;
  userId: string;
  userIds?: string[];
  userName?: string;
  conversationId?: string;
  conversationType?: string;
  messageId?: string;
  text: string;
  images?: IncomingImageAttachment[];
  replyContext: PlatformReplyContext;
  raw?: unknown;
}

export interface ClientStartHandler {
  (incomingMessage: IncomingMessage): Promise<void> | void;
}

export interface ClientLike {
  start(onMessage: ClientStartHandler): Promise<void>;
  stop(): Promise<void>;
  replyText(replyContext: PlatformReplyContext, text: string, options?: ReplyTextOptions): Promise<SentMessageRef | null | void>;
  updateText?(replyContext: PlatformReplyContext, message: SentMessageRef, text: string, options?: ReplyTextOptions): Promise<void>;
  sendTyping?(replyContext: PlatformReplyContext): Promise<void>;
  downloadImage?(
    incomingMessage: IncomingMessage,
    image: IncomingImageAttachment,
    options: DownloadImageOptions,
  ): Promise<DownloadedImageFile>;
}
