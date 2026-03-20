import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BridgeFacade, buildHelpText } from '../src/bridge';
import { StateStore } from '../src/storage';

function createConfig(stateDir, workingDir) {
  return {
    stateDir,
    platform: { kind: 'dingtalk' },
    dingtalk: {
      clientId: 'cid',
      clientSecret: 'secret',
      allowedUserIds: ['u1'],
    },
    bridge: {
      defaultAgent: 'codex',
      workingDir,
      replyChunkChars: 20,
      replyMode: 'final_only',
      dedupeTtlMs: 60_000,
      imageEnabled: true,
      imageMaxMb: 20,
    },
    agents: {
      enabled: ['codex', 'claude'],
      codex: { bin: 'codex', extraArgs: [] },
      claude: { bin: 'claude', extraArgs: [] },
    },
  };
}

test('buildHelpText includes enabled agents', () => {
  const text = buildHelpText(createConfig('/tmp/state', '/tmp/work'));
  assert.match(text, /codex\|claude/u);
  assert.match(text, /set_working_dir/u);
  assert.match(text, /interrupt/u);
  assert.match(text, /image\/png/u);
});

test('BridgeFacade handles /use command', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();

  const replies = [];
  const config = createConfig(stateDir, workingDir);
  config.bridge.replyChunkChars = 500;

  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
  });

  await bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    messageId: 'm-use',
    text: '/use claude',
    replyContext: { sessionWebhook: 'https://example.com/hook', sessionWebhookExpiredTime: Date.now() + 60_000 },
  });

  assert.equal(store.getActiveSession('u1').activeAgent, 'claude');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /已切换当前 Agent/u);
  assert.match(replies[0], /当前 Agent：`claude`/u);
});

test('BridgeFacade handles prompt and saves provider session', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();
  await store.createSession('u1', 'codex', workingDir);

  const replies = [];
  const config = createConfig(stateDir, workingDir);
  config.bridge.replyChunkChars = 500;
  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
  }, {
    async *streamAgentTurnImpl() {
      yield { type: 'session_started', sessionId: 'up-1' };
      yield { type: 'final_text', text: 'done' };
    },
  });

  await bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    conversationId: 'cid',
    messageId: 'm-prompt',
    text: 'hello',
    replyContext: { sessionWebhook: 'https://example.com/hook', sessionWebhookExpiredTime: Date.now() + 60_000 },
  });

  const session = store.getActiveSession('u1');
  assert.equal(session.providerSessionIds.codex, 'up-1');
  assert.equal(session.providerWorkingDirs.codex, workingDir);
  assert.deepEqual(replies, ['🤖 已收到，正在思考中…', 'done']);
});

test('BridgeFacade deduplicates repeated messages', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();

  const replies = [];
  const bridge = new BridgeFacade(createConfig(stateDir, workingDir), store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
  }, {
    async *streamAgentTurnImpl() {
      yield { type: 'final_text', text: 'once' };
    },
  });

  const message = {
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    messageId: 'm-repeat',
    text: 'hello',
    replyContext: { sessionWebhook: 'https://example.com/hook', sessionWebhookExpiredTime: Date.now() + 60_000 },
  };

  await bridge.handleIncomingMessage(message);
  await bridge.handleIncomingMessage(message);

  assert.deepEqual(replies, ['🤖 已收到，正在思考中…', 'once']);
});

test('BridgeFacade allows all users when allowed_user_ids is empty', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();

  const replies = [];
  const config = createConfig(stateDir, workingDir);
  config.dingtalk.allowedUserIds = [];
  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
  }, {
    async *streamAgentTurnImpl() {
      yield { type: 'final_text', text: 'ok' };
    },
  });

  await bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'not-in-whitelist',
    conversationType: '1',
    messageId: 'm-empty-allowlist',
    text: 'hello',
    replyContext: { sessionWebhook: 'https://example.com/hook', sessionWebhookExpiredTime: Date.now() + 60_000 },
  });

  assert.deepEqual(replies, ['🤖 已收到，正在思考中…', 'ok']);
});

