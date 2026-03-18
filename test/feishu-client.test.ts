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

test('FeishuClient.replyText replies by message id with post payload', async () => {
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
  assert.equal(calls[0][1].data.msg_type, 'post');
  const content = JSON.parse(calls[0][1].data.content);
  assert.equal(content.post.zh_cn.title, 'hello');
  assert.equal(content.post.zh_cn.content[0][0].text, '# hello');
  assert.equal(content.post.zh_cn.content[1][0].text, ' ');
  assert.equal(content.post.zh_cn.content[2][0].text, 'world');
});
