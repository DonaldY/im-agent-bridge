import type { AgentName } from '../shared';
import type { AgentConfig, AppConfig } from '../config/types';

export interface CommandSpec {
  command: string;
  args: string[];
  cwd: string;
}

export type AgentEvent =
  | { type: 'session_started'; sessionId: string }
  | { type: 'partial_text'; text: string }
  | { type: 'final_text'; text: string }
  | { type: 'error'; message: string };

export interface AgentRunOptions {
  config: AppConfig;
  agent: AgentName;
  prompt: string;
  workingDir: string;
  upstreamSessionId?: string | null;
  abortSignal?: AbortSignal;
}

export interface RunState {
  sessionId: string;
  agent: AgentName;
  messageId?: string;
  providerSessionId?: string | null;
  abortController: AbortController;
  aborted: boolean;
}

export interface ParserState {
  sessionId?: string;
  partialText?: string;
  finalText?: string;
  emittedFinal?: boolean;
  assistantText?: string;
  messageText?: string;
}

export type JsonRecord = Record<string, any>;

export interface AgentStreamOptions {
  prompt: string;
  workingDir: string;
  upstreamSessionId?: string | null;
  abortSignal?: AbortSignal;
}

export interface AgentProviderLike {
  name: AgentName;
  config: AppConfig;
  buildCommandSpec(prompt: string, workingDir: string, upstreamSessionId?: string | null): CommandSpec;
  parseLine(line: string, state?: ParserState): AgentEvent[];
  streamTurn(options: AgentStreamOptions): AsyncGenerator<AgentEvent>;
}

export interface BuildArgsOptions {
  agentConfig: AgentConfig;
  prompt: string;
  workingDir: string;
  upstreamSessionId?: string | null;
}
