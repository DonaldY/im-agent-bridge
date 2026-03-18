import type { AgentName } from '../shared/index.js';
import type { AppConfig } from '../config/types.js';
import type { AgentProviderLike } from './types.js';
import { AGENT_PROVIDER_REGISTRY } from './registry.js';

export function createAgentProvider(config: AppConfig, agent: AgentName): AgentProviderLike {
  const Provider = AGENT_PROVIDER_REGISTRY[agent];
  if (!Provider) {
    throw new Error(`Unsupported agent: ${agent}`);
  }
  return new Provider(config);
}
