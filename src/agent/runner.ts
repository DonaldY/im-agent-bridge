import type { AgentName } from '../shared';
import type { AppConfig } from '../config/types';
import type { AgentEvent, AgentRunOptions, CommandSpec } from './types';
import { createAgentProvider } from './factory';

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
