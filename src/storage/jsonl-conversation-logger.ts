import path from 'node:path';
import type { ConversationLogEntry } from './types.js';
import { appendLine, ensureDir, nowIso } from '../utils.js';
import type { ConversationLoggerLike } from './types.js';

const CONVERSATION_LOGS_DIRNAME = 'conversation-logs';

export class JsonlConversationLogger implements ConversationLoggerLike {
  private conversationLogsDir: string;

  constructor(stateDir: string) {
    this.conversationLogsDir = path.join(stateDir, CONVERSATION_LOGS_DIRNAME);
  }

  async init(): Promise<void> {
    await ensureDir(this.conversationLogsDir);
  }

  async append(sessionId: string, entry: ConversationLogEntry): Promise<void> {
    const record = {
      timestamp: nowIso(),
      ...entry,
    };
    await appendLine(path.join(this.conversationLogsDir, `${sessionId}.jsonl`), JSON.stringify(record));
  }
}
