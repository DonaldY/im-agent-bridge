import type { AppConfig } from '../config/types.js';
import type { AgentEvent } from './types.js';
import { BaseAgent } from './base-agent.js';
import type { BuildArgsOptions, JsonRecord, ParserState } from './types.js';

export function parseNeovateLine(line: string, state: ParserState = {}): AgentEvent[] {
  const data = JSON.parse(line) as JsonRecord;
  const events: AgentEvent[] = [];

  if (data.type === 'system' && data.subtype === 'init' && data.sessionId) {
    state.sessionId = data.sessionId;
    events.push({ type: 'session_started', sessionId: data.sessionId });
  }

  if (data.type === 'message' && data.role === 'assistant' && data.text) {
    state.messageText = data.text;
  }

  if (data.type === 'result' && data.subtype === 'success') {
    const text = data.content || state.messageText;
    if (text) {
      state.finalText = text;
      state.emittedFinal = true;
      events.push({ type: 'final_text', text });
    }
  }

  if (data.type === 'error' || data.isError) {
    events.push({ type: 'error', message: data.message || data.content || 'Neovate command failed' });
  }

  return events;
}

export class NeovateAgent extends BaseAgent {
  constructor(config: AppConfig) {
    super(config, 'neovate');
  }

  protected buildArgs({ agentConfig, prompt, workingDir, upstreamSessionId }: BuildArgsOptions): string[] {
    const args = ['-q', '--output-format', 'stream-json', '--approval-mode', 'autoEdit', '--cwd', workingDir];

    if (agentConfig.model) {
      args.push('--model', agentConfig.model);
    }
    if (upstreamSessionId) {
      args.push('--resume', upstreamSessionId);
    }

    args.push(...agentConfig.extraArgs);
    args.push(prompt);
    return args;
  }

  parseLine(line: string, state: ParserState = {}): AgentEvent[] {
    return parseNeovateLine(line, state);
  }
}
