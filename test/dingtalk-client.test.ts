import test from 'node:test';
import assert from 'node:assert/strict';
import { DingTalkClient, normalizeRobotMessage } from '../src/client/dingtalk-client';

test('normalizeRobotMessage prefers senderStaffId', () => {
  const message = normalizeRobotMessage({
    headers: { messageId: 'm1' },
    data: JSON.stringify({
      senderStaffId: 'staff-1',
      senderId: 'user-1',
      senderNick: 'Tom',
      conversationId: 'cid',
      conversationType: '1',
      sessionWebhook: 'https://example.com/hook',
      sessionWebhookExpiredTime: Date.now() + 60_000,
      robotCode: 'robot',
      msgtype: 'text',
      text: { content: ' hello ' },
    }),
  });

  assert.equal(message.userId, 'staff-1');
  assert.equal(message.text, 'hello');
  assert.equal(message.replyContext.sessionWebhook, 'https://example.com/hook');
});

test('normalizeRobotMessage prefers business msgId for dedupe', () => {
  const message = normalizeRobotMessage({
    headers: { messageId: 'transport-1' },
    data: JSON.stringify({
      msgId: 'biz-1',
      senderStaffId: 'staff-1',
      conversationId: 'cid',
      sessionWebhook: 'https://example.com/hook',
      msgtype: 'text',
      text: { content: '/status' },
    }),
  });

  assert.equal(message.messageId, 'biz-1');
});

test('normalizeRobotMessage parses picture message', () => {
  const message = normalizeRobotMessage({
    headers: { messageId: 'transport-2' },
    data: JSON.stringify({
      msgId: 'biz-2',
      senderStaffId: 'staff-1',
      conversationId: 'cid',
      sessionWebhook: 'https://example.com/hook',
      robotCode: 'ding_robot',
      msgtype: 'picture',
      content: JSON.stringify({ pictureDownloadCode: 'download-code-1' }),
    }),
  });

  assert.equal(message.text, '');
  assert.equal(message.images.length, 1);
  assert.equal(message.images[0].fileKey, 'download-code-1');
});

test('DingTalkClient.replyText posts text payload', async () => {
  let request;
  const client = new DingTalkClient({ clientId: 'cid', clientSecret: 'secret' }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ errcode: 0 }),
      };
    },
  });

  await client.replyText({
    sessionWebhook: 'https://example.com/hook',
    sessionWebhookExpiredTime: Date.now() + 60_000,
  }, 'hello');

  assert.equal(request.url, 'https://example.com/hook');
  assert.equal(request.init.method, 'POST');
  const body = JSON.parse(request.init.body);
  assert.equal(body.msgtype, 'markdown');
  assert.equal(body.markdown.text, 'hello');
  assert.match(body.markdown.title, /hello/u);
});

test('DingTalkClient.downloadImage resolves download url and fetches file', async () => {
  const requests = [];
  const client = new DingTalkClient({ clientId: 'cid', clientSecret: 'secret', robotCode: 'ding_robot' }, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });

      if (String(url).includes('/gettoken')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'token_1', expires_in: 7200 }),
        };
      }

      if (url === 'https://api.dingtalk.com/v1.0/robot/messageFiles/download') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ downloadUrl: 'https://example.com/image.png' }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            if (name === 'content-type') {
              return 'image/png';
            }
            if (name === 'content-length') {
              return '4';
            }
            return null;
          },
        },
        arrayBuffer: async () => Buffer.from('test'),
      };
    },
  });

  const result = await client.downloadImage(
    {
      platform: 'dingtalk',
      userId: 'u1',
      text: '',
      replyContext: { platform: 'dingtalk', sessionWebhook: 'https://example.com/hook', robotCode: 'ding_robot' },
    },
    { fileKey: 'download-code-1' },
    { maxBytes: 20 },
  );

  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.sizeBytes, 4);
  assert.equal(result.buffer.toString('utf8'), 'test');
  assert.equal(requests.length, 3);
});

test('DingTalkClient.sendImage uploads media then posts markdown image payload', async () => {
  const requests = [];
  const client = new DingTalkClient({ clientId: 'cid', clientSecret: 'secret' }, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });

      if (String(url).includes('/gettoken')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'token_1', expires_in: 7200 }),
        };
      }

      if (String(url).includes('/media/upload')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ errcode: 0, media_id: '@media_1' }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ errcode: 0 }),
      };
    },
  });

  await client.sendImage(
    {
      platform: 'dingtalk',
      sessionWebhook: 'https://example.com/hook',
      sessionWebhookExpiredTime: Date.now() + 60_000,
    },
    {
      kind: 'image',
      buffer: Buffer.from('fake-image'),
      fileName: 'chart.png',
      sizeBytes: 10,
      mimeType: 'image/png',
    },
  );

  assert.equal(requests.length, 3);
  assert.match(String(requests[1].url), /\/media\/upload\?/u);
  assert.equal(requests[2].url, 'https://example.com/hook');
  const body = JSON.parse(requests[2].init.body);
  assert.equal(body.msgtype, 'markdown');
  assert.match(body.markdown.text, /!\[chart\.png\]\(@media_1\)/u);
});
