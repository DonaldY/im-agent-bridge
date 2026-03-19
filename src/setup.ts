import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, fileExists } from './utils.js';

const FALLBACK_CONFIG_TEMPLATE = `[platform]
kind = "dingtalk"

[dingtalk]
client_id = "dingxxxxxxxxxxxxxxxx"
client_secret = "xxxxxxxxxxxxxxxxxxxxxxxx"
robot_code = "dingxxxxxxxxxxxxxxxx"
allowed_user_ids = []

[feishu]
app_id = "cli_xxxxxxxxxxxxxxxx"
app_secret = "xxxxxxxxxxxxxxxxxxxxxxxx"
allowed_user_ids = []

[telegram]
bot_token = "123456789:your_bot_token"
allowed_user_ids = []
api_base = "https://api.telegram.org"
mode = "poll"
poll_timeout_seconds = 20
clear_webhook_on_start = true
webhook_listen_host = "127.0.0.1"
webhook_port = 8080
webhook_path = "/telegram/webhook"
health_path = "/healthz"
webhook_url = "https://example.com/telegram/webhook"
webhook_secret_token = "change-me"
drop_pending_updates = false

[bridge]
default_agent = "codex"
working_dir = "~/workspace"
debug = false
reply_chunk_chars = 1500
reply_mode = "stream"
dedupe_ttl_ms = 600000

[network]
proxy_url = ""
no_proxy = ""

[agents]
enabled = ["codex", "claude", "neovate", "opencode"]

[agents.codex]
bin = "codex"
model = ""
extra_args = []

[agents.claude]
bin = "claude"
model = ""
extra_args = []

[agents.neovate]
bin = "neovate"
model = ""
extra_args = []

[agents.opencode]
bin = "opencode"
model = ""
extra_args = []
`;

function exampleConfigPath(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(modulePath), '..');
  return path.join(projectRoot, 'config.example.toml');
}

async function readTemplate(): Promise<string> {
  const sourcePath = exampleConfigPath();
  if (await fileExists(sourcePath)) {
    return fs.readFile(sourcePath, 'utf8');
  }
  return FALLBACK_CONFIG_TEMPLATE;
}

export async function runSetup(configPath: string): Promise<string> {
  const targetPath = path.resolve(configPath);
  if (await fileExists(targetPath)) {
    return [
      `[setup] config already exists: ${targetPath}`,
      '[setup] next: edit this file, then run `im-agent-bridge doctor`',
    ].join('\n');
  }

  const template = await readTemplate();
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, template, 'utf8');

  return [
    `[setup] config created: ${targetPath}`,
    '[setup] next: edit this file, then run `im-agent-bridge doctor`',
  ].join('\n');
}
