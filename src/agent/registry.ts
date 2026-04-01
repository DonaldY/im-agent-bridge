import type { AgentName } from '../shared';
import type { AppConfig } from '../config/types';
import type { AgentProviderLike } from './types';
import { ClaudeAgent } from './claude-agent';
import { CodexAgent } from './codex-agent';

export type AgentProviderConstructor = new (config: AppConfig) => AgentProviderLike;

export const AGENT_PROVIDER_REGISTRY: Record<AgentName, AgentProviderConstructor> = {
  claude: ClaudeAgent,
  codex: CodexAgent,
};
