import crypto from 'node:crypto';
import type { AgentName, PlatformKind } from '../shared/index.js';
import type { SessionRecord } from './types.js';
import { cloneJson, nowIso } from '../utils.js';
import { DEFAULT_PLATFORM_KIND } from '../config/index.js';

export function emptyProviderSessionIds(): Record<AgentName, string | null> {
  return {
    claude: null,
    codex: null,
    neovate: null,
    opencode: null,
  };
}

export function emptyProviderWorkingDirs(): Record<AgentName, string | null> {
  return {
    claude: null,
    codex: null,
    neovate: null,
    opencode: null,
  };
}

export function normalizeSession(session: SessionRecord | null): SessionRecord | null {
  if (!session) {
    return session;
  }

  return {
    ...session,
    workingDir: session.workingDir || null,
    providerSessionIds: {
      ...emptyProviderSessionIds(),
      ...(session.providerSessionIds || {}),
    },
    providerWorkingDirs: {
      ...emptyProviderWorkingDirs(),
      ...(session.providerWorkingDirs || {}),
    },
  };
}

export function cloneSession(session: SessionRecord): SessionRecord {
  return cloneJson(normalizeSession(session) as SessionRecord);
}

export function createSessionRecord(
  userId: string,
  activeAgent: AgentName,
  workingDir: string | null = null,
  platform: PlatformKind = DEFAULT_PLATFORM_KIND,
): SessionRecord {
  const timestamp = nowIso();
  return normalizeSession({
    id: crypto.randomUUID(),
    platform,
    platformUserId: userId,
    activeAgent,
    workingDir,
    providerSessionIds: emptyProviderSessionIds(),
    providerWorkingDirs: emptyProviderWorkingDirs(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }) as SessionRecord;
}
