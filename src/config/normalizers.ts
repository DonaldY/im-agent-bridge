import path from 'node:path';
import type { AgentName, PlatformKind, TelegramMode } from '../shared/index.js';
import type {
  AgentConfig,
  AppConfig,
  DingTalkConfig,
  FeishuConfig,
  NetworkConfig,
  TelegramConfig,
} from './types.js';
import { coerceStringArray, expandHomePath, isStringArray } from '../utils.js';
import {
  DEFAULT_PLATFORM_KIND,
  VALID_AGENTS,
  VALID_PLATFORMS,
  VALID_TELEGRAM_MODES,
  asRecord,
  defaultStateDir,
  normalizeWebhookPath,
} from './core.js';

function normalizeAgentEnvEntries(entries: Array<[string, unknown]>, label: string): Record<string, string> {
  const normalized: Array<[string, string]> = [];

  for (const [key, entry] of entries) {
    if (typeof entry === 'string') {
      if (!entry.trim()) {
        continue;
      }
      normalized.push([key, entry]);
      continue;
    }

    if (typeof entry === 'number' || typeof entry === 'boolean') {
      normalized.push([key, String(entry)]);
      continue;
    }

    throw new Error(`${label}.${key} must be a string, number, or boolean`);
  }

  return Object.fromEntries(normalized);
}

function normalizeAgentEnv(raw: Record<string, unknown>, label: string): Record<string, string> {
  const value = asRecord(raw.env);
  const directEntries = Object.entries(raw).filter(([key]) => !['bin', 'model', 'extra_args', 'env'].includes(key));
  const nestedEntries = Object.entries(value);

  return {
    ...normalizeAgentEnvEntries(nestedEntries, `${label}.env`),
    ...normalizeAgentEnvEntries(directEntries, label),
  };
}

export function normalizeAgentConfig(raw: unknown, label: string, fallbackBin: string): AgentConfig {
  const value = asRecord(raw);
  const extraArgs = value.extra_args ?? [];

  if (!Array.isArray(extraArgs)) {
    throw new Error(`${label}.extra_args must be an array`);
  }

  return {
    bin: typeof value.bin === 'string' && value.bin.trim() ? (expandHomePath(value.bin.trim()) as string) : fallbackBin,
    model: typeof value.model === 'string' && value.model.trim() ? value.model.trim() : undefined,
    extraArgs: extraArgs.map((entry: unknown) => {
      if (typeof entry !== 'string') {
        throw new Error(`${label}.extra_args must contain only strings`);
      }
      return entry;
    }),
    env: normalizeAgentEnv(value, label),
  };
}

export function normalizeNetworkConfig(raw: unknown): NetworkConfig {
  const value = asRecord(raw);
  return {
    proxyUrl: typeof value.proxy_url === 'string' && value.proxy_url.trim() ? value.proxy_url.trim() : undefined,
    noProxy: typeof value.no_proxy === 'string' && value.no_proxy.trim() ? value.no_proxy.trim() : undefined,
  };
}

export function normalizeDingTalkConfig(raw: unknown): DingTalkConfig {
  const value = asRecord(raw);
  const allowedUserIds = Array.isArray(value.allowed_user_ids)
    ? coerceStringArray(value.allowed_user_ids, 'dingtalk.allowed_user_ids')
    : [];

  return {
    clientId: typeof value.client_id === 'string' ? value.client_id.trim() : '',
    clientSecret: typeof value.client_secret === 'string' ? value.client_secret.trim() : '',
    robotCode: typeof value.robot_code === 'string' && value.robot_code.trim() ? value.robot_code.trim() : undefined,
    allowedUserIds,
  };
}

export function normalizeFeishuConfig(raw: unknown): FeishuConfig {
  const value = asRecord(raw);
  const allowedUserIds = Array.isArray(value.allowed_user_ids)
    ? coerceStringArray(value.allowed_user_ids, 'feishu.allowed_user_ids')
    : [];

  return {
    appId: typeof value.app_id === 'string' ? value.app_id.trim() : '',
    appSecret: typeof value.app_secret === 'string' ? value.app_secret.trim() : '',
    allowedUserIds,
  };
}

