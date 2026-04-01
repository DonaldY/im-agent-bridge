import path from 'node:path';
import type { AgentName, PlatformKind } from '../shared';
import type { SessionRecord } from './types';
import { ensureDir, nowIso, readJson, writeJsonAtomic } from '../utils';
import type { SessionRepositoryLike } from './types';
import { cloneSession, createSessionRecord, normalizeSession } from './session-utils';
import { DEFAULT_PLATFORM_KIND } from '../config';

export class JsonSessionRepository implements SessionRepositoryLike {
  private stateDir: string;
  private sessionsFile: string;
  private activeFile: string;
  private sessions: Record<string, SessionRecord>;
  private activeSessions: Record<string, string>;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.sessionsFile = path.join(stateDir, 'sessions.json');
    this.activeFile = path.join(stateDir, 'active-sessions.json');
    this.sessions = {};
    this.activeSessions = {};
  }

  async init(): Promise<void> {
    await ensureDir(this.stateDir);
    this.sessions = await readJson<Record<string, SessionRecord>>(this.sessionsFile, {});
    this.activeSessions = await readJson<Record<string, string>>(this.activeFile, {});
  }

  private async persistSessions(): Promise<void> {
    await writeJsonAtomic(this.sessionsFile, this.sessions);
  }

  private async persistActiveSessions(): Promise<void> {
    await writeJsonAtomic(this.activeFile, this.activeSessions);
  }

  getSessionById(sessionId?: string | null): SessionRecord | null {
    const session = sessionId ? this.sessions[sessionId] : undefined;
    return session ? cloneSession(session) : null;
  }

  getActiveSession(userId: string): SessionRecord | null {
    const sessionId = this.activeSessions[userId];
    return sessionId ? this.getSessionById(sessionId) : null;
  }

  async createSession(userId: string, activeAgent: AgentName, workingDir: string | null = null, platform: PlatformKind = DEFAULT_PLATFORM_KIND): Promise<SessionRecord> {
    const session = createSessionRecord(userId, activeAgent, workingDir, platform);
    this.sessions[session.id] = session;
    this.activeSessions[userId] = session.id;
    await this.persistSessions();
    await this.persistActiveSessions();
    return cloneSession(session);
  }

  async ensureActiveSession(userId: string, activeAgent: AgentName, workingDir: string | null = null, platform: PlatformKind = DEFAULT_PLATFORM_KIND): Promise<SessionRecord> {
    return this.getActiveSession(userId) || this.createSession(userId, activeAgent, workingDir, platform);
  }

  async saveSession(session: SessionRecord): Promise<SessionRecord> {
    const updated = normalizeSession({
      ...session,
      updatedAt: nowIso(),
    }) as SessionRecord;

    this.sessions[updated.id] = cloneSession(updated);
    await this.persistSessions();
    return cloneSession(updated);
  }

  async replaceActiveSession(userId: string, activeAgent: AgentName, workingDir: string | null = null, platform: PlatformKind = DEFAULT_PLATFORM_KIND): Promise<SessionRecord> {
    return this.createSession(userId, activeAgent, workingDir, platform);
  }

  async setActiveAgent(userId: string, activeAgent: AgentName): Promise<SessionRecord> {
    const session = this.getActiveSession(userId);
    if (!session) {
      return this.createSession(userId, activeAgent);
    }

    session.activeAgent = activeAgent;
    return this.saveSession(session);
  }

  async setWorkingDir(userId: string, activeAgent: AgentName, workingDir: string): Promise<SessionRecord> {
    const session = this.getActiveSession(userId);
    if (!session) {
      return this.createSession(userId, activeAgent, workingDir);
    }

    if (session.workingDir !== workingDir) {
      session.providerSessionIds[activeAgent] = null;
      session.providerWorkingDirs[activeAgent] = null;
    }

    session.workingDir = workingDir;
    return this.saveSession(session);
  }
}
