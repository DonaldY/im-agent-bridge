import type { LoggerLike } from '../shared/index.js';
import type { AppConfig } from '../config/types.js';
import type { ClientLike } from './types.js';
import { DingTalkClient } from './dingtalk-client.js';
import { FeishuClient } from './feishu-client.js';
import { TelegramClient } from './telegram-client.js';

export interface ClientFactoryOptions {
  debug?: boolean;
  logger?: LoggerLike;
}

export type PlatformClientCreator = (config: AppConfig, options?: ClientFactoryOptions) => ClientLike;

export const PLATFORM_CLIENT_REGISTRY = {
  dingtalk: (config: AppConfig, options: ClientFactoryOptions = {}) => new DingTalkClient(config.dingtalk, options),
  feishu: (config: AppConfig, options: ClientFactoryOptions = {}) => new FeishuClient(config.feishu, options),
  telegram: (config: AppConfig, options: ClientFactoryOptions = {}) => new TelegramClient(config.telegram, options),
} as const satisfies Record<AppConfig['platform']['kind'], PlatformClientCreator>;
