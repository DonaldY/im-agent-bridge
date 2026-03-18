import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToml } from '../src/toml.js';

test('parseToml parses nested sections and arrays', () => {
  const result = parseToml(`
[platform]
kind = "dingtalk"

[dingtalk]
allowed_user_ids = ["u1", "u2"]

[bridge]
reply_chunk_chars = 1500
`);

  assert.deepEqual(result, {
    platform: { kind: 'dingtalk' },
    dingtalk: { allowed_user_ids: ['u1', 'u2'] },
    bridge: { reply_chunk_chars: 1500 },
  });
});

