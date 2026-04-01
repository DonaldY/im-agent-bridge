import type { AgentEvent, AgentRunOptions, RunState } from '../agent/types';
import type { ReplyTextOptions } from '../client/message-format';
import type { PlatformReplyContext, SentMessageRef } from '../client/types';
import type { AppConfig } from '../config/types';
import type { LoggerLike } from '../shared';
import type { StateStore } from '../storage';
import type { SessionRecord } from '../storage/types';

export type StreamAgentTurnImpl = (options: AgentRunOptions) => AsyncGenerator<AgentEvent>;

export interface AgentRunContext {
  session: SessionRecord;
  agent: SessionRecord['activeAgent'];
  workingDir: string;
  upstreamSessionId: string | null;
}

export interface BridgeContext {
  config: AppConfig;
  store: StateStore;
  logger: LoggerLike;
  activeRuns: Map<string, RunState>;
  streamAgentTurnImpl: StreamAgentTurnImpl;
  getSessionWorkingDir(session: SessionRecord): string;
  getRunState(sessionId?: string): RunState | null;
  logDebug(message: string, details?: Record<string, unknown> | null): void;
  replyText(replyContext: PlatformReplyContext, text: string, details?: Record<string, unknown> | null, options?: ReplyTextOptions): Promise<SentMessageRef | null>;
  updateText(replyContext: PlatformReplyContext, message: SentMessageRef, text: string, details?: Record<string, unknown> | null, options?: ReplyTextOptions): Promise<void>;
  sendTyping(replyContext: PlatformReplyContext, details?: Record<string, unknown> | null): Promise<void>;
  resolveWorkingDir(session: SessionRecord, rawPath: string): Promise<string>;
  resolveAgentRunContext(session: SessionRecord): Promise<AgentRunContext>;
}
