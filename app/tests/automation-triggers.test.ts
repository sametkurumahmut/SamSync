import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import { nextRun } from '../src/core/automation';
import { changedFiles, classifyReflog, parseReflogLine, selectMoves } from '../src/core/gitwatch';
import type { SyncSchedule, WatchConfig } from '../src/shared/types';
import { tmpDir, write, read, pathNode, defaultOptions, sleep, gitCmd } from './helpers';

async function until(fn: () => boolean | Promise<boolean>, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error('zaman aşımı');
}

const sha = (c: string) => c.repeat(40);

describe('reflog', () => {
  it('tells commits and pulls from checkouts and rebase steps', () => {
    expect(classifyReflog('commit: Add x')).toBe('commit');
    expect(classifyReflog('commit (initial): first')).toBe('commit');
    expect(classifyReflog('commit (amend): fix')).toBe('amend');
    expect(classifyReflog('commit (merge): Merge branch b')).toBe('merge');
    expect(classifyReflog('pull: Fast-forward')).toBe('pull');
    expect(classifyReflog("pull: Merge made by the 'ort' strategy.")).toBe('pull');
    expect(classifyReflog('pull --rebase (start): checkout abc')).toBe('step');
    expect(classifyReflog('pull --rebase (finish): returning to refs/heads/master')).toBe('pull');
    expect(classifyReflog('merge feature: Fast-forward')).toBe('merge');
    expect(classifyReflog('rebase (pick): x')).toBe('step');
    expect(classifyReflog('rebase -i (finish): returning to refs/heads/x')).toBe('rebase');
    expect(classifyReflog('cherry-pick: y')).toBe('pick');
    expect(classifyReflog('reset: moving to HEAD~1')).toBe('reset');
    expect(classifyReflog('checkout: moving from master to b')).toBe('checkout');
    expect(parseReflogLine(`${sha('a')} ${sha('b')} Test <t@example.com> 1700000000 +0300\tcommit: x`)).toEqual({ from: sha('a'), to: sha('b'), message: 'commit: x' });
  });

  it('keeps the moves that were asked for and reports a rebase from where it started', () => {
    const e = (from: string, to: string, message: string) => ({ from: sha(from), to: sha(to), message });
    const moves = selectMoves(
      [e('1', '2', 'checkout: moving from a to b'), e('2', '3', 'commit: c'), e('3', '4', 'pull --rebase (start): checkout x'), e('4', '5', 'pull --rebase (pick): y'), e('5', '5', 'pull --rebase (finish): returning to refs/heads/b')],
      ['commit', 'pull'],
    );
    expect(moves).toEqual([
      { from: sha('2'), to: sha('3'), event: 'commit' },
      { from: sha('3'), to: sha('5'), event: 'pull' },
    ]);
  });

  it('lists what a commit changed below a watched sub folder, with paths under that folder', async () => {
    const repo = path.join(await tmpDir(), 'repo');
    await write(path.join(repo, 'top.txt'), '1');
    await write(path.join(repo, 'sub', 'a.txt'), '1');
    gitCmd(repo, 'init', '-q', '-b', 'master');
    gitCmd(repo, 'add', '.');
    gitCmd(repo, 'commit', '-q', '-m', 'first');
    const from = gitCmd(repo, 'rev-parse', 'HEAD').trim();
    await write(path.join(repo, 'top.txt'), '2');
    await write(path.join(repo, 'sub', 'a.txt'), '2');
    gitCmd(repo, 'commit', '-q', '-am', 'second');
    const to = gitCmd(repo, 'rev-parse', 'HEAD').trim();
    expect(await changedFiles(path.join(repo, 'sub'), from, to)).toEqual([path.join(repo, 'sub', 'a.txt')]);
    expect((await changedFiles(repo, from, to)).sort()).toEqual([path.join(repo, 'sub', 'a.txt'), path.join(repo, 'top.txt')].sort());
  });

  it('can skip a schedule slot that passed while the app was closed', () => {
    const s: SyncSchedule = { enabled: true, mode: 'times', everyMinutes: 60, times: ['00:00'], notify: 'errors' };
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const since = now.getTime() - 13 * 3600_000;
    expect(nextRun(s, undefined, since, now.getTime(), true)).toBeLessThanOrEqual(now.getTime());
    expect(nextRun(s, undefined, since, now.getTime(), false)).toBeGreaterThan(now.getTime());
  });
});

