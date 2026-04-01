import type { AgentName } from '../shared';
import type { AppConfig } from '../config/types';
import type { AgentProviderLike } from './types';
import { AGENT_PROVIDER_REGISTRY } from './registry';

export function createAgentProvider(config: AppConfig, agent: AgentName): AgentProviderLike {
  const Provider = AGENT_PROVIDER_REGISTRY[agent];
  if (!Provider) {
    throw new Error(`Unsupported agent: ${agent}`);
  }
  return new Provider(config);
}
