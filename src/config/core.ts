import type { AgentName, PlatformKind, TelegramMode } from '../shared/index.js';
import type { AppConfig } from './types.js';
import { expandHomePath, which } from '../utils.js';

export const DEFAULT_PLATFORM_KIND: PlatformKind = 'dingtalk';
export const VALID_AGENTS: AgentName[] = ['claude', 'codex', 'neovate', 'opencode'];
export const VALID_PLATFORMS: PlatformKind[] = ['dingtalk', 'feishu', 'telegram'];
export const VALID_TELEGRAM_MODES: TelegramMode[] = ['poll', 'webhook'];

export function defaultConfigPath(): string {
  return expandHomePath(process.env.IAB_CONFIG_PATH || '~/.im-agent-bridge/config.toml') as string;
}

export function defaultStateDir(): string {
  if (process.env.IAB_STATE_DIR) {
    return expandHomePath(process.env.IAB_STATE_DIR) as string;
  }

  return expandHomePath('~/.im-agent-bridge/workspace') as string;
}

export function agentBinEnvName(agent: AgentName): string {
  return `IAB_${agent.toUpperCase()}_BIN`;
}

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function normalizeWebhookPath(rawPath: unknown, fallback = '/telegram/webhook'): string {
  const value = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : fallback;
  return value.startsWith('/') ? value : `/${value}`;
}

export function validatePlatformConfig(platformKind: PlatformKind, config: AppConfig): void {
  if (platformKind === 'dingtalk') {
    if (!config.dingtalk.clientId) {
      throw new Error('dingtalk.client_id is required');
    }
    if (!config.dingtalk.clientSecret) {
      throw new Error('dingtalk.client_secret is required');
    }
    return;
  }

  if (platformKind === 'feishu') {
    if (!config.feishu.appId) {
      throw new Error('feishu.app_id is required');
    }
    if (!config.feishu.appSecret) {
      throw new Error('feishu.app_secret is required');
    }
    return;
  }

  if (!config.telegram.botToken) {
    throw new Error('telegram.bot_token is required');
  }
}

export function resolveAgentBinary(config: AppConfig, agent: AgentName): string | null {
  const envOverride = process.env[agentBinEnvName(agent)];
  if (typeof envOverride === 'string' && envOverride.trim()) {
    return expandHomePath(envOverride.trim()) as string;
  }

  const configured = config.agents?.[agent]?.bin;
  if (configured) {
    return configured;
  }

  return which(agent);
}

export function applyRuntimeEnvironment(config: AppConfig): void {
  if (config.network?.proxyUrl) {
    process.env.HTTP_PROXY = config.network.proxyUrl;
    process.env.HTTPS_PROXY = config.network.proxyUrl;
    process.env.ALL_PROXY = config.network.proxyUrl;
    process.env.http_proxy = config.network.proxyUrl;
    process.env.https_proxy = config.network.proxyUrl;
    process.env.all_proxy = config.network.proxyUrl;
  }

  if (config.network?.noProxy) {
    process.env.NO_PROXY = config.network.noProxy;
    process.env.no_proxy = config.network.noProxy;
  }
}
