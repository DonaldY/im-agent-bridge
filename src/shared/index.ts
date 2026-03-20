export type AgentName = 'claude' | 'codex';
export type PlatformKind = 'dingtalk' | 'feishu' | 'telegram';
export type TelegramMode = 'poll' | 'webhook';

export interface DoctorOptions {
  remote?: boolean;
  fetchImpl?: typeof fetch;
}

export interface LoggerLike {
  log: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}
