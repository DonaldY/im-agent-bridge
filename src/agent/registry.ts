import type { AgentName } from '../shared/index.js';
import type { AppConfig } from '../config/types.js';
import type { AgentProviderLike } from './types.js';
import { ClaudeAgent } from './claude-agent.js';
import { CodexAgent } from './codex-agent.js';

export type AgentProviderConstructor = new (config: AppConfig) => AgentProviderLike;

export const AGENT_PROVIDER_REGISTRY: Record<AgentName, AgentProviderConstructor> = {
  claude: ClaudeAgent,
  codex: CodexAgent,
};
