import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentCommandSpec } from '../src/agent';
import {
  parseClaudeLine,
  parseCodexLine,
} from '../src/agent/internal';

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

test('buildAgentCommandSpec uses configured binaries and flags', () => {
  const config = {
    agents: {
      claude: { bin: '/bin/claude', model: 'model-a', extraArgs: ['--foo'] },
      codex: { bin: '/bin/codex', model: 'model-b', extraArgs: ['--bar'] },
    },
  };

  const claude = buildAgentCommandSpec(config, 'claude', 'prompt', '/tmp/work', 'session-1');
  assert.equal(claude.command, '/bin/claude');
  assert.equal(claude.args.includes('--resume'), true);

  const codex = buildAgentCommandSpec(config, 'codex', 'prompt', '/tmp/work', 'session-2');
  assert.deepEqual(codex.args.slice(0, 5), ['exec', 'resume', 'session-2', '--json', '--full-auto']);
});
