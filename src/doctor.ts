import { resolveAgentBinary } from './config/index.js';
import type { DoctorOptions } from './shared/index.js';
import type { AppConfig } from './config/types.js';
import { fileExists, formatCheckResult, isWritableDirectory, toErrorMessage } from './utils.js';

const STREAM_TOPIC = '/v1.0/im/bot/messages/get';
const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';
const TELEGRAM_BASE_URL = 'https://api.telegram.org';

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function probeDingTalkAccessToken(config: AppConfig, fetchImpl: typeof fetch): Promise<string> {
  const url = `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(config.dingtalk.clientId)}&appsecret=${encodeURIComponent(config.dingtalk.clientSecret)}`;
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  const data = await parseJsonResponse<{ access_token?: string; errmsg?: string }>(response);
  if (!data?.access_token) {
    throw new Error(data?.errmsg || 'missing access_token');
  }
  return data.access_token;
}

async function probeDingTalkGateway(config: AppConfig, accessToken: string, fetchImpl: typeof fetch): Promise<{ endpoint?: string; ticket?: string }> {
  const response = await fetchImpl('https://api.dingtalk.com/v1.0/gateway/connections/open', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'access-token': accessToken,
    },
    body: JSON.stringify({
      clientId: config.dingtalk.clientId,
      clientSecret: config.dingtalk.clientSecret,
      subscriptions: [{ type: 'CALLBACK', topic: STREAM_TOPIC }],
    }),
  });
  const data = await parseJsonResponse<{ endpoint?: string; ticket?: string }>(response);
  if (!data?.endpoint || !data?.ticket) {
    throw new Error('missing endpoint or ticket');
  }
  return data;
}

async function probeFeishuTenantToken(config: AppConfig, fetchImpl: typeof fetch): Promise<{ code?: number; msg?: string; tenant_access_token?: string; expire?: number }> {
  const response = await fetchImpl(`${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: config.feishu.appId, app_secret: config.feishu.appSecret }),
  });
  const data = await parseJsonResponse<{ code?: number; msg?: string; tenant_access_token?: string; expire?: number }>(response);
  if (data?.code && data.code !== 0) {
    throw new Error(data.msg || `Feishu auth failed: ${data.code}`);
  }
  if (!data?.tenant_access_token) {
    throw new Error('missing tenant_access_token');
  }
  return data;
}

async function probeFeishuWsConfig(config: AppConfig, fetchImpl: typeof fetch): Promise<{ URL?: string; ClientConfig?: { PingInterval?: number } }> {
  const response = await fetchImpl(`${FEISHU_BASE_URL}/callback/ws/endpoint`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', locale: 'zh' },
    body: JSON.stringify({ AppID: config.feishu.appId, AppSecret: config.feishu.appSecret }),
  });
  const data = await parseJsonResponse<{ code?: number; msg?: string; data?: { URL?: string; ClientConfig?: { PingInterval?: number } } }>(response);
  if (data?.code && data.code !== 0) {
    throw new Error(data.msg || `Feishu ws config failed: ${data.code}`);
  }
  if (!data?.data?.URL) {
    throw new Error('missing Feishu ws URL');
  }
  return data.data;
}

async function probeTelegramBot(config: AppConfig, fetchImpl: typeof fetch): Promise<{ username?: string }> {
  const response = await fetchImpl(`${TELEGRAM_BASE_URL}/bot${encodeURIComponent(config.telegram.botToken)}/getMe`);
  const data = await parseJsonResponse<{ ok?: boolean; result?: { username?: string }; description?: string }>(response);
  if (!data?.ok || !data?.result?.username) {
    throw new Error(data?.description || 'missing bot information');
  }
  return data.result;
}

async function probeTelegramWebhook(config: AppConfig, fetchImpl: typeof fetch): Promise<{ url?: string; pending_update_count?: number; last_error_message?: string }> {
  const response = await fetchImpl(`${TELEGRAM_BASE_URL}/bot${encodeURIComponent(config.telegram.botToken)}/getWebhookInfo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const data = await parseJsonResponse<{ ok?: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string }; description?: string }>(response);
  if (!data?.ok) {
    throw new Error(data?.description || 'failed to load webhook info');
  }
  return data.result || {};
}

