// Content hashes remembered by (place, path, size, time): a content comparison that already read a file
// once, or a copy that hashed the bytes while writing them, does not read the file again over the network
// as long as its size and time still match. Kept in userData/hashcache.json, pruned by last use.
import fsp from 'node:fs/promises';
import path from 'node:path';

interface Entry {
  size: number;
  mtime: number;
  hash: string;
  /** last use, for pruning */
  at: number;
}

/** Two times this close count as the same (file systems round to seconds, FAT to two). */
const TOLERANCE_MS = 2000;

export class HashCache {
  private map = new Map<string, Entry>();
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  /** strictly increasing, so two uses in the same millisecond still order */
  private last = 0;

  private now(): number {
    this.last = Math.max(Date.now(), this.last + 1);
    return this.last;
  }

  constructor(
    private file: string,
    private max = 300_000,
  ) {}

  get size(): number {
    return this.map.size;
  }

  private static key(root: string, rel: string): string {
    return `${root.toLowerCase()}|${rel.toLowerCase()}`;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8')) as Record<string, Entry>;
      for (const [k, e] of Object.entries(raw)) if (e && typeof e.hash === 'string' && typeof e.size === 'number') this.map.set(k, e);
    } catch {
      /* no cache yet */
    }
  }

  /** The hash remembered for this file, when size and time still match; nothing otherwise. */
  get(root: string, rel: string, size: number, mtimeMs: number): string | undefined {
    const e = this.map.get(HashCache.key(root, rel));
    if (!e || e.size !== size || Math.abs(e.mtime - mtimeMs) >= TOLERANCE_MS) return undefined;
    e.at = this.now();
    return e.hash;
  }

  set(root: string, rel: string, size: number, mtimeMs: number, hash: string): void {
    this.map.set(HashCache.key(root, rel), { size, mtime: mtimeMs, hash, at: this.now() });
    this.dirty = true;
    this.flushSoon();
  }

  flushSoon(ms = 3000): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.map.size > this.max) {
      // the least recently used go first
      const sorted = [...this.map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, Math.floor(this.max * 0.9));
      this.map = new Map(sorted);
    }
    try {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(Object.fromEntries(this.map)), 'utf8');
      await fsp.rename(tmp, this.file);
    } catch {
      this.dirty = true;
    }
  }
}
