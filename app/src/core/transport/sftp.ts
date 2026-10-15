import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client, type SFTPWrapper, type ConnectConfig } from 'ssh2';
import type { Entry, Transport, WriteOptions } from './types';
import { progressCounter } from './fs';
import { mapLimit } from '../util';
import { t } from '../../shared/i18n';

export interface SftpOptions {
  host: string;
  port?: number;
  username: string;
  root: string;
  privateKeyPath?: string;
  useAgent?: boolean;
  password?: string;
  readyTimeoutMs?: number;
}

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;

function cb<T>(fn: (done: (err: Error | null | undefined, v?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v as T))));
}

function isNoSuchFile(e: unknown): boolean {
  return (e as { code?: number })?.code === 2;
}

export class SftpTransport implements Transport {
  readonly kind = 'sftp' as const;
  readonly caseInsensitive = false;
  readonly root: string;
  private client: Client | null = null;
  private sftp: Promise<SFTPWrapper> | null = null;
  private base: string;

  constructor(private opts: SftpOptions) {
    this.base = ('/' + opts.root.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).replace(/\/+$/, '') || '/';
    this.root = `sftp://${opts.username}@${opts.host}${opts.port && opts.port !== 22 ? ':' + opts.port : ''}${this.base}`;
  }

  private abs(rel: string): string {
    if (!rel) return this.base;
    return (this.base === '/' ? '' : this.base) + '/' + rel;
  }

