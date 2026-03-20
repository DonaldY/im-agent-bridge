import type { AgentName, PlatformKind, TelegramMode } from '../shared/index.js';

export interface AgentConfig {
  bin: string;
  model?: string;
  extraArgs: string[];
}

export interface NetworkConfig {
  proxyUrl?: string;
  noProxy?: string;
}

export interface DingTalkConfig {
  clientId: string;
  clientSecret: string;
  robotCode?: string;
  allowedUserIds: string[];
}

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  allowedUserIds: string[];
}

export interface TelegramConfig {
  botToken: string;
  allowedUserIds: string[];
  apiBase: string;
  mode: TelegramMode;
  pollTimeoutSeconds: number;
  webhookListenHost: string;
  webhookPort: number;
  webhookPath: string;
  healthPath: string;
  webhookUrl?: string;
  webhookSecretToken?: string;
  dropPendingUpdates: boolean;
  clearWebhookOnStart: boolean;
}

export interface BridgeConfig {
  defaultAgent: AgentName;
  workingDir: string;
  debug: boolean;
  replyChunkChars: number;
  replyMode: 'final_only' | 'stream';
  dedupeTtlMs: number;
  imageEnabled: boolean;
  imageMaxMb: number;
}

export interface AppConfig {
  configPath: string;
  stateDir: string;
  platform: {
    kind: PlatformKind;
  };
  dingtalk: DingTalkConfig;
  feishu: FeishuConfig;
  telegram: TelegramConfig;
  bridge: BridgeConfig;
  network: NetworkConfig;
  agents: Record<AgentName, AgentConfig> & {
    enabled: AgentName[];
  };
}
