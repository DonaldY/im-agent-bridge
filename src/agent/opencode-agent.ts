import type { AppConfig } from '../config/types.js';
import type { AgentEvent } from './types.js';
import { BaseAgent } from './base-agent.js';
import type { BuildArgsOptions, JsonRecord, ParserState } from './types.js';

export function parseOpencodeLine(line: string, state: ParserState = {}): AgentEvent[] {
  const data = JSON.parse(line) as JsonRecord;
  const events: AgentEvent[] = [];

  if (data.type === 'step_start' && data.sessionID) {
    state.sessionId = data.sessionID;
    events.push({ type: 'session_started', sessionId: data.sessionID });
  }

  if (data.type === 'text' && data.part?.type === 'text' && data.part.text) {
    state.partialText = `${state.partialText || ''}${data.part.text}`;
    events.push({ type: 'partial_text', text: data.part.text });
  }

  if (data.type === 'step_finish' && state.partialText) {
    state.finalText = state.partialText;
    state.emittedFinal = true;
    events.push({ type: 'final_text', text: state.partialText });
  }

  if (data.type === 'error' || data.is_error) {
    events.push({ type: 'error', message: data.message || data.part?.text || 'OpenCode command failed' });
  }

  return events;
}

export class OpencodeAgent extends BaseAgent {
  constructor(config: AppConfig) {
    super(config, 'opencode');
  }

  protected buildArgs({ agentConfig, prompt, upstreamSessionId }: BuildArgsOptions): string[] {
    const args = ['run', '--format', 'json'];

    if (agentConfig.model) {
      args.push('--model', agentConfig.model);
    }
    if (upstreamSessionId) {
      args.push('--session', upstreamSessionId);
    }

    args.push(...agentConfig.extraArgs);
    args.push(prompt);
    return args;
  }

  parseLine(line: string, state: ParserState = {}): AgentEvent[] {
    return parseOpencodeLine(line, state);
  }
}