interface Setup {
  base: string;
  svc: Service;
  watch(cfg: Partial<WatchConfig>): Promise<void>;
}

async function setup(nodes: object[], settings: object = {}): Promise<Setup> {
  const base = await tmpDir();
  const ud = path.join(base, 'ud');
  await fsp.mkdir(ud, { recursive: true });
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes }));
  await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me', ...settings }));
  const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
  await svc.init();
  return {
    base,
    svc,
    async watch(cfg) {
      await svc.watchAdd({ name: 'w', paths: [], targetIds: [], options: { ...defaultOptions, notify: false }, quietMs: 150, enabled: true, ...cfg });
    },
  };
}

describe('watch destinations and triggers', () => {
  it('sends to a plain folder with no machine in the configuration, relative to the watched folder', async () => {
    const s = await setup([]);
    const src = path.join(s.base, 'src', 'Data');
    const dst = path.join(s.base, 'out');
    await fsp.mkdir(src, { recursive: true });
    try {
      await s.watch({ paths: [src], folders: [dst] });
      await sleep(100);
      await write(path.join(src, 'sub', 'a.txt'), 'v1');
      // the file lands before the run is over and its status recorded: wait for the status, then read the file
      await until(async () => (await s.svc.automationState()).watches[0].lastStatus === 'ok');
      expect(read(path.join(dst, 'sub', 'a.txt'))).toBe('v1');
    } finally {
      s.svc.automation?.stop();
    }
  });

  it('sends what differs on "send now", also while the watch is off', async () => {
    const s = await setup([]);
    const src = path.join(s.base, 'src');
    const dst = path.join(s.base, 'out');
    await write(path.join(src, 'a.txt'), 'a');
    await write(path.join(src, 'sub', 'b.txt'), 'b');
    const last = async () => (await s.svc.automationState()).watches[0];
    try {
      await s.watch({ paths: [src], folders: [dst], enabled: false, options: { ...defaultOptions, notify: false, propagateDeletes: true } });
      const id = (await last()).id;
      await s.svc.watchRunNow(id);
      await until(async () => (await last()).lastStatus === 'ok');
      expect(read(path.join(dst, 'a.txt'))).toBe('a');
      expect(read(path.join(dst, 'sub', 'b.txt'))).toBe('b');
      // a second click finds nothing to send
      await s.svc.watchRunNow(id);
      await until(async () => (await last()).lastStatus === 'nothing');
      // a missing watched folder is reported, never deleted on the target
      await fsp.rm(src, { recursive: true, force: true });
      await s.svc.watchRunNow(id);
      await until(async () => (await last()).lastStatus === 'failed');
      expect(read(path.join(dst, 'a.txt'))).toBe('a');
    } finally {
      s.svc.automation?.stop();
    }
  });

  it('sends what a commit changed and leaves a branch switch alone', async () => {
    const repo = path.join((await tmpDir()), 'repo');
    await fsp.mkdir(repo, { recursive: true });
    gitCmd(repo, 'init', '-q', '-b', 'master');
    await write(path.join(repo, 'base.txt'), 'base');
    gitCmd(repo, 'add', '.');
    gitCmd(repo, 'commit', '-q', '-m', 'base');
    const s = await setup([]);
    const dst = path.join(s.base, 'out');
    try {
      await s.watch({ paths: [repo], folders: [dst], trigger: 'git', gitEvents: ['commit', 'pull'] });
      // a branch with its own file: switching to it must not send anything
      gitCmd(repo, 'checkout', '-q', '-b', 'other');
      await write(path.join(repo, 'branch-only.txt'), 'b');
      gitCmd(repo, 'add', '.');
      gitCmd(repo, 'commit', '-q', '-m', 'on other');
      gitCmd(repo, 'checkout', '-q', 'master');
      await fsp.rm(dst, { recursive: true, force: true });
      await s.svc.automation!.pollGit();
      await sleep(300);
      // the commit on "other" was sent while it was checked out; the switch back sent nothing
      expect(read(path.join(dst, 'branch-only.txt'))).toBeNull();
      await write(path.join(repo, 'new.txt'), 'n');
      gitCmd(repo, 'add', '.');
      gitCmd(repo, 'commit', '-q', '-m', 'new');
      await s.svc.automation!.pollGit();
      await until(() => read(path.join(dst, 'new.txt')) === 'n');
      expect(read(path.join(dst, 'base.txt'))).toBeNull();
    } finally {
      s.svc.automation?.stop();
    }
  });

  it('does not keep changes for an unreachable machine unless retrying is on', async () => {
    const offline = (dir: string) => pathNode('Off', path.join(dir, 'missing', 'deep'));
    for (const retry of [false, true]) {
      const tmp = await tmpDir();
      const s = await setup([{ ...pathNode('Me', path.join(tmp, 'me')) }, offline(tmp)], { automation: { retryUnreachable: retry, retryEveryMinutes: 30 } });
      const src = path.join(s.base, 'src');
      await fsp.mkdir(src, { recursive: true });
      try {
        await s.watch({ paths: [src], targetIds: ['Off'] });
        await sleep(100);
        await write(path.join(src, 'a.txt'), 'a');
        await until(async () => (await s.svc.automationState()).watches[0].lastRunAt != null);
        const w = (await s.svc.automationState()).watches[0];
        if (retry) expect(w.deferredTargets).toEqual(['Off']);
        else {
          expect(w.deferredTargets).toEqual([]);
          expect(w.unreachableTargets).toEqual(['Off']);
        }
      } finally {
        s.svc.automation?.stop();
      }
    }
  });

  it('holds back a burst bigger than the limit', async () => {
    const s = await setup([], { automation: { maxFilesPerSend: 2 } });
    const src = path.join(s.base, 'src');
    const dst = path.join(s.base, 'out');
    await fsp.mkdir(src, { recursive: true });
    try {
      await s.watch({ paths: [src], folders: [dst] });
      await sleep(100);
      for (const n of ['a', 'b', 'c']) await write(path.join(src, `${n}.txt`), n);
      await until(async () => (await s.svc.automationState()).watches[0].lastStatus === 'cancelled');
      expect(fs.existsSync(path.join(dst, 'a.txt'))).toBe(false);
    } finally {
      s.svc.automation?.stop();
    }
  });

  it('runs a sync job on a change (live sync)', async () => {
    const tmp = await tmpDir();
    const left = path.join(tmp, 'left');
    const right = path.join(tmp, 'right');
    await fsp.mkdir(left, { recursive: true });
    await fsp.mkdir(right, { recursive: true });
    const base = path.join(tmp, 'cfg');
    const ud = path.join(base, 'ud');
    await fsp.mkdir(ud, { recursive: true });
    const job = {
      id: 'j1',
      name: 'Canlı',
      pairs: [{ id: 'p1', left: { kind: 'local', path: left }, right: { kind: 'local', path: right } }],
      compare: 'timeSize',
      variant: 'mirror',
      filter: { include: [], exclude: [] },
      deletion: 'permanent',
      versioningKeep: 3,
    };
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [pathNode('Me', path.join(tmp, 'me'))], syncJobs: [job] }));
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    try {
      await svc.watchAdd({ name: 'live', paths: [left], targetIds: [], syncJobId: 'j1', options: { ...defaultOptions, notify: false }, quietMs: 150, enabled: true });
      await sleep(100);
      await write(path.join(left, 'x.txt'), 'x');
      await until(() => read(path.join(right, 'x.txt')) === 'x');
    } finally {
      svc.automation?.stop();
    }
  });
});
