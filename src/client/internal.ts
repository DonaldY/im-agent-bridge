export { BaseClient } from './base-client';
export { DingTalkClient } from './dingtalk-client';
export { FeishuClient } from './feishu-client';
export { TelegramClient } from './telegram-client';
export { PLATFORM_CLIENT_REGISTRY } from './registry';
export { createPlatformClient } from './factory';
export type { ClientFactoryOptions, PlatformClientCreator } from './registry';
