// Sends to a machine that was off: kept on this computer and sent once the machine answers again (the sources
// as they are then, so it gets the latest). A machine that stays off for a week is given up on.
import fsp from 'node:fs/promises';
import type { PendingSend, SendRequest } from '../shared/types';
import { newId } from './util';
import { writeJsonAtomic } from './config';

export const PENDING_KEEP_MS = 7 * 86400_000;
const CHECK_MS = 60_000;

export interface PendingHost {
  /** Does the machine answer now? */
  reachable(targetId: string): Promise<boolean>;
  /** Plans and runs the send; 'done' (sent, or nothing left to send), or the reason it did not go. */
  send(item: PendingSend): Promise<{ done: true } | { done: false; error: string }>;
  changed(items: PendingSend[]): void;
  expired(item: PendingSend): void;
}

/** Same machine, same sources and places: a later send replaces the earlier one waiting. */
function sameSend(a: SendRequest, b: SendRequest): boolean {
  return JSON.stringify(a.sources) === JSON.stringify(b.sources) && a.origin === b.origin;
}

export class PendingSends {
  private items: PendingSend[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private file: string,
    private host: PendingHost,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8')) as { items?: PendingSend[] };
      this.items = Array.isArray(raw.items) ? raw.items : [];
    } catch {
      this.items = [];
    }
  }

  list(): PendingSend[] {
    return this.items.map((x) => ({ ...x }));
  }

  /** Keeps the send of one machine that did not answer. */
  add(req: SendRequest, targetId: string, targetName: string, now = Date.now()): PendingSend {
    const request: SendRequest = { ...req, targetIds: [targetId], options: { ...req.options, dryRun: false } };
    const item: PendingSend = { id: newId('p-'), targetId, targetName, label: req.label ?? '', request, createdAt: now, attempts: 0 };
    this.items = [...this.items.filter((x) => !(x.targetId === targetId && sameSend(x.request, request))), item];
    void this.save();
    return item;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length === before) return false;
    void this.save();
    return true;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One look at every machine waited for; sends to those that answer, oldest first. */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy || !this.items.length) return;
    this.busy = true;
    try {
      for (const item of [...this.items].sort((a, b) => a.createdAt - b.createdAt)) {
        if (!this.items.some((x) => x.id === item.id)) continue;
        if (now - item.createdAt > PENDING_KEEP_MS) {
          this.items = this.items.filter((x) => x.id !== item.id);
          this.host.expired(item);
          continue;
        }
        const up = await this.host.reachable(item.targetId).catch(() => false);
        if (!up) continue;
        const r = await this.host.send(item).catch((e: unknown) => ({ done: false as const, error: e instanceof Error ? e.message : String(e) }));
        if (r.done) this.items = this.items.filter((x) => x.id !== item.id);
        else this.items = this.items.map((x) => (x.id === item.id ? { ...x, attempts: x.attempts + 1, lastTry: Date.now(), lastError: r.error } : x));
      }
    } finally {
      this.busy = false;
      await this.save();
    }
  }

  private async save(): Promise<void> {
    this.host.changed(this.list());
    await writeJsonAtomic(this.file, { items: this.items }).catch(() => undefined);
  }
}
