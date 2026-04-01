import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient, normalizeTelegramUpdate } from '../src/client/telegram-client';

test('normalizeTelegramUpdate parses private text message', () => {
  const message = normalizeTelegramUpdate({
    update_id: 1,
    message: {
      message_id: 11,
      text: ' hello ',
      chat: { id: 22, type: 'private' },
      from: { id: 33, username: 'bot-user', first_name: 'Bot' },
    },
  });

  assert.equal(message.userId, '33');
  assert.equal(message.conversationId, '22');
  assert.equal(message.messageId, '11');
  assert.equal(message.text, 'hello');
  assert.equal(message.replyContext.chatId, 22);
});

test('TelegramClient.replyText sends sendMessage payload', async () => {
  let request;
  const client = new TelegramClient({
    botToken: '123:abc',
    allowedUserIds: ['33'],
    apiBase: 'https://api.telegram.org',
    mode: 'poll',
    pollTimeoutSeconds: 20,
    clearWebhookOnStart: false,
  }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 12 } }),
      };
    },
  });

  await client.replyText({ chatId: 22, replyToMessageId: 11 }, 'hello');

  assert.match(request.url, /sendMessage/u);
  const body = JSON.parse(request.init.body);
  assert.equal(body.chat_id, 22);
  assert.equal(body.reply_to_message_id, 11);
  assert.equal(body.text, 'hello');
});

test('TelegramClient webhook mode exposes health endpoint', async () => {
  const client = new TelegramClient({
    botToken: '123:abc',
    allowedUserIds: ['33'],
    apiBase: 'https://api.telegram.org',
    mode: 'webhook',
    webhookListenHost: '127.0.0.1',
    webhookPort: 0,
    webhookPath: '/telegram/webhook-test',
    healthPath: '/healthz-test',
    webhookSecretToken: 'secret-1',
    dropPendingUpdates: false,
  }, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    }),
  });

  await client.start(async () => {});
  const port = client.server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/healthz-test`);
  const body = await response.json();
  await client.stop();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'webhook');
  assert.equal(body.healthPath, '/healthz-test');
});

test('TelegramClient webhook mode accepts update and forwards message', async () => {
  const received = [];
  const client = new TelegramClient({
    botToken: '123:abc',
    allowedUserIds: ['33'],
    apiBase: 'https://api.telegram.org',
    mode: 'webhook',
    webhookListenHost: '127.0.0.1',
    webhookPort: 0,
    webhookPath: '/telegram/webhook-test',
    webhookSecretToken: 'secret-1',
    dropPendingUpdates: false,
  }, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    }),
  });

  await client.start(async (message) => {
    received.push(message);
  });

  const port = client.server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/telegram/webhook-test`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'secret-1',
    },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 11,
        text: ' hello ',
        chat: { id: 22, type: 'private' },
        from: { id: 33, username: 'bot-user', first_name: 'Bot' },
      },
    }),
  });

  assert.equal(response.status, 200);

  for (let index = 0; index < 20 && received.length === 0; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  await client.stop();

  assert.equal(received.length, 1);
  assert.equal(received[0].text, 'hello');
});
