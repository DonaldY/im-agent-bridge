import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuClient, normalizeFeishuMessage } from '../src/client/feishu-client.js';

test('normalizeFeishuMessage parses text event', () => {
  const message = normalizeFeishuMessage({
    sender: {
      sender_id: {
        user_id: 'ou_user',
        open_id: 'ou_open',
        union_id: 'ou_union',
      },
    },
    message: {
      message_id: 'om_1',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: ' hello ' }),
    },
  });

  assert.equal(message.userId, 'ou_user');
  assert.deepEqual(message.userIds, ['ou_user', 'ou_open', 'ou_union']);
  assert.equal(message.text, 'hello');
  assert.equal(message.replyContext.messageId, 'om_1');
});

test('FeishuClient.replyText replies by message id with text payload', async () => {
  const calls = [];
  const client = new FeishuClient({ appId: 'app', appSecret: 'secret', allowedUserIds: ['u1'] }, {
    apiClient: {
      im: {
        v1: {
          message: {
            async reply(payload) {
              calls.push(['reply', payload]);
            },
            async create(payload) {
              calls.push(['create', payload]);
            },
          },
        },
      },
    },
    sdk: {
      Client: class {},
      WSClient: class {},
    },
  });

  await client.replyText({ messageId: 'om_1', chatId: 'oc_1' }, '# hello\nworld');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'reply');
  assert.equal(calls[0][1].path.message_id, 'om_1');
  assert.equal(calls[0][1].data.msg_type, 'text');
  const content = JSON.parse(calls[0][1].data.content);
  assert.equal(content.text, '# hello\n\nworld');
});

test('FeishuClient.replyText keeps angle brackets in stack traces', async () => {
  const calls = [];
  const client = new FeishuClient({ appId: 'app', appSecret: 'secret', allowedUserIds: [] }, {
    apiClient: {
      im: {
        v1: {
          message: {
            async reply(payload) {
              calls.push(payload);
            },
          },
        },
      },
    },
    sdk: {
      Client: class {},
      WSClient: class {},
    },
  });

  await client.replyText(
    { messageId: 'om_2', chatId: 'oc_2' },
    '处理失败：AxiosError\n    at async <anonymous> (/tmp/file.ts:1:1)',
  );

  const content = JSON.parse(calls[0].data.content);
  assert.equal(content.text.includes('<anonymous>'), true);
});
