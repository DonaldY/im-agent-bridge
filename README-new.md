# im-agent-bridge（简版）

一个把钉钉 / 飞书 / Telegram 消息转发给本地 AI CLI（如 codex、claude）的桥接服务。

## 1) 下载

推荐直接安装 npm 包：

```bash
npm i -g im-agent-bridge
```

安装后验证：

```bash
im-agent-bridge --help
```

---

## 2) 使用（最少命令）

`im-agent-bridge` 默认读取配置文件：`~/.im-agent-bridge/config.toml`。

### 第一步：自动生成配置文件

```bash
im-agent-bridge setup
```

默认会在 `~/.im-agent-bridge/config.toml` 生成配置文件（已存在则不会覆盖）。

如需自定义路径：

```bash
im-agent-bridge setup --config /path/to/config.toml
```

至少要改这些内容：

- `platform.kind`：`dingtalk` / `feishu` / `telegram`
- 对应平台凭证（如钉钉 `client_id`、`client_secret`）
- `allowed_user_ids`：允许访问机器人的用户 ID（留空 `[]` 则默认全开）
- `bridge.default_agent`：默认 agent（如 `codex`）
- `agents.<name>.bin`：本机可执行命令（如 `codex`、`claude`）

### 第二步：做一次检查

```bash
im-agent-bridge doctor
```

### 第三步：启动服务

```bash
im-agent-bridge serve
```

看到 `[serve] <platform> client connected` 即启动成功。

### 支持命令（统一入口）

```bash
im-agent-bridge --help
im-agent-bridge setup
im-agent-bridge doctor
im-agent-bridge serve
im-agent-bridge service
```

- `im-agent-bridge service` 为后台启动快捷命令：
  - 已安装过服务：等价于 `im-agent-bridge service start`
  - 首次使用：自动执行安装并启动（等价于 `im-agent-bridge service install`）
  - 停止服务：使用 `im-agent-bridge service stop`

---

## 3) 在聊天里怎么用

- `/help`：查看帮助
- `/new`：新建会话
- `/use codex`：切换 agent
- `/set_working_dir ~/workspace/project-a`：设置工作目录
- `/status`：查看当前状态
- `/interrupt`：中断当前执行

直接发送普通文本消息即可得到回复。

飞书/钉钉还支持单图输入（每轮最多 1 张，格式：`image/png`、`image/jpeg`、`image/webp`、`image/gif`，默认最大 `20MB`）。

---

## 4) 常用排障

- 无回复：先执行 `im-agent-bridge doctor --remote`
- 无权限：若配置了 `allowed_user_ids`，检查发送者是否在白名单；留空 `[]` 时不会校验
- agent 找不到：检查 `agents.<name>.bin` 是否能在终端直接运行

---

## 5) 给新同事的“2 条命令版”

前提：配置文件已准备好。

```bash
npm i -g im-agent-bridge
im-agent-bridge serve
```
