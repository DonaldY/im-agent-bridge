# im-agent-bridge

[简体中文](./README.zh-CN.md) | [English](./README.md)

将 `DingTalk` / `Feishu` / `Telegram` 的消息桥接到本地 AI CLI（如 `codex`、`claude`）的 TypeScript 服务。

## Features

- 支持三大 IM 平台单聊消息接入：`dingtalk`、`feishu`、`telegram`
- 支持多 Agent CLI 调用与切换：`/use <agent>`
- 支持流式回复与长文本自动分段
- 支持会话隔离：每位用户独立 session，保留 provider session 续聊
- 支持权限与稳定性能力：白名单、消息去重、调试日志
- 支持图片输入（飞书/钉钉，单图；仅 `codex` agent）
- 提供 `doctor`、`setup`、`service` 等运维命令

## Support Matrix

| 平台 | 支持 Agent | 支持功能 |
| --- | --- | --- |
| DingTalk | `codex`、`claude`（及你配置的本地 CLI） | 单聊文本、`/help` `/new` `/use` `/set_working_dir` `/status` `/interrupt`、流式回复、长文本分段、白名单、去重、调试日志、单图输入（仅 `codex`） |
| Feishu | `codex`、`claude`（及你配置的本地 CLI） | 单聊文本、`/help` `/new` `/use` `/set_working_dir` `/status` `/interrupt`、流式回复、长文本分段、白名单、去重、调试日志、单图输入（仅 `codex`） |
| Telegram | `codex`、`claude`（及你配置的本地 CLI） | 单聊文本、`/help` `/new` `/use` `/set_working_dir` `/status` `/interrupt`、流式回复、长文本分段、白名单、去重、调试日志、`poll`/`webhook` 模式（当前不支持图片输入） |

## Requirements

- Node.js `>= 20`
- 已安装并可执行目标 Agent CLI（如 `codex`、`claude`）

## Installation

### Option A: npm 全局安装（推荐）

```bash
npm i -g im-agent-bridge
im-agent-bridge --help
```

### Option B: 本地源码运行

```bash
npm install
npm run dev -- --help
```

## Quick Start

默认配置文件路径：`~/.im-agent-bridge/config.toml`

```bash
# 1) 生成配置（已存在则不覆盖）
im-agent-bridge setup

# 2) 本地检查
im-agent-bridge doctor

# 3) 前台启动服务
im-agent-bridge serve

# 4) 后台启动服务（macOS，首次会自动安装并启动）
im-agent-bridge service install --config ~/.im-agent-bridge/config.toml
```

当看到日志 `[serve] <platform> client connected` 时，表示平台连接成功。

`im-agent-bridge serve` 为前台运行，会占用当前终端（`Ctrl + C` 停止）。

## 后台运行

### macOS（内置 `launchd` 托管）

```bash
# 全局安装场景（推荐）
# 首次：安装并启动后台服务
im-agent-bridge service install --config ~/.im-agent-bridge/config.toml

# 后续：仅启动已安装的后台服务
im-agent-bridge service start

# 查看状态 / 日志
im-agent-bridge service status
im-agent-bridge service logs --lines 120

# 源码运行场景（需要先构建）
npm run build
# 首次：安装并启动后台服务
node dist/cli.js service install --config ~/.im-agent-bridge/config.toml

# 后续：仅启动已安装的后台服务
node dist/cli.js service start

# 查看状态 / 日志
node dist/cli.js service status
node dist/cli.js service logs --lines 120
```

### Linux / 其他类 Unix 环境（手动后台运行）

```bash
nohup im-agent-bridge serve --config ~/.im-agent-bridge/config.toml \
  > ~/.im-agent-bridge/serve.log 2>&1 &
```

Linux 生产部署建议优先使用 `systemd` 或 `pm2`。

## Configuration

可参考 `config.example.toml` 进行配置，最少需要关注：

