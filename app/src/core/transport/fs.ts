import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Entry, ReadRange, Transport, WriteOptions } from './types';
import { joinRoot } from '../paths';
import { isWin, mapLimit } from '../util';
import { WinLister, wantsFastList, type Lister } from '../winlist';
import { t } from '../../shared/i18n';

const STREAM_THRESHOLD = 16 * 1024 * 1024;

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isPerm(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'EPERM' || code === 'EACCES';
}

function isBusy(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'EBUSY' || isPerm(e);
}

/** The file on the target cannot be replaced: a program holds it open (a loaded DLL, an open document) or it is not writable. */
export class InUseError extends Error {
  constructor(p: string) {
    super(t('{path} değiştirilemedi: dosya kullanımda (bir program açık tutuyor) ya da yazma izni yok', { path: p }));
    this.name = 'InUseError';
  }
}

export function progressCounter(onProgress?: (n: number) => void): Transform {
  let n = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      onProgress?.(n);
      cb(null, chunk);
    },
  });
}

/** Local folders, UNC paths (\\server\share\...) and mounted network shares. */
export class FsTransport implements Transport {
  readonly kind = 'fs' as const;
  readonly caseInsensitive: boolean;
  /**
   * Folders this transport created or saw, so a send of many files into one folder asks the file system
   * for the folder once, not once per file (every such question is a round trip on a share).
   */
  private knownDirs = new Set<string>();

  constructor(readonly root: string) {
    this.caseInsensitive = isWin || process.platform === 'darwin';
  }

  localPath(rel: string): string {
    return joinRoot(this.root, rel);
  }

  private dirKey(abs: string): string {
    return this.caseInsensitive ? abs.toLowerCase() : abs;
  }

  /** Creates a folder (and its parents) unless it is known to exist already. */
  private async ensureDir(abs: string): Promise<void> {
    const key = this.dirKey(abs);
    if (this.knownDirs.has(key)) return;
    await fsp.mkdir(abs, { recursive: true });
    // the parents exist too now
    this.assumeDir('');
    let p = abs;
    while (true) {
      const k = this.dirKey(p);
      if (this.knownDirs.has(k)) break;
      this.knownDirs.add(k);
      const parent = path.dirname(p);
      if (parent === p) break;
      p = parent;
    }
  }

  assumeDir(rel: string): void {
    let p = this.localPath(rel);
    while (true) {
      const k = this.dirKey(p);
      if (this.knownDirs.has(k)) break;
      this.knownDirs.add(k);
      const parent = path.dirname(p);
      if (parent === p) break;
      p = parent;
    }
  }

  /** A folder went away (removed or renamed): forget it and everything below it. */
  private forgetDir(abs: string): void {
    const key = this.dirKey(abs);
    const prefix = key.endsWith(path.sep) ? key : key + path.sep;
    for (const k of this.knownDirs) if (k === key || k.startsWith(prefix)) this.knownDirs.delete(k);
  }

