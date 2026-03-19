import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureDir,
  fileExists,
  runCommand,
  toErrorMessage,
  writeFileAtomic,
  which,
} from '../utils.js';
import type { AppConfig } from '../config/types.js';

export type KeepAwakeMode = 'none' | 'idle' | 'system' | 'on_ac';

export interface ServicePaths {
  label: string;
  plistPath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
}

export interface ParsedServiceState {
  state: string | null;
  pid: number | null;
  lastExitCode: number | null;
}

export interface InstallServiceOptions {
  label?: string;
  keepAwake?: KeepAwakeMode;
}

export interface ServiceLogsOptions {
  label?: string;
  lines?: number;
}

export interface ServiceLogsResult {
  paths: ServicePaths;
  stdout: string;
  stderr: string;
}

const DEFAULT_LABEL = 'com.im-agent-bridge.service';
const DEFAULT_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function requireDarwin(): void {
  if (process.platform !== 'darwin') {
    throw new Error('service commands are only supported on macOS');
  }
}

function projectRootFromModule(): string {
  const modulePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(modulePath), '..', '..');
}

function labelToFilename(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]/gu, '_');
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function plistArray(values: string[]): string {
  return values.map((entry) => `    <string>${xmlEscape(entry)}</string>`).join('\n');
}

function keepAwakeFlags(mode: KeepAwakeMode): string[] {
  if (mode === 'none') {
    return [];
  }
  if (mode === 'idle') {
    return ['-i', '-m'];
  }
  if (mode === 'system') {
    return ['-i', '-m', '-s'];
  }
  return ['-s'];
}

function launchctlDomain(): string {
  if (typeof process.getuid !== 'function') {
    throw new Error('unable to determine uid for launchctl domain');
  }
  return `gui/${process.getuid()}`;
}

function serviceTarget(label: string): string {
  return `${launchctlDomain()}/${label}`;
}

function normalizeLaunchctlError(result: { stdout: string; stderr: string; code: number }): string {
  const detail = [result.stderr, result.stdout].find((value) => typeof value === 'string' && value.trim());
  if (detail) {
    return detail.trim();
  }
  return `exit code ${result.code}`;
}

function isMissingServiceError(detail: string): boolean {
  return /could not find service|service.*not found|no such process|not loaded/ui.test(detail);
}

async function runLaunchctl(args: string[], allowMissing = false): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await runCommand('launchctl', args);
  if (result.code === 0) {
    return result;
  }

  const detail = normalizeLaunchctlError(result);
  if (allowMissing && isMissingServiceError(detail)) {
    return result;
  }

  throw new Error(`launchctl ${args.join(' ')} failed: ${detail}`);
}

function resolveServicePaths(label?: string): ServicePaths {
  const resolvedLabel = normalizeServiceLabel(label);
  const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const logsDir = path.join(os.homedir(), '.im-agent-bridge', 'logs');
  const filename = labelToFilename(resolvedLabel);

  return {
    label: resolvedLabel,
    plistPath: path.join(launchAgentsDir, `${resolvedLabel}.plist`),
    stdoutLogPath: path.join(logsDir, `${filename}.out.log`),
    stderrLogPath: path.join(logsDir, `${filename}.err.log`),
  };
}

export function normalizeServiceLabel(label?: string): string {
  const resolved = typeof label === 'string' && label.trim() ? label.trim() : DEFAULT_LABEL;
  if (!/^[A-Za-z0-9._-]+$/u.test(resolved)) {
    throw new Error('service label must contain only letters, numbers, dot, underscore, and dash');
  }
  return resolved;
}

export function normalizeKeepAwakeMode(value?: string): KeepAwakeMode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'none';
  if (!normalized) {
    return 'none';
  }

  if (normalized === 'none' || normalized === 'idle' || normalized === 'system' || normalized === 'on_ac') {
    return normalized;
  }

  throw new Error('keepawake must be one of: none, idle, system, on_ac');
}

