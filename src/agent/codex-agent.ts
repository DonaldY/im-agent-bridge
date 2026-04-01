import type { AppConfig } from '../config/types.js';
import type { AgentEvent } from './types.js';
import { BaseAgent } from './base-agent.js';
import type { BuildArgsOptions, JsonRecord, ParserState } from './types.js';

export function parseCodexLine(line: string, state: ParserState = {}): AgentEvent[] {
  const data = JSON.parse(line) as JsonRecord;
  const events: AgentEvent[] = [];

  if (data.type === 'thread.started' && data.thread_id) {
    state.sessionId = data.thread_id;
    events.push({ type: 'session_started', sessionId: data.thread_id });
  }

  if (data.type === 'item.completed' && data.item?.type === 'agent_message' && data.item.text) {
    const prefix = state.finalText ? '\n\n' : '';
    state.partialText = `${state.partialText || ''}${prefix}${data.item.text}`;
    state.finalText = `${state.finalText || ''}${prefix}${data.item.text}`;
    events.push({ type: 'partial_text', text: `${prefix}${data.item.text}` });
  }

  if (data.type === 'turn.completed' && state.finalText) {
    state.emittedFinal = true;
    events.push({ type: 'final_text', text: state.finalText });
  }

  if (data.type === 'error' || data.type === 'turn.failed') {
    events.push({ type: 'error', message: data.message || 'Codex command failed' });
  }

  return events;
}

export class CodexAgent extends BaseAgent {
  constructor(config: AppConfig) {
    super(config, 'codex');
  }

  protected buildArgs({ agentConfig, prompt, upstreamSessionId }: BuildArgsOptions): string[] {
    const args = ['exec'];

    if (upstreamSessionId) {
      args.push('resume', upstreamSessionId);
    }

    args.push('--json', '--full-auto', '--skip-git-repo-check');

    if (agentConfig.model) {
      args.push('--model', agentConfig.model);
    }

    args.push(...agentConfig.extraArgs);
    args.push(prompt);
    return args;
  }

  parseLine(line: string, state: ParserState = {}): AgentEvent[] {
    return parseCodexLine(line, state);
  }
}
