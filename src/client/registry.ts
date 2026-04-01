import type { LoggerLike } from '../shared';
import type { AppConfig } from '../config/types';
import type { ClientLike } from './types';
import { DingTalkClient } from './dingtalk-client';
import { FeishuClient } from './feishu-client';
import { TelegramClient } from './telegram-client';

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
