import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolveAgentBinary, resolveAgentEnvironment } from '../config/index.js';
import type { AgentName } from '../shared/index.js';
import type { AgentConfig, AppConfig } from '../config/types.js';
import type { AgentEvent, AgentProviderLike, AgentStreamOptions, BuildArgsOptions, CommandSpec, ParserState } from './types.js';
import { normalizeSpawn, toErrorMessage } from '../utils.js';

export abstract class BaseAgent implements AgentProviderLike {
  public readonly config: AppConfig;
  public readonly name: AgentName;

  constructor(config: AppConfig, name: AgentName) {
    this.config = config;
    this.name = name;
  }

  protected getAgentConfig(): AgentConfig {
    return this.config.agents[this.name];
  }

  protected abstract buildArgs(options: BuildArgsOptions): string[];

  abstract parseLine(line: string, state?: ParserState): AgentEvent[];

  protected getFinalText(state: ParserState): string | undefined {
    return state.finalText || state.assistantText || state.messageText;
  }

  buildCommandSpec(prompt: string, workingDir: string, upstreamSessionId?: string | null): CommandSpec {
    const command = resolveAgentBinary(this.config, this.name);
    if (!command) {
      throw new Error(`Cannot resolve ${this.name} binary`);
    }

    return {
      command,
      args: this.buildArgs({
        agentConfig: this.getAgentConfig(),
        prompt,
        workingDir,
        upstreamSessionId,
      }),
      cwd: workingDir,
    };
  }

  async *streamTurn({ prompt, workingDir, upstreamSessionId, abortSignal }: AgentStreamOptions): AsyncGenerator<AgentEvent> {
    const spec = this.buildCommandSpec(prompt, workingDir, upstreamSessionId);
    const parserState: ParserState = {};
    const [spawnCommand, spawnArgs] = normalizeSpawn(spec.command, spec.args);
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: spec.cwd,
      env: resolveAgentEnvironment(this.config, this.name),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let aborted = Boolean(abortSignal?.aborted);
    let closed = false;

    const abortChild = (): void => {
      if (aborted) {
        return;
      }

      aborted = true;
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (!closed) {
          child.kill('SIGKILL');
        }
      }, 1000);
      timer.unref?.();
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', abortChild, { once: true });
      if (abortSignal.aborted) {
        abortChild();
      }
    }

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const closePromise = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        closed = true;
        resolve(code ?? 0);
      });
    });

    const lines = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of lines) {
        if (aborted) {
          break;
        }

        if (!line.trim()) {
          continue;
        }

        let parsedEvents: AgentEvent[];
        try {
          parsedEvents = this.parseLine(line, parserState);
        } catch (error) {
          yield {
            type: 'error',
            message: `Failed to parse ${this.name} output: ${toErrorMessage(error)}`,
          };
          continue;
        }

        for (const event of parsedEvents) {
          yield event;
        }
      }

      const exitCode = await closePromise;

      if (aborted) {
        return;
      }

      const finalText = !parserState.emittedFinal ? this.getFinalText(parserState) : undefined;
      if (finalText) {
        yield { type: 'final_text', text: finalText };
      }

      if (exitCode !== 0) {
        yield {
          type: 'error',
          message: stderr.trim() || `${this.name} exited with code ${exitCode}`,
        };
      }
    } catch (error) {
      if (aborted) {
        return;
      }

      child.kill('SIGTERM');
      yield {
        type: 'error',
        message: `${this.name} execution failed: ${toErrorMessage(error)}`,
      };
    } finally {
      abortSignal?.removeEventListener('abort', abortChild);
    }
  }
}