  private async conn(): Promise<SFTPWrapper> {
    if (this.sftp) return this.sftp;
    this.sftp = (async () => {
      const cfg: ConnectConfig = {
        host: this.opts.host,
        port: this.opts.port ?? 22,
        username: this.opts.username,
        readyTimeout: this.opts.readyTimeoutMs ?? 10000,
        keepaliveInterval: 15000,
      };
      if (this.opts.privateKeyPath) cfg.privateKey = await fs.readFile(this.opts.privateKeyPath);
      if (this.opts.password) cfg.password = this.opts.password;
      if (this.opts.useAgent) cfg.agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);
      const client = new Client();
      this.client = client;
      await new Promise<void>((resolve, reject) => {
        client.once('ready', () => resolve());
        client.once('error', reject);
        client.connect(cfg);
      });
      client.on('error', () => {
        this.sftp = null;
      });
      client.on('close', () => {
        this.sftp = null;
        this.client = null;
      });
      return cb<SFTPWrapper>((d) => client.sftp(d));
    })();
    this.sftp.catch(() => {
      this.sftp = null;
    });
    return this.sftp;
  }

  async stat(rel: string): Promise<Entry | null> {
    const s = await this.conn();
    try {
      const st = await cb<any>((d) => s.stat(this.abs(rel), d));
      const isDir = (st.mode & S_IFMT) === S_IFDIR;
      return { rel, isDir, size: isDir ? 0 : Number(st.size), mtimeMs: Number(st.mtime) * 1000 };
    } catch (e) {
      if (isNoSuchFile(e)) return null;
      throw e;
    }
  }

  async list(rel: string): Promise<Entry[]> {
    const s = await this.conn();
    let items: any[];
    try {
      items = await cb<any[]>((d) => s.readdir(this.abs(rel), d));
    } catch (e) {
      if (isNoSuchFile(e)) return [];
      throw e;
    }
    const out = await mapLimit(items, 16, async (it) => {
      const childRel = rel ? `${rel}/${it.filename}` : it.filename;
      let attrs = it.attrs;
      if ((attrs.mode & S_IFMT) === 0o120000) {
        // symlink: follow it
        try {
          attrs = await cb<any>((d) => s.stat(this.abs(childRel), d));
        } catch {
          return null;
        }
      }
      const isDir = (attrs.mode & S_IFMT) === S_IFDIR;
      return { rel: childRel, isDir, size: isDir ? 0 : Number(attrs.size), mtimeMs: Number(attrs.mtime) * 1000 } as Entry;
    });
    return out.filter((x): x is Entry => !!x);
  }

  async readStream(rel: string): Promise<Readable> {
    const s = await this.conn();
    return s.createReadStream(this.abs(rel));
  }

  async writeStream(rel: string, data: Readable, opts: WriteOptions = {}): Promise<number> {
    const s = await this.conn();
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    await this.mkdirp(parent);
    let written = 0;
    await pipeline(
      data,
      progressCounter((n) => {
        written = n;
        opts.onProgress?.(n);
      }),
      s.createWriteStream(this.abs(rel)),
    );
    if (opts.mtimeMs != null) await this.setMtime(rel, opts.mtimeMs);
    return written;
  }

  async copyFromLocal(abs: string, rel: string, opts: WriteOptions = {}): Promise<number> {
    const st = await fs.stat(abs);
    const { createReadStream } = await import('node:fs');
    const n = await this.writeStream(rel, createReadStream(abs), { ...opts, mtimeMs: opts.mtimeMs ?? st.mtimeMs });
    return n;
  }

  async copyWithin(fromRel: string, toRel: string): Promise<void> {
    const st = await this.stat(fromRel);
    if (!st) throw new Error(t('Bulunamadı: {path}', { path: fromRel }));
    if (!st.isDir) {
      await this.writeStream(toRel, await this.readStream(fromRel), { mtimeMs: st.mtimeMs });
      return;
    }
    await this.mkdirp(toRel);
    for (const child of await this.list(fromRel)) {
      const name = child.rel.slice(child.rel.lastIndexOf('/') + 1);
      await this.copyWithin(child.rel, `${toRel}/${name}`);
    }
  }

  async mkdirp(rel: string): Promise<void> {
    if (!rel) return;
    const s = await this.conn();
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      const st = await this.stat(sub);
      if (st?.isDir) continue;
      if (st) throw new Error(t('Klasör oluşturulamadı, aynı adda dosya var: {path}', { path: sub }));
      await cb((d) => s.mkdir(this.abs(sub), d)).catch(async (e) => {
        if (!(await this.stat(sub))?.isDir) throw e;
      });
    }
  }

  async remove(rel: string, isDir: boolean): Promise<void> {
    const s = await this.conn();
    const st = await this.stat(rel);
    if (!st) return;
    if (!st.isDir) {
      await cb((d) => s.unlink(this.abs(rel), d));
      return;
    }
    void isDir;
    for (const child of await this.list(rel)) await this.remove(child.rel, child.isDir);
    await cb((d) => s.rmdir(this.abs(rel), d));
  }

  async rename(fromRel: string, toRel: string): Promise<void> {
    const s = await this.conn();
    const parent = toRel.includes('/') ? toRel.slice(0, toRel.lastIndexOf('/')) : '';
    await this.mkdirp(parent);
    try {
      await cb((d) => (s as any).ext_openssh_rename(this.abs(fromRel), this.abs(toRel), d));
    } catch {
      const existing = await this.stat(toRel);
      if (existing && !existing.isDir) await cb((d) => s.unlink(this.abs(toRel), d));
      await cb((d) => s.rename(this.abs(fromRel), this.abs(toRel), d));
    }
  }

  async setMtime(rel: string, mtimeMs: number): Promise<void> {
    const s = await this.conn();
    const secs = Math.floor(mtimeMs / 1000);
    await cb((d) => s.utimes(this.abs(rel), secs, secs, d));
  }

  async freeSpace(): Promise<number | undefined> {
    try {
      const s = await this.conn();
      const v = await cb<any>((d) => (s as any).ext_openssh_statvfs(this.base, d));
      return Number(v.bavail) * Number(v.frsize || v.bsize);
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    this.client?.end();
    this.client = null;
    this.sftp = null;
  }
}

export function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(process.env.USERPROFILE || process.env.HOME || '', p.slice(1));
  return p;
}
