# im-agent-bridge 发布安装手册（傻瓜版）

这份文档给项目维护者使用：目标是把当前项目发布到 npm，让别人可以直接安装。

## 0. 一次性准备

### 0.1 环境要求

- Node.js >= 20
- npm 可用（建议 npm 10+）
- 已有 npm 账号（https://www.npmjs.com/）

### 0.2 切到 npm 官方源（非常重要）

很多机器默认不是 npm 官方源，先执行：

```bash
npm config set registry https://registry.npmjs.org/
npm config get registry
```

看到输出是 `https://registry.npmjs.org/` 再继续。

### 0.3 登录 npm

```bash
npm login
```

按提示输入用户名、密码、邮箱、验证码。

---

## 1. 首次发布（第一次发包）

在项目根目录执行以下步骤。

### 步骤 1：确认包名是否可用

```bash
npm view im-agent-bridge name
```

- 如果返回包信息：说明名字已被占用，请先改 `package.json` 里的 `name`。
- 如果报 `E404`：通常表示该包名尚未发布，可以继续。

### 步骤 2：安装依赖

```bash
npm install
```

### 步骤 3：运行测试

```bash
npm test
```

### 步骤 4：构建产物

```bash
npm run build
```

构建后必须有 `dist/cli.js`，因为 npm 包的可执行入口是这个文件。

### 步骤 5：发布

```bash
npm publish --access public
```

发布成功后，记下终端里显示的版本号。

### 步骤 6：验证发布是否成功

```bash
npm view im-agent-bridge version
```

看到刚发布的版本号就说明成功。

---

## 2. 日常更新发布（第二次及以后）

每次发新版本按下面顺序执行。

### 步骤 1：升级版本号

三选一：

```bash
npm version patch
# 或 npm version minor
# 或 npm version major
```

### 步骤 2：重新测试 + 构建

```bash
npm test
npm run build
```

### 步骤 3：发布新版本

```bash
npm publish --access public
```

### 步骤 4：确认线上版本

```bash
npm view im-agent-bridge version
```

---

## 3. 给使用者的安装命令（可直接发给别人）

```bash
npm i -g im-agent-bridge
im-agent-bridge --help
```

推荐首次使用按下面顺序执行：

```bash
im-agent-bridge setup
im-agent-bridge doctor
im-agent-bridge serve
```

如果希望后台启动：

```bash
im-agent-bridge service
```

- 已安装过服务：等价于 `im-agent-bridge service start`
- 首次使用：自动执行安装并启动（等价于 `im-agent-bridge service install`）
- 停止服务：使用 `im-agent-bridge service stop`

如果要临时使用，不全局安装也可以：

```bash
npx im-agent-bridge --help
```

---

## 4. 常见报错速查

- `402 Payment Required`：通常是作用域包发布权限或组织套餐问题。
- `403 Forbidden`：可能没登录对账号，或没有发布该包权限。
- `You cannot publish over the previously published versions`：版本号没升级。
- `command not found: im-agent-bridge`：全局安装后 shell 缓存未刷新，重开终端或执行 `hash -r`。

---

## 5. 一条龙命令（熟悉后可用）

```bash
npm config set registry https://registry.npmjs.org/ && npm install && npm test && npm run build && npm version patch && npm publish --access public
```

建议先按上面的分步流程跑通，再使用一条龙命令。
