# im-agent-bridge

[简体中文](./README.zh-CN.md) | [English](./README.md)

A TypeScript service that bridges `DingTalk` / `Feishu` / `Telegram` messages to local AI CLIs (such as `codex` and `claude`).

## Features

- Supports 1:1 chat integration for `dingtalk`, `feishu`, and `telegram`
- Supports multiple local agent CLIs and runtime switching via `/use <agent>`
- Supports streaming replies and automatic long-message chunking
- Isolates sessions per user while preserving provider sessions for continuation
- Includes whitelist control, deduplication, and debug logs
- Supports image input on DingTalk/Feishu (single image, `codex` only)
- Includes `doctor`, `setup`, and `service` commands for operations

## Support Matrix

| Platform | Supported Agents | Supported Capabilities |
| --- | --- | --- |
| DingTalk | `codex`, `claude` (and any configured local CLI) | 1:1 text chat, `/help` `/new` `/use` `/set_working_dir` `/status` `/interrupt`, streaming replies, chunked long replies, whitelist, dedupe, debug logs, single-image input (`codex` only) |
| Feishu | `codex`, `claude` (and any configured local CLI) | 1:1 text chat, `/help` `/new` `/use` `/set_working_dir` `/status` `/interrupt`, streaming replies, chunked long replies, whitelist, dedupe, debug logs, single-image input (`codex` only) |
| Telegram | `codex`, `claude` (and any configured local CLI) | 1:1 text chat, `/help` `/new` `/use` `/set_working_dir` `/status` `/interrupt`, streaming replies, chunked long replies, whitelist, dedupe, debug logs, `poll`/`webhook` modes (image input not supported yet) |

## Requirements

- Node.js `>= 20`
- Target local AI CLI installed and executable (for example `codex` or `claude`)

## Installation

### Option A: Global npm install (recommended)

```bash
npm i -g im-agent-bridge
im-agent-bridge --help
```

### Option B: Run from source

```bash
npm install
npm run dev -- --help
```

## Quick Start

Default config path: `~/.im-agent-bridge/config.toml`

```bash
# 1) Generate config (will not overwrite existing file)
im-agent-bridge setup

# 2) Run local checks
im-agent-bridge doctor

# 3) Start service in foreground
im-agent-bridge serve

# 4) Start background service (macOS, first run installs + starts)
im-agent-bridge service install --config ~/.im-agent-bridge/config.toml
```

When you see `[serve] <platform> client connected`, the platform connection is ready.

`im-agent-bridge serve` runs in foreground and occupies the current terminal (`Ctrl + C` to stop).

## Run in Background

### macOS (built-in `launchd` support)

```bash
# global install usage (recommended)
# first time: install and start background service
im-agent-bridge service install --config ~/.im-agent-bridge/config.toml

# later runs: start already installed background service
im-agent-bridge service start

# check status / logs
im-agent-bridge service status
im-agent-bridge service logs --lines 120

# run from source (build first)
npm run build
# first time: install and start background service
node dist/cli.js service install --config ~/.im-agent-bridge/config.toml

# later runs: start already installed background service
node dist/cli.js service start

# check status / logs
node dist/cli.js service status
node dist/cli.js service logs --lines 120
```

### Linux / other Unix-like environments (manual background run)

```bash
nohup im-agent-bridge serve --config ~/.im-agent-bridge/config.toml \
  > ~/.im-agent-bridge/serve.log 2>&1 &
```

For long-running production deployments on Linux, prefer `systemd` or `pm2`.

## Configuration

Use `config.example.toml` as reference. Minimum required fields:

- `platform.kind`: `dingtalk` / `feishu` / `telegram`
- `<platform>.*`: platform credentials (for example DingTalk `client_id` and `client_secret`)
- `<platform>.allowed_user_ids`: whitelist (`[]` means allow all)
- `bridge.default_agent`: default agent
- `bridge.working_dir`: default working directory
- `agents.<name>.bin`: local executable path or command name
- `agents.<name>.<ENV_NAME>`: add environment variables directly under the agent section, useful for `CODEX_HOME`, `OPENAI_API_KEY`, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_AUTH_TOKEN`.

Common optional fields:

- `bridge.reply_mode`: `stream` (default) / `final_only`
- `bridge.reply_chunk_chars`: chunk size for long replies
- `bridge.image_enabled`, `bridge.image_max_mb`: image input controls
- `bridge.debug`: debug logs (or set `IAB_DEBUG=1`)

## CLI Commands

```bash
im-agent-bridge --help
im-agent-bridge setup [--config <path>]
im-agent-bridge doctor [--config <path>] [--remote]
im-agent-bridge serve [--config <path>]
im-agent-bridge service [install|start|stop|restart|status|logs|uninstall]
```

Extra flags for `service`:

- `--label <value>`: custom `launchd` label
- `--keepawake none|idle|system|on_ac`: only for `service install`
- `--lines <number>`: only for `service logs`
- Note: `service` subcommands are only supported on macOS.
- Note: `launchd` does not inherit environment variables from your interactive shell.
- If `codex` / `claude` works in foreground but fails in background, add the required environment variables directly under `[agents.codex]` and `[agents.claude]`.
- Prefer setting each CLI's config directory and gateway variables explicitly instead of relying on shell `export`s.
- Recommended for `codex` in background mode: `CODEX_HOME`, `OPENAI_API_KEY`
- Recommended for `claude` in background mode: `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`
- Do not set `HOME` to `~/.codex` or `~/.claude`; that points the CLI at the wrong config root.

```toml
[agents.codex]
bin = "codex"
CODEX_HOME = "/Users/yourname/.codex"
OPENAI_API_KEY = "sk-..."

[agents.claude]
bin = "claude"
CLAUDE_CONFIG_DIR = "/Users/yourname/.claude"
ANTHROPIC_BASE_URL = "https://api-ai-cn.pingpongx.com"
ANTHROPIC_AUTH_TOKEN = "sk-..."
```

## Chat Commands

Available in IM chat:

- `/help`: show help
- `/new`: create a new logical session
- `/use codex`: switch current agent
- `/set_working_dir ~/workspace/project-a`: set working directory for current session
- `/status`: show current session / agent / working dir state
- `/interrupt`: interrupt the current running model task

You can send plain text directly to get replies.

## Telegram Notes

- `telegram.mode` supports `poll` and `webhook`
- `poll` is good for local quick usage
- `webhook` requires a public HTTPS `telegram.webhook_url`
- You can auto-clear webhook when switching back to `poll`

## Troubleshooting

- No reply: run `im-agent-bridge doctor --remote` first
- Permission denied: verify sender ID is included in `allowed_user_ids`
- Agent unavailable: ensure `agents.<name>.bin` is executable from terminal
- Telegram webhook not receiving updates: verify public URL reachability and `webhook_path` match
- Stops receiving after lock/close lid: verify the machine has not entered sleep

## Development

```bash
npm run dev -- serve --config ~/.im-agent-bridge/config.toml
npm run doctor -- --config ~/.im-agent-bridge/config.toml --remote
npm test
npm run build
node dist/cli.js serve --config ~/.im-agent-bridge/config.toml
```

## Project Structure

- `src/cli.ts`: CLI entrypoint
- `src/bridge/`: core bridge logic
- `src/client/`: IM platform client implementations
- `src/agent/`: agent CLI abstraction and implementations
- `src/config/`: config loading, normalization, and validation
- `src/storage/`: session / dedupe / logger backends
