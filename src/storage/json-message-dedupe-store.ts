import path from 'node:path';
import { ensureDir, readJson, writeJsonAtomic } from '../utils';
import type { MessageDedupeStoreLike } from './types';

export class JsonMessageDedupeStore implements MessageDedupeStoreLike {
  private stateDir: string;
  private dedupeFile: string;
  public records: Record<string, number>;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.dedupeFile = path.join(stateDir, 'message-dedupe.json');
    this.records = {};
  }

  async init(): Promise<void> {
    await ensureDir(this.stateDir);
    this.records = await readJson<Record<string, number>>(this.dedupeFile, {});
    await this.prune();
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.dedupeFile, this.records);
  }

  async prune(now = Date.now()): Promise<void> {
    let dirty = false;

    for (const [messageId, expiresAt] of Object.entries(this.records)) {
      if (Number(expiresAt) <= now) {
        delete this.records[messageId];
        dirty = true;
      }
    }

    if (dirty) {
      await this.persist();
    }
  }

  async has(messageId?: string): Promise<boolean> {
    await this.prune();
    return Boolean(messageId && this.records[messageId] && this.records[messageId] > Date.now());
  }

  async remember(messageId: string | undefined, ttlMs: number): Promise<void> {
    if (!messageId) {
      return;
    }

    this.records[messageId] = Date.now() + ttlMs;
    await this.persist();
  }
}
