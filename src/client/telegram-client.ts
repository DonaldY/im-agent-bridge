import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage as NodeIncomingMessage, ServerResponse } from 'node:http';
import type { LoggerLike } from '../shared/index.js';
import type { TelegramConfig } from '../config/types.js';
import { renderReply } from './message-format.js';
import type { ReplyTextOptions } from './message-format.js';
import type { TelegramReplyContext, IncomingMessage, SentMessageRef } from './types.js';
import { BaseClient } from './base-client.js';
import { sleep, toErrorMessage } from '../utils.js';

interface TelegramClientOptions {
  fetchImpl?: typeof fetch;
  logger?: LoggerLike;
  debug?: boolean;
}

interface TelegramUser {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramChat {
  id?: number;
  type?: string;
}

interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

function buildApiUrl(apiBase: string, botToken: string, method: string): string {
  const normalizedBase = apiBase.replace(/\/$/u, '');
  return `${normalizedBase}/bot${botToken}/${method}`;
}

function normalizeWebhookPath(webhookPath: string): string {
  return webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`;
}

export function normalizeTelegramUpdate(update: TelegramUpdate): IncomingMessage | null {
  const message = update?.message;
  if (!message?.from?.id || typeof message.text !== 'string') {
    return null;
  }

  return {
    platform: 'telegram',
    userId: String(message.from.id),
    userIds: [String(message.from.id)],
    userName: message.from.username || [message.from.first_name, message.from.last_name].filter(Boolean).join(' '),
    conversationId: String(message.chat?.id || ''),
    conversationType: message.chat?.type,
    messageId: String(message.message_id),
    text: message.text.trim(),
    replyContext: {
      platform: 'telegram',
      chatId: message.chat?.id,
      replyToMessageId: message.message_id,
    },
    raw: update,
  };
}

export class TelegramClient extends BaseClient<TelegramConfig> {
  private fetchImpl: typeof fetch;
  private apiBase: string;
  private mode: TelegramConfig['mode'];
  private pollTimeoutSeconds: number;
  private updateOffset: number;
  private abortController: AbortController | null;
  private pollingPromise: Promise<void> | null;
  public server: http.Server | null;
  private stopped: boolean;

  constructor(config: TelegramConfig, options: TelegramClientOptions = {}) {
    super(config, options);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.apiBase = config.apiBase || 'https://api.telegram.org';
    this.mode = config.mode || 'poll';
    this.pollTimeoutSeconds = Number(config.pollTimeoutSeconds || 20);
    this.updateOffset = 0;
    this.abortController = null;
    this.pollingPromise = null;
    this.server = null;
    this.stopped = true;
  }

  async callApi<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetchImpl(buildApiUrl(this.apiBase, this.config.botToken, method), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`Telegram ${method} failed with status ${response.status}`);
    }

    const result = await response.json() as TelegramApiResponse<T>;
    if (!result?.ok) {
      throw new Error(result?.description || `Telegram ${method} failed`);
    }

    return result.result as T;
  }

  async clearWebhook(): Promise<unknown> {
    return this.callApi('deleteWebhook', {
      drop_pending_updates: this.config.dropPendingUpdates,
    });
  }

  async configureWebhook(): Promise<unknown> {
    if (!this.config.webhookUrl) {
      return null;
    }

    return this.callApi('setWebhook', {
      url: this.config.webhookUrl,
      secret_token: this.config.webhookSecretToken,
      drop_pending_updates: this.config.dropPendingUpdates,
      allowed_updates: ['message'],
    });
  }

  async pollLoop(onMessage: (incomingMessage: IncomingMessage) => Promise<void> | void): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.callApi<TelegramUpdate[]>('getUpdates', {
          offset: this.updateOffset,
          timeout: this.pollTimeoutSeconds,
          allowed_updates: ['message'],
        });

        for (const update of updates) {
          if (typeof update?.update_id === 'number') {
            this.updateOffset = update.update_id + 1;
          }

          const incomingMessage = normalizeTelegramUpdate(update);
          if (!incomingMessage) {
            continue;
          }

          this.logDebug('[telegram] update', incomingMessage.raw);
          await onMessage(incomingMessage);
        }
      } catch (error: any) {
        if (this.stopped || error?.name === 'AbortError') {
          return;
        }

        this.logger.error?.('[telegram] polling failed:', toErrorMessage(error));
        await sleep(1000);
      }
    }
  }

  writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  handleHealthRequest(req: NodeIncomingMessage, res: ServerResponse, pathname: string): boolean {
    const healthPath = normalizeWebhookPath(this.config.healthPath || '/healthz');
    if (pathname !== healthPath) {
      return false;
    }

    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      this.writeJson(res, 405, { ok: false, error: 'method_not_allowed' });
      return true;
    }

    this.writeJson(res, 200, {
      ok: true,
      platform: 'telegram',
      mode: this.mode,
      webhookPath: normalizeWebhookPath(this.config.webhookPath || '/telegram/webhook'),
      healthPath,
      listening: Boolean(this.server),
      stopped: this.stopped,
    });
    return true;
  }

  async handleWebhookRequest(req: NodeIncomingMessage, res: ServerResponse, onMessage: (incomingMessage: IncomingMessage) => Promise<void> | void): Promise<void> {
    const path = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    const expectedPath = normalizeWebhookPath(this.config.webhookPath || '/telegram/webhook');

    if (this.handleHealthRequest(req, res, path)) {
      return;
    }

    if (req.method !== 'POST') {
      this.writeJson(res, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    if (path !== expectedPath) {
      this.writeJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }

    if (
      this.config.webhookSecretToken &&
      req.headers['x-telegram-bot-api-secret-token'] !== this.config.webhookSecretToken
    ) {
      this.writeJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    let update: TelegramUpdate;
    try {
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      update = JSON.parse(raw) as TelegramUpdate;
    } catch {
      this.writeJson(res, 400, { ok: false, error: 'bad_request' });
      return;
    }

    this.writeJson(res, 200, { ok: true });

    const incomingMessage = normalizeTelegramUpdate(update);
    if (!incomingMessage) {
      return;
    }

    this.logDebug('[telegram] webhook', incomingMessage.raw);
    void Promise.resolve(onMessage(incomingMessage)).catch((error) => {
      this.logger.error?.('[telegram] webhook handler failed:', toErrorMessage(error));
    });
  }

  async startWebhookServer(onMessage: (incomingMessage: IncomingMessage) => Promise<void> | void): Promise<void> {
    this.server = http.createServer((req, res) => {
      void this.handleWebhookRequest(req, res, onMessage);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.webhookPort, this.config.webhookListenHost, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });

    if (this.config.webhookUrl) {
      await this.configureWebhook();
    }
  }

  async start(onMessage: (incomingMessage: IncomingMessage) => Promise<void> | void): Promise<void> {
    this.stopped = false;
    this.abortController = new AbortController();

    if (this.mode === 'webhook') {
      await this.startWebhookServer(onMessage);
      return;
    }

    if (this.config.clearWebhookOnStart) {
      await this.clearWebhook();
    }

    this.pollingPromise = this.pollLoop(onMessage);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortController?.abort();

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((error) => (error ? reject(error) : resolve()));
      });
      this.server = null;
    }

    await this.pollingPromise;
  }

  async sendTyping(replyContext: TelegramReplyContext): Promise<void> {
    if (!replyContext?.chatId) {
      return;
    }

    await this.callApi('sendChatAction', {
      chat_id: replyContext.chatId,
      action: 'typing',
    });
  }

  async replyText(replyContext: TelegramReplyContext, text: string, options: ReplyTextOptions = {}): Promise<SentMessageRef | null> {
    if (!replyContext?.chatId) {
      throw new Error('chatId is required for Telegram replies');
    }

    const rendered = renderReply('telegram', text, options);
    const message = await this.callApi<TelegramMessage>('sendMessage', {
      chat_id: replyContext.chatId,
      text: rendered.text,
      parse_mode: rendered.parseMode,
      disable_web_page_preview: rendered.disableWebPagePreview,
      reply_to_message_id: replyContext.replyToMessageId,
      allow_sending_without_reply: true,
    });

    if (!message?.message_id) {
      return null;
    }

    return {
      platform: 'telegram',
      messageId: String(message.message_id),
      chatId: replyContext.chatId,
    };
  }

  async updateText(replyContext: TelegramReplyContext, message: SentMessageRef, text: string, options: ReplyTextOptions = {}): Promise<void> {
    const chatId = message.chatId || replyContext.chatId;
    if (!chatId || !message?.messageId) {
      throw new Error('chatId and messageId are required for Telegram updates');
    }

    const rendered = renderReply('telegram', text, options);
    await this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: Number(message.messageId),
      text: rendered.text,
      parse_mode: rendered.parseMode,
      disable_web_page_preview: rendered.disableWebPagePreview,
    });
  }
}
