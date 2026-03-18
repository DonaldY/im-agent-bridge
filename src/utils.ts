import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  errored: boolean;
}

export function expandHomePath(input?: string | null): string | undefined | null {
  if (!input || typeof input !== 'string') {
    return input;
  }
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function readJson<T>(filePath: string, fallbackValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallbackValue;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendLine(filePath: string, line: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${line}\n`, 'utf8');
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function coerceStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    if (typeof entry === 'number') {
      return String(entry);
    }
    throw new Error(`${label} must contain only strings or integers`);
  });
}

export function chunkText(text: string, maxLength = 1500): string[] {
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let boundary = remaining.lastIndexOf('\n', maxLength);
    if (boundary < maxLength * 0.4) {
      boundary = remaining.lastIndexOf(' ', maxLength);
    }
    if (boundary < maxLength * 0.4) {
      boundary = maxLength;
    }

    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

export function toUtf8String(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toUtf8String(entry)).join('');
  }
  if (value == null) {
    return '';
  }
  return String(value);
}

export function formatLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return toUtf8String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isExecutable(filePath: string): boolean {
  try {
    if (os.platform() === 'win32') {
      fssync.accessSync(filePath, fssync.constants.F_OK);
    } else {
      fssync.accessSync(filePath, fssync.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export function which(command: string | null | undefined, envPath = process.env.PATH || ''): string | null {
  if (!command) {
    return null;
  }

  const extensions = os.platform() === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  if (path.isAbsolute(command)) {
    if (isExecutable(command)) {
      return command;
    }
    for (const extension of extensions) {
      if (isExecutable(command + extension)) {
        return command + extension;
      }
    }
    return null;
  }

  for (const entry of envPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(entry, command + extension);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function normalizeSpawn(command: string, args: string[]): [string, string[]] {
  if (os.platform() === 'win32' && /\.(cmd|bat)$/iu.test(command)) {
    return ['cmd.exe', ['/c', command, ...args]];
  }
  return [command, args];
}

export async function isWritableDirectory(dirPath: string): Promise<boolean> {
  try {
    await ensureDir(dirPath);
    const tempFile = path.join(dirPath, `.tmp-${process.pid}-${Date.now()}`);
    await fs.writeFile(tempFile, 'ok', 'utf8');
    await fs.rm(tempFile, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function runCommand(command: string, args: string[], options: RunCommandOptions = {}): Promise<RunCommandResult> {
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const child = spawn(command, args, spawnOptions);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  let errored = false;
  const code = await new Promise<number>((resolve) => {
    child.once('error', (error) => {
      errored = true;
      stderr += error instanceof Error ? error.message : String(error);
      resolve(127);
    });

    child.once('close', (closeCode) => {
      resolve(closeCode ?? 0);
    });
  });

  return {
    code,
    stdout,
    stderr,
    errored,
  };
}

export function formatCheckResult(ok: boolean, label: string, detail = ''): string {
  const prefix = ok ? '[OK]  ' : '[FAIL]';
  return `${prefix} ${label}${detail ? `: ${detail}` : ''}`;
}
