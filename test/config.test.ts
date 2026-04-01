import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, resolveAgentEnvironment } from '../src/config';

test('loadConfig reads dingtalk config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"
allowed_user_ids = ["user-1"]

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"
debug = true

[agents]
enabled = ["codex", "claude"]
`, 'utf8');

  const config = await loadConfig(configPath);

  assert.equal(config.platform.kind, 'dingtalk');
  assert.equal(config.dingtalk.clientId, 'cid');
  assert.equal(config.bridge.defaultAgent, 'codex');
  assert.equal(config.bridge.debug, true);
  assert.equal(config.bridge.imageEnabled, true);
  assert.equal(config.bridge.imageMaxMb, 20);
  assert.deepEqual(config.agents.enabled, ['codex', 'claude']);
  assert.deepEqual(config.agents.codex.env, {});
});

test('loadConfig reads per-agent env for codex and claude', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"

[agents]
enabled = ["codex", "claude"]

[agents.codex]
bin = "codex"
HOME = "/Users/demo"
OPENAI_API_KEY = "sk-demo"

[agents.claude]
bin = "claude"
HOME = "/Users/demo"
ANTHROPIC_API_KEY = "ak-demo"
USE_BEDROCK = true
MAX_TURNS = 3
`, 'utf8');

  const config = await loadConfig(configPath);

  assert.deepEqual(config.agents.codex.env, {
    HOME: '/Users/demo',
    OPENAI_API_KEY: 'sk-demo',
  });
  assert.deepEqual(config.agents.claude.env, {
    HOME: '/Users/demo',
    ANTHROPIC_API_KEY: 'ak-demo',
    USE_BEDROCK: 'true',
    MAX_TURNS: '3',
  });
});

test('loadConfig rejects unsupported agent env values', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"

[agents]
enabled = ["codex"]

[agents.codex]
BAD = ["oops"]
`, 'utf8');

  await assert.rejects(() => loadConfig(configPath), /agents.codex.BAD must be a string, number, or boolean/u);
});

test('resolveAgentEnvironment merges process env with agent env', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"

[agents]
enabled = ["codex"]

[agents.codex]
OPENAI_API_KEY = "sk-config"
HOME = "/Users/demo"
`, 'utf8');

  const previousPath = process.env.PATH;
  process.env.PATH = '/usr/bin:/bin';

  try {
    const config = await loadConfig(configPath);
    const env = resolveAgentEnvironment(config, 'codex');

    assert.equal(env.PATH, '/usr/bin:/bin');
    assert.equal(env.HOME, '/Users/demo');
    assert.equal(env.OPENAI_API_KEY, 'sk-config');
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});

test('resolveAgentEnvironment ignores empty agent env strings and falls back to process env', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"

[agents]
enabled = ["codex"]

[agents.codex]
OPENAI_API_KEY = ""
HOME = "   "
`, 'utf8');

  const previousHome = process.env.HOME;
  const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.HOME = '/Users/system-home';
  process.env.OPENAI_API_KEY = 'sk-from-shell';

  try {
    const config = await loadConfig(configPath);
    const env = resolveAgentEnvironment(config, 'codex');

    assert.equal(env.HOME, '/Users/system-home');
    assert.equal(env.OPENAI_API_KEY, 'sk-from-shell');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    }
  }
});

test('loadConfig reads bridge image config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"
image_enabled = false
image_max_mb = 8

[agents]
enabled = ["codex"]
`, 'utf8');

  const config = await loadConfig(configPath);
  assert.equal(config.bridge.imageEnabled, false);
  assert.equal(config.bridge.imageMaxMb, 8);
});

test('loadConfig rejects invalid bridge.image_max_mb', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"
image_max_mb = 0

[agents]
enabled = ["codex"]
`, 'utf8');

  await assert.rejects(() => loadConfig(configPath), /bridge.image_max_mb must be a positive number/u);
});

test('loadConfig allows empty dingtalk allowed_user_ids', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"
allowed_user_ids = []

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"

[agents]
enabled = ["codex"]
`, 'utf8');

  const config = await loadConfig(configPath);
  assert.deepEqual(config.dingtalk.allowedUserIds, []);
});

test('loadConfig enables debug via IAB_DEBUG even when config is false', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"
allowed_user_ids = ["user-1"]

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"
debug = false

[agents]
enabled = ["codex"]
`, 'utf8');

  const previous = process.env.IAB_DEBUG;
  process.env.IAB_DEBUG = '1';

  try {
    const config = await loadConfig(configPath);
    assert.equal(config.bridge.debug, true);
  } finally {
    if (previous === undefined) {
      delete process.env.IAB_DEBUG;
    } else {
      process.env.IAB_DEBUG = previous;
    }
  }
});

test('loadConfig enables debug in npm dev lifecycle by default', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "dingtalk"

[dingtalk]
client_id = "cid"
client_secret = "secret"
allowed_user_ids = ["user-1"]

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"
debug = false

[agents]
enabled = ["codex"]
`, 'utf8');

  const previousLifecycle = process.env.npm_lifecycle_event;
  const previousDebug = process.env.IAB_DEBUG;
  process.env.npm_lifecycle_event = 'dev';
  delete process.env.IAB_DEBUG;

  try {
    const config = await loadConfig(configPath);
    assert.equal(config.bridge.debug, true);
  } finally {
    if (previousLifecycle === undefined) {
      delete process.env.npm_lifecycle_event;
    } else {
      process.env.npm_lifecycle_event = previousLifecycle;
    }

    if (previousDebug === undefined) {
      delete process.env.IAB_DEBUG;
    } else {
      process.env.IAB_DEBUG = previousDebug;
    }
  }
});

test('loadConfig rejects default agent outside enabled agents', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[dingtalk]
client_id = "cid"
client_secret = "secret"
allowed_user_ids = ["user-1"]

[bridge]
default_agent = "claude"
working_dir = "${tempDir}"

[agents]
enabled = ["codex"]
`, 'utf8');

  await assert.rejects(() => loadConfig(configPath), /bridge.default_agent must be included in agents.enabled/u);
});

test('loadConfig reads feishu config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "feishu"

[feishu]
app_id = "cli_a"
app_secret = "secret_a"
allowed_user_ids = ["ou_123"]

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"

[agents]
enabled = ["codex"]
`, 'utf8');

  const config = await loadConfig(configPath);

  assert.equal(config.platform.kind, 'feishu');
  assert.equal(config.feishu.appId, 'cli_a');
  assert.deepEqual(config.feishu.allowedUserIds, ['ou_123']);
});

test('loadConfig reads telegram config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-config-'));
  const configPath = path.join(tempDir, 'config.toml');

  await fs.writeFile(configPath, `
[platform]
kind = "telegram"

[telegram]
bot_token = "123:abc"
allowed_user_ids = ["42"]
poll_timeout_seconds = 15
mode = "webhook"
webhook_port = 8081
webhook_path = "/bot/hook"
webhook_url = "https://example.com/bot/hook"

[bridge]
default_agent = "codex"
working_dir = "${tempDir}"

[agents]
enabled = ["codex"]
`, 'utf8');

  const config = await loadConfig(configPath);

  assert.equal(config.platform.kind, 'telegram');
  assert.equal(config.telegram.botToken, '123:abc');
  assert.equal(config.telegram.pollTimeoutSeconds, 15);
  assert.equal(config.telegram.mode, 'webhook');
  assert.equal(config.telegram.webhookPort, 8081);
  assert.equal(config.telegram.webhookPath, '/bot/hook');
  assert.equal(config.telegram.healthPath, '/healthz');
});
