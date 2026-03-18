import test from 'node:test';
import assert from 'node:assert/strict';
import { DingTalkClient, normalizeRobotMessage } from '../src/client/dingtalk-client.js';

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
