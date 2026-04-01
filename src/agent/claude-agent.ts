import type { AppConfig } from '../config/types';
import type { AgentEvent } from './types';
import { BaseAgent } from './base-agent';
import type { BuildArgsOptions, JsonRecord, ParserState } from './types';

export function parseClaudeLine(line: string, state: ParserState = {}): AgentEvent[] {
  const data = JSON.parse(line) as JsonRecord;
  const events: AgentEvent[] = [];

  if (data.type === 'system' && data.subtype === 'init' && data.session_id) {
    state.sessionId = data.session_id;
    events.push({ type: 'session_started', sessionId: data.session_id });
  }

  if (
    data.type === 'stream_event' &&
    data.event?.type === 'content_block_delta' &&
    data.event?.delta?.type === 'text_delta' &&
    data.event.delta.text
  ) {
    state.partialText = `${state.partialText || ''}${data.event.delta.text}`;
    events.push({ type: 'partial_text', text: data.event.delta.text });
  }

  if (data.type === 'result' && data.subtype === 'success' && typeof data.result === 'string') {
    state.finalText = data.result;
    state.emittedFinal = true;
    events.push({ type: 'final_text', text: data.result });
  }

  if (data.type === 'assistant' && Array.isArray(data.message?.content)) {
    const text = data.message.content
      .filter((entry: JsonRecord) => entry.type === 'text')
      .map((entry: JsonRecord) => entry.text)
      .join('');
    if (text) {
      state.assistantText = text;
    }
  }

  if (data.type === 'error' || data.is_error) {
    events.push({ type: 'error', message: data.message || data.result || 'Claude command failed' });
  }

  return events;
}

export class ClaudeAgent extends BaseAgent {
  constructor(config: AppConfig) {
    super(config, 'claude');
  }

  protected buildArgs({ agentConfig, prompt, upstreamSessionId }: BuildArgsOptions): string[] {
    const args = [
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--permission-mode',
      'acceptEdits',
    ];

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
    return parseClaudeLine(line, state);
  }
}
