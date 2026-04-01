import type { AgentName, PlatformKind } from '../shared';
import type { ConversationLogEntry, SessionRecord } from './types';
import { DEFAULT_PLATFORM_KIND } from '../config';
import { JsonMessageDedupeStore } from './json-message-dedupe-store';
import { JsonSessionRepository } from './json-session-repository';
import { JsonlConversationLogger } from './jsonl-conversation-logger';
import type { ConversationLoggerLike, MessageDedupeStoreLike, SessionRepositoryLike, StateStoreOptions } from './types';

export {
  JsonMessageDedupeStore,
  JsonSessionRepository,
  JsonlConversationLogger,
} from './internal';
export type {
  ConversationLogEntry,
  ConversationLoggerLike,
  MessageDedupeStoreLike,
  SessionRecord,
  SessionRepositoryLike,
  StateStoreOptions,
} from './internal';

export class StateStore {
  private sessionRepository: SessionRepositoryLike;
  private messageDedupeStore: MessageDedupeStoreLike;
  private conversationLogger: ConversationLoggerLike;

  constructor(stateDir: string, options: StateStoreOptions = {}) {
    this.sessionRepository = options.sessionRepository || new JsonSessionRepository(stateDir);
    this.messageDedupeStore = options.messageDedupeStore || new JsonMessageDedupeStore(stateDir);
    this.conversationLogger = options.conversationLogger || new JsonlConversationLogger(stateDir);
  }

  get messageDedupe(): Record<string, number> {
    return this.messageDedupeStore.records;
  }

  async init(): Promise<void> {
    await Promise.all([
      this.sessionRepository.init(),
      this.messageDedupeStore.init(),
      this.conversationLogger.init(),
    ]);
  }

  async pruneMessageDedupe(now = Date.now()): Promise<void> {
    await this.messageDedupeStore.prune(now);
  }

  async hasProcessedMessage(messageId?: string): Promise<boolean> {
    return this.messageDedupeStore.has(messageId);
  }

  async rememberMessage(messageId: string | undefined, ttlMs: number): Promise<void> {
    await this.messageDedupeStore.remember(messageId, ttlMs);
  }

  getSessionById(sessionId?: string | null): SessionRecord | null {
    return this.sessionRepository.getSessionById(sessionId);
  }

  getActiveSession(userId: string): SessionRecord | null {
    return this.sessionRepository.getActiveSession(userId);
  }

  async createSession(userId: string, activeAgent: AgentName, workingDir: string | null = null, platform: PlatformKind = DEFAULT_PLATFORM_KIND): Promise<SessionRecord> {
    return this.sessionRepository.createSession(userId, activeAgent, workingDir, platform);
  }

  async ensureActiveSession(userId: string, activeAgent: AgentName, workingDir: string | null = null, platform: PlatformKind = DEFAULT_PLATFORM_KIND): Promise<SessionRecord> {
    return this.sessionRepository.ensureActiveSession(userId, activeAgent, workingDir, platform);
  }

  async saveSession(session: SessionRecord): Promise<SessionRecord> {
    return this.sessionRepository.saveSession(session);
  }

  async replaceActiveSession(userId: string, activeAgent: AgentName, workingDir: string | null = null, platform: PlatformKind = DEFAULT_PLATFORM_KIND): Promise<SessionRecord> {
    return this.sessionRepository.replaceActiveSession(userId, activeAgent, workingDir, platform);
  }

  async setActiveAgent(userId: string, activeAgent: AgentName): Promise<SessionRecord> {
    return this.sessionRepository.setActiveAgent(userId, activeAgent);
  }

  async setWorkingDir(userId: string, activeAgent: AgentName, workingDir: string): Promise<SessionRecord> {
    return this.sessionRepository.setWorkingDir(userId, activeAgent, workingDir);
  }

  async appendConversationLog(sessionId: string, entry: ConversationLogEntry): Promise<void> {
    await this.conversationLogger.append(sessionId, entry);
  }
}
