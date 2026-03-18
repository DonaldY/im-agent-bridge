import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentCommandSpec } from '../src/agent/index.js';
import {
  parseClaudeLine,
  parseCodexLine,
  parseNeovateLine,
  parseOpencodeLine,
} from '../src/agent/internal.js';

test('parseClaudeLine handles stream-json output', () => {
  const state = {};
  assert.deepEqual(
    parseClaudeLine('{"type":"system","subtype":"init","session_id":"s1"}', state),
    [{ type: 'session_started', sessionId: 's1' }],
  );

  assert.deepEqual(
    parseClaudeLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}}', state),
    [{ type: 'partial_text', text: 'OK' }],
  );
});

test('parseCodexLine handles jsonl output', () => {
  const state = {};
  assert.deepEqual(
    parseCodexLine('{"type":"thread.started","thread_id":"t1"}', state),
    [{ type: 'session_started', sessionId: 't1' }],
  );

  assert.deepEqual(
    parseCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"Hello"}}', state),
    [{ type: 'partial_text', text: 'Hello' }],
  );
});

test('parseNeovateLine handles result output', () => {
  const state = {};
  assert.deepEqual(
    parseNeovateLine('{"type":"system","subtype":"init","sessionId":"n1"}', state),
    [{ type: 'session_started', sessionId: 'n1' }],
  );

  assert.deepEqual(
    parseNeovateLine('{"type":"result","subtype":"success","content":"Done"}', state),
    [{ type: 'final_text', text: 'Done' }],
  );
});

test('parseOpencodeLine handles text aggregation', () => {
  const state = {};
  assert.deepEqual(
    parseOpencodeLine('{"type":"step_start","sessionID":"o1"}', state),
    [{ type: 'session_started', sessionId: 'o1' }],
  );

  assert.deepEqual(
    parseOpencodeLine('{"type":"text","part":{"type":"text","text":"Hi"}}', state),
    [{ type: 'partial_text', text: 'Hi' }],
  );
});

test('buildAgentCommandSpec uses configured binaries and flags', () => {
  const config = {
    agents: {
      claude: { bin: '/bin/claude', model: 'model-a', extraArgs: ['--foo'] },
      codex: { bin: '/bin/codex', model: 'model-b', extraArgs: ['--bar'] },
      neovate: { bin: '/bin/neovate', model: 'model-c', extraArgs: ['--baz'] },
      opencode: { bin: '/bin/opencode', model: 'model-d', extraArgs: ['--qux'] },
    },
  };

  const claude = buildAgentCommandSpec(config, 'claude', 'prompt', '/tmp/work', 'session-1');
  assert.equal(claude.command, '/bin/claude');
  assert.equal(claude.args.includes('--resume'), true);

  const codex = buildAgentCommandSpec(config, 'codex', 'prompt', '/tmp/work', 'session-2');
  assert.deepEqual(codex.args.slice(0, 5), ['exec', 'resume', 'session-2', '--json', '--full-auto']);

  const neovate = buildAgentCommandSpec(config, 'neovate', 'prompt', '/tmp/work', null);
  assert.equal(neovate.args.includes('--cwd'), true);

  const opencode = buildAgentCommandSpec(config, 'opencode', 'prompt', '/tmp/work', 'session-3');
  assert.equal(opencode.args.includes('--session'), true);
});