export async function runDoctor(config: AppConfig, options: DoctorOptions = {}): Promise<string> {
  const lines: string[] = [];
  const platformKind = config.platform.kind;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  lines.push(formatCheckResult(true, 'platform.kind', platformKind));

  if (platformKind === 'dingtalk') {
    lines.push(formatCheckResult(Boolean(config.dingtalk.clientId), 'dingtalk.client_id'));
    lines.push(formatCheckResult(Boolean(config.dingtalk.clientSecret), 'dingtalk.client_secret'));
    lines.push(formatCheckResult(true, 'dingtalk.allowed_user_ids', config.dingtalk.allowedUserIds.length > 0 ? config.dingtalk.allowedUserIds.join(', ') : 'not set (allow all users)'));
  }

  if (platformKind === 'feishu') {
    lines.push(formatCheckResult(Boolean(config.feishu.appId), 'feishu.app_id'));
    lines.push(formatCheckResult(Boolean(config.feishu.appSecret), 'feishu.app_secret'));
    lines.push(formatCheckResult(true, 'feishu.allowed_user_ids', config.feishu.allowedUserIds.length > 0 ? config.feishu.allowedUserIds.join(', ') : 'not set (allow all users)'));
  }

  if (platformKind === 'telegram') {
    lines.push(formatCheckResult(Boolean(config.telegram.botToken), 'telegram.bot_token'));
    lines.push(formatCheckResult(true, 'telegram.allowed_user_ids', config.telegram.allowedUserIds.length > 0 ? config.telegram.allowedUserIds.join(', ') : 'not set (allow all users)'));
    lines.push(formatCheckResult(config.telegram.pollTimeoutSeconds > 0, 'telegram.poll_timeout_seconds', String(config.telegram.pollTimeoutSeconds)));
    lines.push(formatCheckResult(Boolean(config.telegram.mode), 'telegram.mode', config.telegram.mode));
    if (config.telegram.mode === 'webhook') {
      lines.push(formatCheckResult(true, 'telegram.webhook.listen', `${config.telegram.webhookListenHost}:${config.telegram.webhookPort}${config.telegram.webhookPath}`));
      lines.push(formatCheckResult(true, 'telegram.health_path', config.telegram.healthPath));
      lines.push(formatCheckResult(Boolean(config.telegram.webhookUrl), 'telegram.webhook_url', config.telegram.webhookUrl || 'not set'));
    }
  }

  lines.push(formatCheckResult(await fileExists(config.bridge.workingDir), 'bridge.working_dir exists', config.bridge.workingDir));
  lines.push(formatCheckResult(await isWritableDirectory(config.stateDir), 'state_dir writable', config.stateDir));

  for (const agent of config.agents.enabled) {
    const resolved = resolveAgentBinary(config, agent);
    lines.push(formatCheckResult(Boolean(resolved), `agent ${agent}`, resolved || 'not found'));
  }

  if (options.remote) {
    try {
      if (platformKind === 'dingtalk') {
        const accessToken = await probeDingTalkAccessToken(config, fetchImpl);
        lines.push(formatCheckResult(true, 'dingtalk access token', `${accessToken.slice(0, 8)}...`));
        const endpoint = await probeDingTalkGateway(config, accessToken, fetchImpl);
        lines.push(formatCheckResult(true, 'dingtalk stream endpoint', endpoint.endpoint || 'unknown'));
      } else if (platformKind === 'feishu') {
        const tokenData = await probeFeishuTenantToken(config, fetchImpl);
        lines.push(formatCheckResult(true, 'feishu tenant access token', `${String(tokenData.tenant_access_token).slice(0, 8)}...`));
        if (tokenData.expire) {
          lines.push(formatCheckResult(true, 'feishu token expire', String(tokenData.expire)));
        }
        const wsData = await probeFeishuWsConfig(config, fetchImpl);
        lines.push(formatCheckResult(true, 'feishu ws endpoint', wsData.URL || 'unknown'));
        if (wsData.ClientConfig?.PingInterval) {
          lines.push(formatCheckResult(true, 'feishu ws ping', String(wsData.ClientConfig.PingInterval)));
        }
      } else if (platformKind === 'telegram') {
        const bot = await probeTelegramBot(config, fetchImpl);
        lines.push(formatCheckResult(true, 'telegram bot', bot.username || 'unknown'));
        if (config.telegram.mode === 'webhook') {
          const webhookInfo = await probeTelegramWebhook(config, fetchImpl);
          lines.push(formatCheckResult(true, 'telegram webhook info', webhookInfo.url || 'not set'));
          lines.push(formatCheckResult(true, 'telegram webhook pending', String(webhookInfo.pending_update_count || 0)));
          if (webhookInfo.last_error_message) {
            lines.push(formatCheckResult(false, 'telegram webhook last error', webhookInfo.last_error_message));
          }
        }
      }
    } catch (error) {
      lines.push(formatCheckResult(false, `${platformKind} remote probe`, toErrorMessage(error)));
    }
  }

  return lines.join('\n');
}
