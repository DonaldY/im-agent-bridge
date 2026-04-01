import type { AgentName } from '../shared/index.js';
import type { AppConfig } from '../config/types.js';
import type { AgentEvent, AgentRunOptions, CommandSpec } from './types.js';
import { createAgentProvider } from './factory.js';

export function buildAgentCommandSpec(
  config: AppConfig,
  agent: AgentName,
  prompt: string,
  workingDir: string,
  upstreamSessionId?: string | null,
): CommandSpec {
  return createAgentProvider(config, agent).buildCommandSpec(prompt, workingDir, upstreamSessionId);
}

export async function* streamAgentTurn({ config, agent, prompt, workingDir, upstreamSessionId, abortSignal }: AgentRunOptions): AsyncGenerator<AgentEvent> {
  yield* createAgentProvider(config, agent).streamTurn({
    prompt,
    workingDir,
    upstreamSessionId,
    abortSignal,
  });
}
