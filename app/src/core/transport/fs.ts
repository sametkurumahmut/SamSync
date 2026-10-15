import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Entry, Transport, WriteOptions } from './types';
import { joinRoot } from '../paths';
import { isWin, mapLimit } from '../util';

const STREAM_THRESHOLD = 16 * 1024 * 1024;

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isPerm(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'EPERM' || code === 'EACCES';
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

  constructor(readonly root: string) {
    this.caseInsensitive = isWin || process.platform === 'darwin';
  }

  localPath(rel: string): string {
    return joinRoot(this.root, rel);
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

  async readStream(rel: string): Promise<Readable> {
    const p = this.localPath(rel);
    await fsp.access(p, fs.constants.R_OK);
    return fs.createReadStream(p, { highWaterMark: 1024 * 1024 });
  }

  async writeStream(rel: string, data: Readable, opts: WriteOptions = {}): Promise<number> {
    const p = this.localPath(rel);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    let written = 0;
    await pipeline(
      data,
      progressCounter((n) => {
        written = n;
        opts.onProgress?.(n);
      }),
      fs.createWriteStream(p, { highWaterMark: 1024 * 1024 }),
    );
    if (opts.mtimeMs != null) await this.setMtime(rel, opts.mtimeMs);
    return written;
  }

  async copyFromLocal(abs: string, rel: string, opts: WriteOptions = {}): Promise<number> {
    const p = this.localPath(rel);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const st = await fsp.stat(abs);
    if (st.size < STREAM_THRESHOLD || !opts.onProgress) {
      await fsp.copyFile(abs, p);
      opts.onProgress?.(st.size);
    } else {
      await pipeline(fs.createReadStream(abs, { highWaterMark: 1024 * 1024 }), progressCounter(opts.onProgress), fs.createWriteStream(p, { highWaterMark: 1024 * 1024 }));
    }
    await this.setMtime(rel, opts.mtimeMs ?? st.mtimeMs);
    return st.size;
  }

  async copyWithin(fromRel: string, toRel: string): Promise<void> {
    const from = this.localPath(fromRel);
    const to = this.localPath(toRel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.cp(from, to, { recursive: true, preserveTimestamps: true, force: true });
  }

  async mkdirp(rel: string): Promise<void> {
    await fsp.mkdir(this.localPath(rel), { recursive: true });
  }

  async remove(rel: string, isDir: boolean): Promise<void> {
    const p = this.localPath(rel);
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
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try {
      await fsp.rename(from, to);
    } catch (e) {
      if (!isPerm(e)) throw e;
      // A read-only destination blocks the replace on Windows.
      await fsp.chmod(to, 0o666).catch(() => undefined);
      await fsp.rename(from, to);
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
