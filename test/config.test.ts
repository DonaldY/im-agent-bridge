import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config/index.js';

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
