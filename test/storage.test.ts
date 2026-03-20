import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/storage/index.js';
import type { SessionRecord, ConversationLogEntry } from '../src/storage/types.js';
import type { MessageDedupeStoreLike, SessionRepositoryLike, ConversationLoggerLike } from '../src/storage.js';

function createSession(id: string, userId = 'u1', activeAgent: SessionRecord['activeAgent'] = 'codex'): SessionRecord {
  return {
    id,
    platform: 'dingtalk',
    platformUserId: userId,
    activeAgent,
    workingDir: '/tmp/work',
    providerSessionIds: {
      claude: null,
      codex: null,
    },
    providerWorkingDirs: {
      claude: null,
      codex: null,
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

test('StateStore creates and switches active session', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-store-'));
  const store = new StateStore(stateDir);
  await store.init();

  const first = await store.createSession('u1', 'codex', '/tmp/work');
  const second = await store.replaceActiveSession('u1', 'claude', '/tmp/next');

  assert.notEqual(first.id, second.id);
  assert.equal(store.getActiveSession('u1')!.id, second.id);
  assert.equal(store.getActiveSession('u1')!.activeAgent, 'claude');
});

test('StateStore remembers processed messages with ttl', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iab-store-'));
  const store = new StateStore(stateDir);
  await store.init();

  await store.rememberMessage('m1', 1000);
  assert.equal(await store.hasProcessedMessage('m1'), true);

  store.messageDedupe.m1 = Date.now() - 1;
  await store.pruneMessageDedupe();
  assert.equal(await store.hasProcessedMessage('m1'), false);
});

test('StateStore supports pluggable conversation logger', async () => {
  const appended: Array<{ sessionId: string; entry: ConversationLogEntry }> = [];

  const sessionRepository: SessionRepositoryLike = {
    async init() {},
    getSessionById(sessionId) {
      return sessionId ? createSession(sessionId) : null;
    },
    getActiveSession(userId) {
      return createSession(`session-${userId}`, userId);
    },
    async createSession(userId, activeAgent, workingDir = null, platform = 'dingtalk') {
      return {
        ...createSession(`created-${userId}`, userId, activeAgent),
        workingDir,
        platform,
      };
    },
    async ensureActiveSession(userId, activeAgent, workingDir = null, platform = 'dingtalk') {
      return this.createSession(userId, activeAgent, workingDir, platform);
    },
    async saveSession(session) {
      return session;
    },
    async replaceActiveSession(userId, activeAgent, workingDir = null, platform = 'dingtalk') {
      return this.createSession(userId, activeAgent, workingDir, platform);
    },
    async setActiveAgent(userId, activeAgent) {
      return createSession(`set-agent-${userId}`, userId, activeAgent);
    },
    async setWorkingDir(userId, activeAgent, workingDir) {
      return {
        ...createSession(`set-dir-${userId}`, userId, activeAgent),
        workingDir,
      };
    },
  };

  const messageDedupeStore: MessageDedupeStoreLike = {
    records: {},
    async init() {},
    async prune() {},
    async has() {
      return false;
    },
    async remember(messageId, ttlMs) {
      if (messageId) {
        this.records[messageId] = ttlMs;
      }
    },
  };

  const conversationLogger: ConversationLoggerLike = {
    async init() {},
    async append(sessionId, entry) {
      appended.push({ sessionId, entry });
    },
  };

  const store = new StateStore('/tmp/virtual', {
    sessionRepository,
    messageDedupeStore,
    conversationLogger,
  });
  await store.init();
  await store.appendConversationLog('s1', { direction: 'out', platform: 'dingtalk', finalText: 'ok' });

  assert.deepEqual(appended, [
    {
      sessionId: 's1',
      entry: { direction: 'out', platform: 'dingtalk', finalText: 'ok' },
    },
  ]);
});