export function normalizeTelegramConfig(raw: unknown): TelegramConfig {
  const value = asRecord(raw);
  const allowedUserIds = Array.isArray(value.allowed_user_ids)
    ? coerceStringArray(value.allowed_user_ids, 'telegram.allowed_user_ids')
    : [];
  const pollTimeoutSeconds = Number(value.poll_timeout_seconds ?? 20);
  const mode = (typeof value.mode === 'string' && value.mode.trim() ? value.mode.trim().toLowerCase() : 'poll') as TelegramMode;
  const webhookPort = Number(value.webhook_port ?? 8080);

  if (!VALID_TELEGRAM_MODES.includes(mode)) {
    throw new Error(`telegram.mode must be one of: ${VALID_TELEGRAM_MODES.join(', ')}`);
  }
  if (!Number.isInteger(pollTimeoutSeconds) || pollTimeoutSeconds <= 0) {
    throw new Error('telegram.poll_timeout_seconds must be a positive integer');
  }
  if (!Number.isInteger(webhookPort) || webhookPort < 0) {
    throw new Error('telegram.webhook_port must be a non-negative integer');
  }

  return {
    botToken: typeof value.bot_token === 'string' ? value.bot_token.trim() : '',
    allowedUserIds,
    apiBase: typeof value.api_base === 'string' && value.api_base.trim() ? value.api_base.trim() : 'https://api.telegram.org',
    mode,
    pollTimeoutSeconds,
    webhookListenHost: typeof value.webhook_listen_host === 'string' && value.webhook_listen_host.trim() ? value.webhook_listen_host.trim() : '127.0.0.1',
    webhookPort,
    webhookPath: normalizeWebhookPath(value.webhook_path),
    healthPath: normalizeWebhookPath(value.health_path, '/healthz'),
    webhookUrl: typeof value.webhook_url === 'string' && value.webhook_url.trim() ? value.webhook_url.trim() : undefined,
    webhookSecretToken: typeof value.webhook_secret_token === 'string' && value.webhook_secret_token.trim() ? value.webhook_secret_token.trim() : undefined,
    dropPendingUpdates: typeof value.drop_pending_updates === 'boolean' ? value.drop_pending_updates : false,
    clearWebhookOnStart: typeof value.clear_webhook_on_start === 'boolean' ? value.clear_webhook_on_start : true,
  };
}

export interface NormalizedConfigInputs {
  configPath: string;
  parsed: Record<string, unknown>;
}

function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function normalizeConfig({ configPath, parsed }: NormalizedConfigInputs): AppConfig {
  const platform = asRecord(parsed.platform);
  const bridge = asRecord(parsed.bridge);
  const agents = asRecord(parsed.agents);
  const network = asRecord(parsed.network);

  const platformKind = (typeof platform.kind === 'string' && platform.kind.trim() ? platform.kind.trim() : DEFAULT_PLATFORM_KIND) as PlatformKind;
  if (!VALID_PLATFORMS.includes(platformKind)) {
    throw new Error(`platform.kind must be one of: ${VALID_PLATFORMS.join(', ')}`);
  }

  const defaultAgent = (bridge.default_agent || 'codex') as AgentName;
  if (!VALID_AGENTS.includes(defaultAgent)) {
    throw new Error(`bridge.default_agent must be one of: ${VALID_AGENTS.join(', ')}`);
  }

  if (!bridge.working_dir || typeof bridge.working_dir !== 'string') {
    throw new Error('bridge.working_dir is required');
  }

  const enabledAgents = (agents.enabled ?? VALID_AGENTS) as unknown;
  if (!isStringArray(enabledAgents)) {
    throw new Error('agents.enabled must be an array of strings');
  }

  for (const agent of enabledAgents) {
    if (!VALID_AGENTS.includes(agent as AgentName)) {
      throw new Error(`Unsupported agent in agents.enabled: ${agent}`);
    }
  }

  if (!enabledAgents.includes(defaultAgent)) {
    throw new Error('bridge.default_agent must be included in agents.enabled');
  }

  const replyChunkChars = Number(bridge.reply_chunk_chars ?? 1500);
  const dedupeTtlMs = Number(bridge.dedupe_ttl_ms ?? 600000);
  const replyMode = (bridge.reply_mode ?? 'stream') as 'final_only' | 'stream';
  const imageEnabled = typeof bridge.image_enabled === 'boolean' ? bridge.image_enabled : true;
  const imageMaxMb = Number(bridge.image_max_mb ?? 20);
  const debugFromEnv = parseBooleanFlag(process.env.IAB_DEBUG);
  const isDevLifecycle = process.env.npm_lifecycle_event === 'dev';
  const debug = debugFromEnv
    ?? (isDevLifecycle ? true : undefined)
    ?? (typeof bridge.debug === 'boolean' ? bridge.debug : false);

  if (!Number.isInteger(replyChunkChars) || replyChunkChars <= 0) {
    throw new Error('bridge.reply_chunk_chars must be a positive integer');
  }
  if (!Number.isInteger(dedupeTtlMs) || dedupeTtlMs <= 0) {
    throw new Error('bridge.dedupe_ttl_ms must be a positive integer');
  }
  if (!['final_only', 'stream'].includes(replyMode)) {
    throw new Error('bridge.reply_mode must be one of: final_only, stream');
  }
  if (!Number.isFinite(imageMaxMb) || imageMaxMb <= 0) {
    throw new Error('bridge.image_max_mb must be a positive number');
  }

  return {
    configPath,
    stateDir: defaultStateDir(),
    platform: { kind: platformKind },
    dingtalk: normalizeDingTalkConfig(parsed.dingtalk),
    feishu: normalizeFeishuConfig(parsed.feishu),
    telegram: normalizeTelegramConfig(parsed.telegram),
    bridge: {
      defaultAgent,
      workingDir: path.resolve(expandHomePath(bridge.working_dir) as string),
      debug,
      replyChunkChars,
      replyMode,
      dedupeTtlMs,
      imageEnabled,
      imageMaxMb,
    },
    network: normalizeNetworkConfig(network),
    agents: {
      enabled: enabledAgents as AgentName[],
      claude: normalizeAgentConfig(agents.claude, 'agents.claude', 'claude'),
      codex: normalizeAgentConfig(agents.codex, 'agents.codex', 'codex'),
    },
  };
}