export function buildLaunchAgentPlist(options: {
  label: string;
  nodePath: string;
  distCliPath: string;
  configPath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  keepAwake: KeepAwakeMode;
  pathValue: string;
  workingDir: string;
  caffeinatePath?: string;
}): string {
  const args = [
    options.nodePath,
    options.distCliPath,
    'serve',
    '--config',
    options.configPath,
  ];

  const flags = keepAwakeFlags(options.keepAwake);
  const programArguments = flags.length > 0
    ? [options.caffeinatePath as string, ...flags, ...args]
    : args;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xmlEscape(options.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    plistArray(programArguments),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xmlEscape(options.workingDir)}</string>`,
    '  <key>StandardOutPath</key>',
    `  <string>${xmlEscape(options.stdoutLogPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xmlEscape(options.stderrLogPath)}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>PATH</key>',
    `    <string>${xmlEscape(options.pathValue)}</string>`,
    '  </dict>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function parseLaunchctlPrint(output: string): ParsedServiceState {
  const state = output.match(/^\s*state\s*=\s*(.+)$/imu)?.[1]?.trim() || null;
  const pidText = output.match(/^\s*pid\s*=\s*(\d+)/imu)?.[1] || null;
  const lastExitText = output.match(/^\s*last exit code\s*=\s*(-?\d+)/imu)?.[1] || null;

  return {
    state,
    pid: pidText ? Number.parseInt(pidText, 10) : null,
    lastExitCode: lastExitText ? Number.parseInt(lastExitText, 10) : null,
  };
}

function resolveRuntimeBinaries(keepAwake: KeepAwakeMode): { nodePath: string; distCliPath: string; caffeinatePath?: string } {
  const projectRoot = projectRootFromModule();
  const distCliPath = path.join(projectRoot, 'dist', 'cli.js');
  const nodePath = process.execPath;

  if (!nodePath) {
    throw new Error('cannot resolve node executable path');
  }

  const caffeinatePath = keepAwake === 'none' ? undefined : which('caffeinate');
  if (keepAwake !== 'none' && !caffeinatePath) {
    throw new Error('caffeinate not found in PATH, cannot enable keepawake mode');
  }

  return {
    nodePath,
    distCliPath,
    caffeinatePath: caffeinatePath || undefined,
  };
}

async function ensureInstallReady(distCliPath: string): Promise<void> {
  if (!await fileExists(distCliPath)) {
    throw new Error(`build output not found: ${distCliPath}; run \`npm run build\` first`);
  }
}

export async function installService(config: AppConfig, options: InstallServiceOptions = {}): Promise<string> {
  requireDarwin();
  const keepAwake = options.keepAwake || 'none';
  const paths = resolveServicePaths(options.label);
  const runtime = resolveRuntimeBinaries(keepAwake);
  const configPath = path.resolve(config.configPath);
  const projectRoot = projectRootFromModule();
  const launchAgentsDir = path.dirname(paths.plistPath);

  await ensureInstallReady(runtime.distCliPath);
  await ensureDir(launchAgentsDir);
  await ensureDir(path.dirname(paths.stdoutLogPath));

  const plist = buildLaunchAgentPlist({
    label: paths.label,
    nodePath: runtime.nodePath,
    distCliPath: runtime.distCliPath,
    configPath,
    stdoutLogPath: paths.stdoutLogPath,
    stderrLogPath: paths.stderrLogPath,
    keepAwake,
    pathValue: process.env.PATH || DEFAULT_PATH,
    workingDir: projectRoot,
    caffeinatePath: runtime.caffeinatePath,
  });
  await writeFileAtomic(paths.plistPath, plist);

  const target = serviceTarget(paths.label);
  await runLaunchctl(['bootout', target], true);
  await runLaunchctl(['bootstrap', launchctlDomain(), paths.plistPath]);
  await runLaunchctl(['kickstart', '-k', target]);

  return [
    `[service] installed: ${paths.label}`,
    `[service] plist: ${paths.plistPath}`,
    `[service] keepawake: ${keepAwake}`,
    `[service] logs: ${paths.stdoutLogPath}`,
  ].join('\n');
}

export async function startService(label?: string): Promise<string> {
  requireDarwin();
  const paths = resolveServicePaths(label);
  if (!await fileExists(paths.plistPath)) {
    throw new Error(`service plist not found: ${paths.plistPath}; run \`service install\` first`);
  }

  const target = serviceTarget(paths.label);
  await runLaunchctl(['bootout', target], true);
  await runLaunchctl(['bootstrap', launchctlDomain(), paths.plistPath]);
  await runLaunchctl(['kickstart', '-k', target]);

  return `[service] started: ${paths.label}`;
}

export async function stopService(label?: string): Promise<string> {
  requireDarwin();
  const resolved = normalizeServiceLabel(label);
  await runLaunchctl(['bootout', serviceTarget(resolved)], true);
  return `[service] stopped: ${resolved}`;
}

export async function restartService(label?: string): Promise<string> {
  requireDarwin();
  const paths = resolveServicePaths(label);
  if (!await fileExists(paths.plistPath)) {
    throw new Error(`service plist not found: ${paths.plistPath}; run \`service install\` first`);
  }

  const target = serviceTarget(paths.label);
  await runLaunchctl(['bootout', target], true);
  await runLaunchctl(['bootstrap', launchctlDomain(), paths.plistPath]);
  await runLaunchctl(['kickstart', '-k', target]);

  return `[service] restarted: ${paths.label}`;
}

export async function uninstallService(label?: string): Promise<string> {
  requireDarwin();
  const paths = resolveServicePaths(label);
  await runLaunchctl(['bootout', serviceTarget(paths.label)], true);

  if (await fileExists(paths.plistPath)) {
    await fs.rm(paths.plistPath, { force: true });
  }

  return [
    `[service] uninstalled: ${paths.label}`,
    `[service] removed plist: ${paths.plistPath}`,
  ].join('\n');
}

export async function serviceStatus(label?: string): Promise<string> {
  requireDarwin();
  const paths = resolveServicePaths(label);
  const exists = await fileExists(paths.plistPath);
  const target = serviceTarget(paths.label);
  const result = await runCommand('launchctl', ['print', target]);

  if (result.code !== 0) {
    const detail = normalizeLaunchctlError(result);
    const missing = isMissingServiceError(detail);

    return [
      `[service] label: ${paths.label}`,
      `[service] plist: ${exists ? 'present' : 'missing'} (${paths.plistPath})`,
      `[service] loaded: no`,
      `[service] running: no`,
      `[service] detail: ${missing ? 'not loaded' : detail}`,
    ].join('\n');
  }

  const parsed = parseLaunchctlPrint(result.stdout);
  const running = parsed.state === 'running' || Boolean(parsed.pid);

  return [
    `[service] label: ${paths.label}`,
    `[service] plist: ${exists ? 'present' : 'missing'} (${paths.plistPath})`,
    `[service] loaded: yes`,
    `[service] running: ${running ? 'yes' : 'no'}`,
    `[service] state: ${parsed.state || 'unknown'}`,
    `[service] pid: ${parsed.pid ?? 'n/a'}`,
    `[service] last_exit_code: ${parsed.lastExitCode ?? 'n/a'}`,
  ].join('\n');
}

function readLastLines(content: string, lines: number): string {
  const normalized = content.replace(/\r\n/gu, '\n');
  const split = normalized.split('\n');
  const sliced = split.slice(-Math.max(1, lines));
  return sliced.join('\n').trim();
}

async function readLogTail(filePath: string, lines: number): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return readLastLines(raw, lines);
  } catch {
    return '';
  }
}

