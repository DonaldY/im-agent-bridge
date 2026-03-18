import { DWClient, EventAck, TOPIC_ROBOT } from 'dingtalk-stream-sdk-nodejs';
import type { LoggerLike } from '../shared/index.js';
import type { DingTalkConfig } from '../config/types.js';
import { renderReply } from './message-format.js';
import type { ReplyTextOptions } from './message-format.js';
import type { DingTalkReplyContext, IncomingMessage } from './types.js';
import { BaseClient } from './base-client.js';
import { formatLogValue, toErrorMessage, toUtf8String } from '../utils.js';

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

  constructor(config: DingTalkConfig, options: DingTalkClientOptions = {}) {
    super(config, options);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.clientFactory = options.clientFactory;
    this.client = null;
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
