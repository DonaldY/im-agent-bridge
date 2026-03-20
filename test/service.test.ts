import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLaunchAgentPlist,
  normalizeKeepAwakeMode,
  normalizeServiceLabel,
  parseLaunchctlPrint,
} from '../src/service/index.js';

test('normalizeKeepAwakeMode parses valid values', () => {
  assert.equal(normalizeKeepAwakeMode(undefined), 'none');
  assert.equal(normalizeKeepAwakeMode('idle'), 'idle');
  assert.equal(normalizeKeepAwakeMode('SYSTEM'), 'system');
  assert.equal(normalizeKeepAwakeMode('on_ac'), 'on_ac');
  assert.throws(() => normalizeKeepAwakeMode('invalid'), /keepawake/u);
});

test('normalizeServiceLabel validates and defaults', () => {
  assert.equal(normalizeServiceLabel(), 'com.im-agent-bridge.service');
  assert.equal(normalizeServiceLabel('com.demo.agent'), 'com.demo.agent');
  assert.throws(() => normalizeServiceLabel('bad label'), /service label/u);
});

test('buildLaunchAgentPlist uses node directly when keepawake is none', () => {
  const plist = buildLaunchAgentPlist({
    label: 'com.im-agent-bridge.service',
    nodePath: '/usr/local/bin/node',
    distCliPath: '/repo/dist/cli.js',
    configPath: '/Users/demo/.im-agent-bridge/config.toml',
    stdoutLogPath: '/Users/demo/.im-agent-bridge/logs/out.log',
    stderrLogPath: '/Users/demo/.im-agent-bridge/logs/err.log',
    keepAwake: 'none',
    pathValue: '/usr/bin:/bin',
    workingDir: '/repo',
  });

  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/u);
  assert.match(plist, /<string>serve<\/string>/u);
  assert.doesNotMatch(plist, /caffeinate/u);
});

test('buildLaunchAgentPlist wraps command with caffeinate when enabled', () => {
  const plist = buildLaunchAgentPlist({
    label: 'com.im-agent-bridge.service',
    nodePath: '/usr/local/bin/node',
    distCliPath: '/repo/dist/cli.js',
    configPath: '/Users/demo/.im-agent-bridge/config.toml',
    stdoutLogPath: '/Users/demo/.im-agent-bridge/logs/out.log',
    stderrLogPath: '/Users/demo/.im-agent-bridge/logs/err.log',
    keepAwake: 'system',
    pathValue: '/usr/bin:/bin',
    workingDir: '/repo',
    caffeinatePath: '/usr/bin/caffeinate',
  });

  assert.match(plist, /<string>\/usr\/bin\/caffeinate<\/string>/u);
  assert.match(plist, /<string>-i<\/string>/u);
  assert.match(plist, /<string>-m<\/string>/u);
  assert.match(plist, /<string>-s<\/string>/u);
});

test('parseLaunchctlPrint reads state and pid', () => {
  const parsed = parseLaunchctlPrint(`
    state = running
    last exit code = 0
    pid = 12345
  `);

  assert.equal(parsed.state, 'running');
  assert.equal(parsed.lastExitCode, 0);
  assert.equal(parsed.pid, 12345);
});
