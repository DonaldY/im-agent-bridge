import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../src/doctor.js';

function createBaseConfig(platformKind) {
  return {
    platform: { kind: platformKind },
    stateDir: path.join(os.tmpdir(), 'iab-doctor-state'),
    bridge: { workingDir: os.tmpdir() },
    agents: {
      enabled: [],
    },
    dingtalk: { clientId: '', clientSecret: '', allowedUserIds: [] },
    feishu: { appId: '', appSecret: '', allowedUserIds: [] },
    telegram: {
      botToken: '',
      allowedUserIds: [],
      pollTimeoutSeconds: 20,
      mode: 'poll',
      webhookListenHost: '127.0.0.1',
      webhookPort: 8080,
      webhookPath: '/telegram/webhook',
    },
  };
}

test('runDoctor remote probe checks feishu token and ws config', async () => {
  const config = createBaseConfig('feishu');
  config.feishu = {
    appId: 'cli_a',
    appSecret: 'secret_a',
    allowedUserIds: ['ou_123'],
  };

  const requests = [];
  const output = await runDoctor(config, {
    remote: true,
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        json: async () => {
          if (String(url).includes('tenant_access_token/internal')) {
            return {
              code: 0,
              tenant_access_token: 't-1234567890',
              expire: 7200,
            };
          }
          return {
            code: 0,
            data: {
              URL: 'wss://open.feishu.cn/ws',
              ClientConfig: {
                PingInterval: 10,
              },
            },
          };
        },
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.match(output, /feishu tenant access token/u);
  assert.match(output, /feishu ws endpoint: wss:\/\/open\.feishu\.cn\/ws/u);
  assert.match(output, /feishu ws ping: 10/u);
});

test('runDoctor remote probe checks telegram webhook info', async () => {
  const config = createBaseConfig('telegram');
  config.telegram = {
    botToken: '123:abc',
    allowedUserIds: ['42'],
    pollTimeoutSeconds: 20,
    mode: 'webhook',
    webhookListenHost: '127.0.0.1',
    webhookPort: 8080,
    webhookPath: '/telegram/webhook',
    webhookUrl: 'https://example.com/telegram/webhook',
  };

  const output = await runDoctor(config, {
    remote: true,
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => {
        if (String(url).includes('getMe')) {
          return {
            ok: true,
            result: { username: 'demo_bot' },
          };
        }
        return {
          ok: true,
          result: {
            url: 'https://example.com/telegram/webhook',
            pending_update_count: 2,
          },
        };
      },
    }),
  });

  assert.match(output, /telegram bot: demo_bot/u);
  assert.match(output, /telegram webhook info: https:\/\/example\.com\/telegram\/webhook/u);
  assert.match(output, /telegram webhook pending: 2/u);
});