test('BridgeFacade handles /set_working_dir with quoted relative path', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const nextDir = path.join(workingDir, 'repo with spaces');
  await fs.mkdir(nextDir);

  const store = new StateStore(stateDir);
  await store.init();
  const session = await store.createSession('u1', 'codex', workingDir);
  session.providerSessionIds.codex = 'up-old';
  session.providerSessionIds.claude = 'claude-session';
  session.providerWorkingDirs.codex = workingDir;
  session.providerWorkingDirs.claude = workingDir;
  await store.saveSession(session);

  const replies = [];
  const config = createConfig(stateDir, workingDir);
  config.bridge.replyChunkChars = 500;

  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
  });

  await bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    messageId: 'm-set-dir',
    text: '/set_working_dir "repo with spaces"',
    replyContext: { sessionWebhook: 'https://example.com/hook', sessionWebhookExpiredTime: Date.now() + 60_000 },
  });

  const updated = store.getActiveSession('u1');
  assert.equal(updated.workingDir, nextDir);
  assert.equal(updated.providerSessionIds.codex, null);
  assert.equal(updated.providerSessionIds.claude, 'claude-session');
  const replyText = replies.join('\n');
  assert.match(replyText, /已更新工作目录/u);
  assert.match(replyText, new RegExp(nextDir.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('BridgeFacade interrupts active prompt with command', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();
  await store.createSession('u1', 'codex', workingDir);

  const replies = [];
  const config = createConfig(stateDir, workingDir);
  config.bridge.replyChunkChars = 500;
  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
  }, {
    async *streamAgentTurnImpl({ abortSignal }) {
      yield { type: 'session_started', sessionId: 'up-1' };
      await new Promise((resolve) => abortSignal.addEventListener('abort', resolve, { once: true }));
    },
  });

  const promptTask = bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    conversationId: 'cid',
    messageId: 'm-prompt-abort',
    text: 'hello',
    replyContext: { sessionWebhook: 'https://example.com/hook', sessionWebhookExpiredTime: Date.now() + 60_000 },
  });

  for (let index = 0; index < 20 && bridge.activeRuns.size === 0; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  await bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    conversationId: 'cid',
    messageId: 'm-interrupt',
    text: '/interrupt',
    replyContext: { sessionWebhook: 'https://example.com/hook', sessionWebhookExpiredTime: Date.now() + 60_000 },
  });

  await promptTask;

  assert.equal(bridge.activeRuns.size, 0);
  assert.equal(store.getActiveSession('u1').providerSessionIds.codex, 'up-1');
  assert.equal(replies.length, 2);
  assert.equal(replies[0], '🤖 已收到，正在思考中…');
  assert.match(replies[1], /已中断当前会话任务/u);
  assert.match(replies[1], /Provider 会话：`up-1`/u);
});

test('BridgeFacade streams updates for editable clients', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();
  await store.createSession('u1', 'codex', workingDir);

  const calls = [];
  const config = createConfig(stateDir, workingDir);
  config.platform.kind = 'telegram';
  config.telegram = { allowedUserIds: ['u1'] };
  config.bridge.replyMode = 'stream';
  config.bridge.replyChunkChars = 500;

  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text, options) {
      calls.push(['reply', text, options?.mode]);
      return { platform: 'telegram', messageId: 'bot-1', chatId: 22 };
    },
    async updateText(_replyContext, message, text, options) {
      calls.push(['update', message.messageId, text, options?.mode]);
    },
    async sendTyping() {
      calls.push(['typing']);
    },
  }, {
    async *streamAgentTurnImpl() {
      yield { type: 'partial_text', text: '第一段，先来一点内容。'.repeat(12) };
      yield { type: 'final_text', text: '# 标题\n\n**最终完成**' };
    },
  });

  await bridge.handleIncomingMessage({
    platform: 'telegram',
    userId: 'u1',
    conversationType: 'private',
    conversationId: '22',
    messageId: 'm-stream',
    text: 'hello',
    replyContext: { platform: 'telegram', chatId: 22, replyToMessageId: 11 },
  });

  assert.equal(calls[0][0], 'typing');
  assert.deepEqual(calls[1], ['reply', '🤖 已收到，正在思考中…', 'ack']);
  assert.equal(calls[2][0], 'update');
  assert.equal(calls[2][3], 'progress');
  assert.deepEqual(calls.at(-1), ['update', 'bot-1', '# 标题\n\n**最终完成**', 'final']);
});

test('BridgeFacade rejects image when image input is disabled', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();

  const replies = [];
  const config = createConfig(stateDir, workingDir);
  config.bridge.imageEnabled = false;

  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
  });

  await bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    messageId: 'm-image-disabled',
    text: '',
    images: [{ fileKey: 'download-code-1' }],
    replyContext: { platform: 'dingtalk', sessionWebhook: 'https://example.com/hook', robotCode: 'ding_robot' },
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /未开启图片输入能力/u);
});

test('BridgeFacade converts image input into prompt text', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-bridge-'));
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-work-'));
  const store = new StateStore(stateDir);
  await store.init();

  const replies = [];
  const prompts = [];
  const config = createConfig(stateDir, workingDir);

  const bridge = new BridgeFacade(config, store, {
    async replyText(_replyContext, text) {
      replies.push(text);
    },
    async downloadImage() {
      return {
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/png',
        sizeBytes: 15,
      };
    },
  }, {
    async *streamAgentTurnImpl(options) {
      prompts.push(options.prompt);
      yield { type: 'final_text', text: 'ok' };
    },
  });

  await bridge.handleIncomingMessage({
    platform: 'dingtalk',
    userId: 'u1',
    conversationType: '1',
    messageId: 'm-image-prompt',
    text: '这张图讲了什么？',
    images: [{ fileKey: 'download-code-1', mimeType: 'image/png' }],
    replyContext: { platform: 'dingtalk', sessionWebhook: 'https://example.com/hook', robotCode: 'ding_robot' },
  });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /图片文件路径/u);
  assert.match(prompts[0], /这张图讲了什么/u);
  assert.deepEqual(replies, ['🤖 已收到，正在思考中…', 'ok']);
});