export async function readServiceLogs(options: ServiceLogsOptions = {}): Promise<ServiceLogsResult> {
  requireDarwin();
  const paths = resolveServicePaths(options.label);
  const lines = Number.isInteger(options.lines) && (options.lines as number) > 0
    ? Number(options.lines)
    : 80;

  return {
    paths,
    stdout: await readLogTail(paths.stdoutLogPath, lines),
    stderr: await readLogTail(paths.stderrLogPath, lines),
  };
}

export function formatServiceLogs(result: ServiceLogsResult): string {
  return [
    `[service] stdout: ${result.paths.stdoutLogPath}`,
    result.stdout || '(empty)',
    '',
    `[service] stderr: ${result.paths.stderrLogPath}`,
    result.stderr || '(empty)',
  ].join('\n');
}

export async function runServiceCommand(
  subcommand: string | undefined,
  configLoader: (() => Promise<AppConfig>) | null,
  options: {
    label?: string;
    keepAwake?: string;
    lines?: number;
  } = {},
): Promise<string> {
  const action = (subcommand || '').trim().toLowerCase();
  const label = options.label;

  if (!action) {
    requireDarwin();
    const paths = resolveServicePaths(label);
    if (await fileExists(paths.plistPath)) {
      return startService(label);
    }

    if (!configLoader) {
      throw new Error('config is required for service install');
    }

    const config = await configLoader();
    return installService(config, {
      label,
      keepAwake: normalizeKeepAwakeMode(options.keepAwake),
    });
  }

  if (action === 'install') {
    if (!configLoader) {
      throw new Error('config is required for service install');
    }
    const config = await configLoader();
    return installService(config, {
      label,
      keepAwake: normalizeKeepAwakeMode(options.keepAwake),
    });
  }

  if (action === 'start') {
    return startService(label);
  }

  if (action === 'stop') {
    return stopService(label);
  }

  if (action === 'restart') {
    return restartService(label);
  }

  if (action === 'status') {
    return serviceStatus(label);
  }

  if (action === 'uninstall') {
    return uninstallService(label);
  }

  if (action === 'logs') {
    const logs = await readServiceLogs({ label, lines: options.lines });
    return formatServiceLogs(logs);
  }

  if (action === 'help') {
    return [
      'Usage:',
      '  im-agent-bridge service                                        # install/start (smart mode)',
      '  im-agent-bridge service install [--config path] [--label value] [--keepawake none|idle|system|on_ac]',
      '  im-agent-bridge service start [--label value]',
      '  im-agent-bridge service stop [--label value]',
      '  im-agent-bridge service restart [--label value]',
      '  im-agent-bridge service status [--label value]',
      '  im-agent-bridge service logs [--label value] [--lines number]',
      '  im-agent-bridge service uninstall [--label value]',
    ].join('\n');
  }

  throw new Error(`Unknown service command: ${subcommand}`);
}

export function serviceErrorMessage(error: unknown): string {
  return `[service] ${toErrorMessage(error)}`;
}
