// Sends set for a time of their own ("Send later" in the review): kept on this computer and run at that time with the
// sources as they are then. The machines that are off can be woken a few minutes before. A time missed while the
// app was closed runs at the next start.
import fsp from 'node:fs/promises';
import type { ScheduledSend, SendRequest } from '../shared/types';
import { newId } from './util';
import { writeJsonAtomic } from './config';

/** How long before its time a send wakes the machines that are off. */
export const WAKE_AHEAD_MS = 5 * 60_000;
const CHECK_MS = 15_000;

export interface ScheduledHost {
  run(item: ScheduledSend): Promise<void>;
  wake(item: ScheduledSend): Promise<void>;
  changed(items: ScheduledSend[]): void;
}

export class ScheduledSends {
  private items: ScheduledSend[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private file: string,
    private host: ScheduledHost,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8')) as ScheduledSend[];
      this.items = Array.isArray(raw) ? raw.filter((x) => x?.id && typeof x.at === 'number' && x.request) : [];
    } catch {
      this.items = [];
    }
  }

  list(): ScheduledSend[] {
    return [...this.items].sort((a, b) => a.at - b.at);
  }

  private async save(): Promise<void> {
    await writeJsonAtomic(this.file, this.items).catch(() => undefined);
    this.host.changed(this.list());
  }

  async add(request: SendRequest, at: number, wake: boolean): Promise<ScheduledSend> {
    const item: ScheduledSend = { id: newId('later-'), at, label: request.label, request, wake, createdAt: Date.now() };
    this.items.push(item);
    await this.save();
    return item;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length === before) return false;
    await this.save();
    return true;
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Wakes what is due for waking and runs what is due; a test calls it with its own clock. */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const item of [...this.items]) {
        // cancelled while an earlier one was being woken or sent
        if (!this.items.some((x) => x.id === item.id)) continue;
        if (item.wake && !item.woke && now >= item.at - WAKE_AHEAD_MS) {
          item.woke = true;
          await this.save();
          await this.host.wake(item).catch(() => undefined);
        }
        if (now >= item.at) {
          this.items = this.items.filter((x) => x.id !== item.id);
          await this.save();
          await this.host.run(item).catch(() => undefined);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
