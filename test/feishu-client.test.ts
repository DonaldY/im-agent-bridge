import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { FeishuClient, normalizeFeishuMessage } from '../src/client/feishu-client';

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

test('normalizeFeishuMessage parses image event', () => {
  const message = normalizeFeishuMessage({
    sender: {
      sender_id: {
        user_id: 'ou_user',
      },
    },
    message: {
      message_id: 'om_image',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      message_type: 'image',
      content: JSON.stringify({ image_key: 'img_v2_123' }),
    },
  });

  assert.equal(message.text, '');
  assert.equal(message.images.length, 1);
  assert.equal(message.images[0].fileKey, 'img_v2_123');
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

test('FeishuClient.downloadImage reads resource stream', async () => {
  const client = new FeishuClient({ appId: 'app', appSecret: 'secret', allowedUserIds: [] }, {
    apiClient: {
      im: {
        v1: {
          messageResource: {
            async get(payload) {
              assert.equal(payload.path.message_id, 'om_1');
              assert.equal(payload.path.file_key, 'img_1');
              return {
                headers: {
                  'content-type': 'image/png',
                  'content-length': '4',
                },
                getReadableStream() {
                  return Readable.from([Buffer.from('test')]);
                },
              };
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

  const result = await client.downloadImage(
    { platform: 'feishu', userId: 'u1', text: '', messageId: 'om_1', replyContext: { platform: 'feishu' } },
    { fileKey: 'img_1' },
    { maxBytes: 20 },
  );

  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.sizeBytes, 4);
  assert.equal(result.buffer.toString('utf8'), 'test');
});

test('FeishuClient.sendImage uploads image then replies with image payload', async () => {
  const requests = [];
  const calls = [];
  const client = new FeishuClient({ appId: 'app', appSecret: 'secret', allowedUserIds: [] }, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).includes('/tenant_access_token/internal')) {
        return {
          ok: true,
          json: async () => ({ tenant_access_token: 'tenant-token', expire: 7200 }),
        };
      }

      return {
        ok: true,
        json: async () => ({ code: 0, data: { image_key: 'img_v2_uploaded' } }),
      };
    },
    apiClient: {
      im: {
        v1: {
          message: {
            async reply(payload) {
              calls.push(payload);
              return { data: { message_id: 'om_reply_image' } };
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

  const sent = await client.sendImage(
    { platform: 'feishu', chatId: 'oc_1', messageId: 'om_source' },
    {
      kind: 'image',
      buffer: Buffer.from('fake-image'),
      fileName: 'chart.png',
      sizeBytes: 10,
      mimeType: 'image/png',
    },
  );

  assert.equal(requests.length, 2);
  assert.match(String(requests[1].url), /\/im\/v1\/images$/u);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.msg_type, 'image');
  assert.equal(JSON.parse(calls[0].data.content).image_key, 'img_v2_uploaded');
  assert.equal(sent.messageId, 'om_reply_image');
});

test('FeishuClient.sendFile uploads file then creates file message', async () => {
  const requests = [];
  const calls = [];
  const client = new FeishuClient({ appId: 'app', appSecret: 'secret', allowedUserIds: [] }, {
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).includes('/tenant_access_token/internal')) {
        return {
          ok: true,
          json: async () => ({ tenant_access_token: 'tenant-token', expire: 7200 }),
        };
      }

      return {
        ok: true,
        json: async () => ({ code: 0, data: { file_key: 'file_uploaded_1' } }),
      };
    },
    apiClient: {
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
              return { data: { message_id: 'om_file_1' } };
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

  const sent = await client.sendFile(
    { platform: 'feishu', chatId: 'oc_2' },
    {
      kind: 'file',
      buffer: Buffer.from('fake-file'),
      fileName: 'report.csv',
      sizeBytes: 9,
      mimeType: 'text/csv',
    },
  );

  assert.equal(requests.length, 2);
  assert.match(String(requests[1].url), /\/im\/v1\/files$/u);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.msg_type, 'file');
  assert.equal(JSON.parse(calls[0].data.content).file_key, 'file_uploaded_1');
  assert.equal(calls[0].data.receive_id, 'oc_2');
  assert.equal(sent.messageId, 'om_file_1');
});
