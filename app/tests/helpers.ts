import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AppConfig, AppEvent, NodeConfig, SendOptions } from '../src/shared/types';
import type { CoreContext } from '../src/core/context';
import { emptyConfig } from '../src/core/config';
import { nullLogger } from '../src/core/logger';

export async function tmpDir(prefix = 'samsync-'): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function write(file: string, content: string, mtime?: Date): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  if (mtime) await fsp.utimes(file, mtime, mtime);
}

export function read(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function pathNode(id: string, dir: string, extra: Partial<NodeConfig> = {}): NodeConfig {
  return { id, name: id, address: '127.0.0.1', localRoots: [], networkRoot: '', enabled: true, transport: 'path', path: dir, ...extra };
}

export function makeCtx(cfg: Partial<AppConfig>, localRoots: string[], userData: string): CoreContext & { events: AppEvent[] } {
  const events: AppEvent[] = [];
  const base = emptyConfig();
  return {
    config: { ...base, ...cfg, copy: { ...base.copy, ...(cfg.copy ?? {}), retryCount: 0, waitSeconds: 0 } },
    localRoots,
    userDataPath: userData,
    emit: (e) => events.push(e),
    log: nullLogger,
    events,
  };
}

export const defaultOptions: SendOptions = {
  mode: 'overwrite',
  compare: 'timeSize',
  backup: false,
  dryRun: false,
  verify: false,
  excludeFiles: [],
  excludeDirs: [],
  parallelTargets: 4,
  propagateDeletes: true,
  runPostCommand: false,
  notify: false,
};

export function gitCmd(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
