import type { AgentName, PlatformKind } from '../shared';

export interface SessionRecord {
  id: string;
  platform: PlatformKind;
  platformUserId: string;
  activeAgent: AgentName;
  workingDir: string | null;
  providerSessionIds: Record<AgentName, string | null>;
  providerWorkingDirs: Record<AgentName, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationLogEntry {
  timestamp?: string;
  direction: 'in' | 'out';
  platform: PlatformKind;
  agent?: AgentName;
  messageId?: string;
  conversationId?: string;
  providerSessionId?: string | null;
  text?: string;
  partialText?: string;
  finalText?: string;
  status?: 'aborted';
  errors?: string[];
  durationMs?: number;
}

export interface SessionRepositoryLike {
  init(): Promise<void>;
  getSessionById(sessionId?: string | null): SessionRecord | null;
  getActiveSession(userId: string): SessionRecord | null;
  createSession(userId: string, activeAgent: AgentName, workingDir?: string | null, platform?: PlatformKind): Promise<SessionRecord>;
  ensureActiveSession(userId: string, activeAgent: AgentName, workingDir?: string | null, platform?: PlatformKind): Promise<SessionRecord>;
  saveSession(session: SessionRecord): Promise<SessionRecord>;
  replaceActiveSession(userId: string, activeAgent: AgentName, workingDir?: string | null, platform?: PlatformKind): Promise<SessionRecord>;
  setActiveAgent(userId: string, activeAgent: AgentName): Promise<SessionRecord>;
  setWorkingDir(userId: string, activeAgent: AgentName, workingDir: string): Promise<SessionRecord>;
}

export interface MessageDedupeStoreLike {
  readonly records: Record<string, number>;
  init(): Promise<void>;
  prune(now?: number): Promise<void>;
  has(messageId?: string): Promise<boolean>;
  remember(messageId: string | undefined, ttlMs: number): Promise<void>;
}

export interface ConversationLoggerLike {
  init(): Promise<void>;
  append(sessionId: string, entry: ConversationLogEntry): Promise<void>;
}

export interface StateStoreOptions {
  sessionRepository?: SessionRepositoryLike;
  messageDedupeStore?: MessageDedupeStoreLike;
  conversationLogger?: ConversationLoggerLike;
}