- `platform.kind`：`dingtalk` / `feishu` / `telegram`
- `<platform>.*`：对应平台凭证（如钉钉 `client_id`、`client_secret`）
- `<platform>.allowed_user_ids`：白名单（留空 `[]` 则默认全开）
- `bridge.default_agent`：默认 agent
- `bridge.working_dir`：默认工作目录
- `agents.<name>.bin`：本机可执行 CLI 路径或命令名
- `agents.<name>.<ENV_NAME>`：直接在 agent 段下追加环境变量，适合配置 `CODEX_HOME`、`OPENAI_API_KEY`、`CLAUDE_CONFIG_DIR`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`

可选常用项：

- `bridge.reply_mode`：`stream`（默认）/ `final_only`
- `bridge.reply_chunk_chars`：长文本分段长度
- `bridge.image_enabled`、`bridge.image_max_mb`：图片能力控制
- `bridge.debug`：调试日志（也可通过 `IAB_DEBUG=1`）

## CLI Commands

```bash
im-agent-bridge --help
im-agent-bridge setup [--config <path>]
im-agent-bridge doctor [--config <path>] [--remote]
im-agent-bridge serve [--config <path>]
im-agent-bridge service [install|start|stop|restart|status|logs|uninstall]
```

`service` 额外参数：

- `--label <value>`：自定义 `launchd` label
- `--keepawake none|idle|system|on_ac`：仅 `service install` 可用
- `--lines <number>`：仅 `service logs` 可用
- 注意：`service` 子命令仅支持 macOS。
- 注意：`launchd` 不会继承你当前终端里的 shell 环境变量。
- 如果 `codex` / `claude` 前台可用、后台缺少凭证，请直接在 `[agents.codex]`、`[agents.claude]` 下追加对应环境变量。
- 推荐显式指定各自的配置目录与网关变量，不要只依赖 shell 里的 `export`。
- `codex` 后台模式建议至少配置：`CODEX_HOME`、`OPENAI_API_KEY`
- `claude` 后台模式建议至少配置：`CLAUDE_CONFIG_DIR`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`
- 不建议把 `HOME` 写成 `~/.codex` 或 `~/.claude`；否则 CLI 会找错配置目录。

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

在 IM 聊天窗口中可使用：

- `/help`：查看帮助
- `/new`：新建逻辑会话
- `/use codex`：切换当前 agent
- `/set_working_dir ~/workspace/project-a`：设置当前会话工作目录
- `/status`：查看当前 session / agent / working dir 等状态
- `/interrupt`：中断当前正在执行的模型任务

直接发送文本即可获得回复。

## Telegram Notes

- `telegram.mode` 支持 `poll` 与 `webhook`
- `poll` 适合本地快速使用
- `webhook` 需要公网 HTTPS `telegram.webhook_url`
- 若从 `webhook` 切回 `poll`，可配置自动清理 webhook

## Troubleshooting

- 无回复：先执行 `im-agent-bridge doctor --remote`
- 无权限：检查 `allowed_user_ids` 是否包含发送者 ID
- agent 不可用：确认 `agents.<name>.bin` 在终端可直接执行
- Telegram webhook 不生效：确认公网地址可达且路径与 `webhook_path` 一致
- 锁屏/合盖后收不到：优先确认机器未进入睡眠状态

## Development

```bash
npm run dev -- serve --config ~/.im-agent-bridge/config.toml
npm run doctor -- --config ~/.im-agent-bridge/config.toml --remote
npm test
npm run build
node dist/cli.js serve --config ~/.im-agent-bridge/config.toml
```

## Project Structure

- `src/cli.ts`：CLI 入口
- `src/bridge/`：消息桥接核心逻辑
- `src/client/`：IM 平台客户端实现
- `src/agent/`：Agent CLI 抽象与实现
- `src/config/`：配置加载、归一化、校验
- `src/storage/`：session / dedupe / logger 存储后端