  async stat(rel: string): Promise<Entry | null> {
    try {
      const st = await fsp.stat(this.localPath(rel));
      return { rel, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: Math.floor(st.mtimeMs) };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  lister(): Lister | null {
    return wantsFastList(this.root) ? new WinLister() : null;
  }

  async list(rel: string): Promise<Entry[]> {
    const dir = this.localPath(rel);
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
    const out = await mapLimit(dirents, 24, async (d) => {
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      try {
        const st = await fsp.stat(path.join(dir, d.name));
        return { rel: childRel, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: Math.floor(st.mtimeMs) } as Entry;
      } catch {
        return null; // broken link, vanished file
      }
    });
    return out.filter((x): x is Entry => !!x);
  }

  async readStream(rel: string, range?: ReadRange): Promise<Readable> {
    const p = this.localPath(rel);
    await fsp.access(p, fs.constants.R_OK);
    return fs.createReadStream(p, { highWaterMark: 1024 * 1024, ...(range ? { start: range.start, end: range.end } : {}) });
  }

  async writeStream(rel: string, data: Readable, opts: WriteOptions = {}): Promise<number> {
    const p = this.localPath(rel);
    await this.ensureDir(path.dirname(p));
    let written = 0;
    await pipeline(
      data,
      progressCounter((n) => {
        written = n;
        opts.onProgress?.(n);
      }),
      fs.createWriteStream(p, { highWaterMark: 1024 * 1024 }),
      { signal: opts.signal },
    );
    if (opts.mtimeMs != null) await this.setMtime(rel, opts.mtimeMs);
    return written;
  }

  async appendStream(rel: string, data: Readable, opts: WriteOptions = {}): Promise<number> {
    const p = this.localPath(rel);
    const before = (await fsp.stat(p)).size;
    let written = 0;
    await pipeline(
      data,
      progressCounter((n) => {
        written = n;
        opts.onProgress?.(before + n);
      }),
      fs.createWriteStream(p, { flags: 'a', highWaterMark: 1024 * 1024 }),
      { signal: opts.signal },
    );
    if (opts.mtimeMs != null) await this.setMtime(rel, opts.mtimeMs);
    return before + written;
  }

  async copyFromLocal(abs: string, rel: string, opts: WriteOptions = {}): Promise<number> {
    const p = this.localPath(rel);
    await this.ensureDir(path.dirname(p));
    const st = await fsp.stat(abs);
    const mtime = opts.mtimeMs ?? st.mtimeMs;
    if (st.size < STREAM_THRESHOLD || !opts.onProgress) {
      await fsp.copyFile(abs, p);
      opts.onProgress?.(st.size);
      // Windows copies the modification time along with the file (CopyFile), so it is set again only when
      // another one is wanted; elsewhere it is set every time
      if (!isWin || Math.abs(mtime - st.mtimeMs) >= 1) await this.setMtime(rel, mtime);
    } else {
      await pipeline(fs.createReadStream(abs, { highWaterMark: 1024 * 1024 }), progressCounter(opts.onProgress), fs.createWriteStream(p, { highWaterMark: 1024 * 1024 }), { signal: opts.signal });
      await this.setMtime(rel, mtime);
    }
    return st.size;
  }

  async copyWithin(fromRel: string, toRel: string): Promise<void> {
    const from = this.localPath(fromRel);
    const to = this.localPath(toRel);
    await this.ensureDir(path.dirname(to));
    await fsp.cp(from, to, { recursive: true, preserveTimestamps: true, force: true });
  }

  async mkdirp(rel: string): Promise<void> {
    await this.ensureDir(this.localPath(rel));
  }

  async remove(rel: string, isDir: boolean): Promise<void> {
    const p = this.localPath(rel);
    if (isDir) this.forgetDir(p);
    try {
      await fsp.rm(p, { recursive: isDir, force: true, maxRetries: 2 });
    } catch (e) {
      if (!isPerm(e)) throw e;
      await clearReadOnly(p, isDir);
      await fsp.rm(p, { recursive: isDir, force: true, maxRetries: 2 });
    }
  }

  async rename(fromRel: string, toRel: string): Promise<void> {
    const from = this.localPath(fromRel);
    const to = this.localPath(toRel);
    await this.ensureDir(path.dirname(to));
    this.forgetDir(from);
    try {
      await fsp.rename(from, to);
    } catch (e) {
      if (!isPerm(e)) throw e;
      // A read-only destination blocks the replace on Windows.
      await fsp.chmod(to, 0o666).catch(() => undefined);
      try {
        await fsp.rename(from, to);
      } catch (e2) {
        if (!isBusy(e2)) throw e2;
        // still refused: a program on the target holds the file (a loaded DLL, an open document), or no write right
        throw new InUseError(to);
      }
    }
  }

  /**
   * Opens the file for writing and closes it again: what a running program holds (a loaded DLL) refuses that.
   * One round trip, so a big file is not carried over the network only to fail at the end.
   */
  async checkReplaceable(rel: string): Promise<void> {
    const p = this.localPath(rel);
    try {
      const h = await fsp.open(p, 'r+');
      await h.close();
    } catch (e) {
      if (isMissing(e)) return;
      if (isBusy(e)) throw new InUseError(p);
      throw e;
    }
  }

  async setMtime(rel: string, mtimeMs: number): Promise<void> {
    const t = new Date(mtimeMs);
    await fsp.utimes(this.localPath(rel), t, t);
  }

  async freeSpace(): Promise<number | undefined> {
    try {
      const s = await fsp.statfs(this.root);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {}
}

async function clearReadOnly(p: string, isDir: boolean): Promise<void> {
  try {
    await fsp.chmod(p, isDir ? 0o777 : 0o666);
    if (!isDir) return;
    for (const d of await fsp.readdir(p, { withFileTypes: true })) await clearReadOnly(path.join(p, d.name), d.isDirectory());
  } catch {
    /* best effort */
  }
}
