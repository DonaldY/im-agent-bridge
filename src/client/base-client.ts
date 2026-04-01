import type { LoggerLike } from '../shared/index.js';
import type { ReplyTextOptions } from './message-format.js';
import type { ClientLike, ClientStartHandler, PlatformReplyContext, SentMessageRef } from './types.js';

export class BaseClient<TConfig> implements ClientLike {
  protected config: TConfig;
  protected logger: LoggerLike;
  protected debug: boolean;

  constructor(config: TConfig, options: { logger?: LoggerLike; debug?: boolean } = {}) {
    this.config = config;
    this.logger = options.logger || console;
    this.debug = Boolean(options.debug);
  }

  protected logDebug(message: string, payload?: unknown, formatter: ((value: unknown) => string) | null = null): void {
    if (!this.debug) {
      return;
    }

    const logger = typeof this.logger.info === 'function'
      ? this.logger.info.bind(this.logger)
      : this.logger.log.bind(this.logger);

    if (payload === undefined) {
      logger(message);
      return;
    }

    const formatted = typeof formatter === 'function'
      ? formatter(payload)
      : (typeof payload === 'string' ? payload : JSON.stringify(payload));
    logger(`${message} ${formatted}`);
  }

  async start(_onMessage: ClientStartHandler): Promise<void> {
    throw new Error(`${this.constructor.name}.start() is not implemented`);
  }

  async stop(): Promise<void> {
    throw new Error(`${this.constructor.name}.stop() is not implemented`);
  }

  async replyText(_replyContext: PlatformReplyContext, _text: string, _options?: ReplyTextOptions): Promise<SentMessageRef | null | void> {
    throw new Error(`${this.constructor.name}.replyText() is not implemented`);
  }
}
