import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import * as git from '../src/core/git';
import { compareJob, syncGroups, updateDbAfterRun } from '../src/core/sync';
import { startRun } from '../src/core/executor';
import { findBackups, restoreGroups } from '../src/core/backups';
import type { SyncJob } from '../src/shared/types';
import { tmpDir, write, read, gitCmd, makeCtx, pathNode, daysAgo } from './helpers';

async function repoWithHistory() {
  const repo = await tmpDir('samsync-git-');
  gitCmd(repo, 'init', '-q', '-b', 'main');
  gitCmd(repo, 'config', 'core.autocrlf', 'false');
  await write(path.join(repo, 'a.txt'), 'a1\n');
  await write(path.join(repo, 'dir', 'b.txt'), 'b1\n');
  gitCmd(repo, 'add', '.');
  gitCmd(repo, 'commit', '-q', '-m', 'first');
  await write(path.join(repo, 'a.txt'), 'a1\na2\n');
  await write(path.join(repo, 'c.txt'), 'c1\n');
  gitCmd(repo, 'add', '.');
  gitCmd(repo, 'commit', '-q', '-m', 'second: add c');
  gitCmd(repo, 'mv', 'dir/b.txt', 'dir/b2.txt');
  gitCmd(repo, 'rm', '-q', 'c.txt');
  gitCmd(repo, 'commit', '-q', '-m', 'third: rename b, drop c');
  return repo;
}

describe('git', () => {
  it('lists commits with paging and search', async () => {
    const repo = await repoWithHistory();
    const page = await git.log(repo, { limit: 2 });
    expect(page.commits.map((c) => c.subject)).toEqual(['third: rename b, drop c', 'second: add c']);
    expect(page.hasMore).toBe(true);
    const next = await git.log(repo, { limit: 2, skip: 2 });
    expect(next.commits.map((c) => c.subject)).toEqual(['first']);
    expect(next.hasMore).toBe(false);
    const found = await git.log(repo, { search: 'SECOND' });
    expect(found.commits).toHaveLength(1);
    const bySha = await git.log(repo, { search: page.commits[1].short });
    expect(bySha.commits[0].subject).toBe('second: add c');
  });

  it('unions the files of several commits with the newest status', async () => {
    const repo = await repoWithHistory();
    const { commits } = await git.log(repo, {});
    const changes = await git.commitChanges(repo, [commits[0].sha, commits[1].sha]);
    const by = Object.fromEntries(changes.map((c) => [c.path, c]));
    expect(by['a.txt'].kind).toBe('M');
    expect(by['c.txt'].kind).toBe('D');
    expect(by['dir/b2.txt']).toMatchObject({ kind: 'R', oldPath: 'dir/b.txt' });
    expect(by['a.txt'].additions).toBe(1);
  });

  it('streams blobs and fails loudly for a missing path', async () => {
    const repo = await repoWithHistory();
    const chunks: Buffer[] = [];
    for await (const c of git.blobStream(repo, 'HEAD', 'a.txt')) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('a1\na2\n');
    await expect(
      (async () => {
        for await (const _ of git.blobStream(repo, 'HEAD', 'yok.txt')) void _;
      })(),
    ).rejects.toThrow(/cat-file/);
  });

  it('marks a file that was edited and later moved away as deleted', async () => {
    const repo = await tmpDir('samsync-git-');
    gitCmd(repo, 'init', '-q', '-b', 'main');
    await write(path.join(repo, 'x.txt'), 'x1\n');
    gitCmd(repo, 'add', '.');
    gitCmd(repo, 'commit', '-q', '-m', 'add x');
    await write(path.join(repo, 'x.txt'), 'x1\nx2\n');
    gitCmd(repo, 'commit', '-q', '-am', 'edit x');
    gitCmd(repo, 'mv', 'x.txt', 'y.txt');
    gitCmd(repo, 'commit', '-q', '-m', 'move x');
    const { commits } = await git.log(repo, {});
    const by = Object.fromEntries((await git.commitChanges(repo, [commits[0].sha, commits[1].sha])).map((c) => [c.path, c]));
    expect(by['x.txt'].kind).toBe('D');
    expect(by['y.txt']).toMatchObject({ kind: 'R', oldPath: 'x.txt' });
  });

  it('reads working tree status including untracked files and turns changes into sources', async () => {
    const repo = await repoWithHistory();
    await write(path.join(repo, 'a.txt'), 'a1\na2\na3\n');
    await write(path.join(repo, 'new.txt'), 'n\n');
    await fsp.rm(path.join(repo, 'dir', 'b2.txt'));
    const st = await git.status(repo);
    const by = Object.fromEntries(st.changes.map((c) => [c.path, c]));
    expect(by['a.txt']).toMatchObject({ kind: 'M', unstaged: true, additions: 1 });
    expect(by['new.txt'].kind).toBe('?');
    expect(by['dir/b2.txt'].kind).toBe('D');
    expect(st.info.branch).toBe('main');
    const sources = await git.gitSources({ repo, changes: st.changes, contentFrom: 'worktree' });
    const kinds = Object.fromEntries(sources.map((s) => [path.basename(s.path), s.kind]));
    expect(kinds).toMatchObject({ 'a.txt': 'fs', 'new.txt': 'fs', 'b2.txt': 'delete' });
  });

  it('resolves commit content and produces diffs', async () => {
    const repo = await repoWithHistory();
    const { commits } = await git.log(repo, {});
    const second = commits[1].sha;
    const sources = await git.gitSources({ repo, changes: [{ path: 'c.txt' }, { path: 'a.txt' }], contentFrom: 'commit', rev: second });
    expect(sources.map((s) => s.kind)).toEqual(['git', 'git']);
    const d = await git.fileDiff({ repo, path: 'a.txt', mode: 'commits', shas: [second] });
    expect(d.ok).toBe(true);
    expect(d.lines.filter((l) => l.t === 'add').map((l) => l.text)).toEqual(['a2']);
    await write(path.join(repo, 'a.txt'), 'changed\n');
    const w = await git.fileDiff({ repo, path: 'a.txt', mode: 'worktree' });
    expect(w.additions).toBe(1);
    expect(w.deletions).toBe(2);
    const untracked = await git.fileDiff({ repo, path: 'u.txt', mode: 'worktree' }).catch(() => null);
    expect(untracked?.ok ?? false).toBe(false);
  });
});

function job(left: string, rightNode: string, variant: SyncJob['variant']): SyncJob {
  return {
    id: 'j1',
    name: 'test',
    pairs: [{ id: 'p1', left: { kind: 'local', path: left }, right: { kind: 'node', nodeId: rightNode, subPath: '' } }],
    compare: 'timeSize',
    variant,
    filter: { include: [], exclude: [] },
    deletion: 'versioning',
    versioningKeep: 3,
  };
}

async function runSync(ctx: ReturnType<typeof makeCtx>, j: SyncJob) {
  const cmp = await compareJob(ctx, j);
  const groups = syncGroups(ctx, j, cmp);
  const h = startRun(ctx, groups, {
    label: 's',
    origin: 'sync',
    dryRun: false,
    backup: true,
    backupKeep: 3,
    backupFolderName: '_SamSyncYedek',
    verify: false,
    retryCount: 0,
    waitSeconds: 0,
    parallelGroups: 2,
    parallelFiles: 4,
    postCommandTimeoutSeconds: 5,
    sources: [],
    targetIds: [],
  });
  const detail = await h.done;
  await updateDbAfterRun(ctx, j, cmp, detail);
  return { cmp, detail };
}

describe('folder sync', () => {
  it('mirror makes the right side identical', async () => {
    const L = await tmpDir();
    const R = await tmpDir();
    await write(path.join(L, 'x', 'a.txt'), 'a', daysAgo(1));
    await write(path.join(R, 'x', 'a.txt'), 'old', daysAgo(3));
    await write(path.join(R, 'junk.txt'), 'j');
    const ctx = makeCtx({ nodes: [pathNode('R', R)] }, [], await tmpDir());
    const { cmp } = await runSync(ctx, job(L, 'R', 'mirror'));
    const by = Object.fromEntries(cmp.pairs[0].items.map((i) => [i.rel, i]));
    expect(by['x/a.txt']).toMatchObject({ category: 'leftNewer', action: 'copyRight' });
    expect(by['junk.txt']).toMatchObject({ category: 'rightOnly', action: 'deleteRight' });
    expect(read(path.join(R, 'x', 'a.txt'))).toBe('a');
    expect(fs.existsSync(path.join(R, 'junk.txt'))).toBe(false);
    const again = await compareJob(ctx, job(L, 'R', 'mirror'));
    expect(again.stats.byAction.none).toBe(again.pairs[0].items.length);
  });

  it('two way sync propagates creations, edits and deletions using the last sync state', async () => {
    const L = await tmpDir();
    const R = await tmpDir();
    await write(path.join(L, 'l.txt'), 'from left', daysAgo(2));
    await write(path.join(R, 'r.txt'), 'from right', daysAgo(2));
    await write(path.join(L, 'both.txt'), 'v1', daysAgo(5));
    await write(path.join(R, 'both.txt'), 'v1', daysAgo(5));
    const ctx = makeCtx({ nodes: [pathNode('R', R)] }, [], await tmpDir());
    const j = job(L, 'R', 'twoWay');
    await runSync(ctx, j);
    expect(read(path.join(R, 'l.txt'))).toBe('from left');
    expect(read(path.join(L, 'r.txt'))).toBe('from right');

    // delete on the right, edit on the left
    await fsp.rm(path.join(R, 'l.txt'));
    await write(path.join(L, 'both.txt'), 'v2 left', daysAgo(1));
    const { cmp } = await runSync(ctx, j);
    const by = Object.fromEntries(cmp.pairs[0].items.map((i) => [i.rel, i]));
    expect(by['l.txt'].action).toBe('deleteLeft');
    expect(by['both.txt'].action).toBe('copyRight');
    expect(fs.existsSync(path.join(L, 'l.txt'))).toBe(false);
    expect(read(path.join(R, 'both.txt'))).toBe('v2 left');

    // both sides edited -> conflict, nothing happens
    await write(path.join(L, 'both.txt'), 'left edit', daysAgo(0.5));
    await write(path.join(R, 'both.txt'), 'right edit!', daysAgo(0.4));
    const third = await compareJob(ctx, j);
    const item = third.pairs[0].items.find((i) => i.rel === 'both.txt')!;
    expect(item.category).toBe('conflict');
    expect(item.action).toBe('none');
  });

  it('finds backups and restores a version', async () => {
    const R = await tmpDir();
    await write(path.join(R, '_SamSyncYedek', '20260101-101010', 'cfg', 'x.ini'), 'old');
    await write(path.join(R, '_SamSyncYedek', '20260202-101010', 'cfg', 'x.ini'), 'older?');
    await write(path.join(R, 'cfg', 'x.ini'), 'current');
    const ctx = makeCtx({ nodes: [pathNode('R', R)] }, [], await tmpDir());
    const found = await findBackups(ctx, 'cfg/x.ini', ['R']);
    expect(found[0].versions.map((v) => v.stamp)).toEqual(['20260202-101010', '20260101-101010']);
    const groups = await restoreGroups(ctx, 'cfg/x.ini', [{ targetId: 'R', stamp: '20260101-101010' }]);
    const h = startRun(ctx, groups, {
      label: 'r',
      origin: 'restore',
      dryRun: false,
      backup: true,
      backupKeep: 10,
      backupFolderName: '_SamSyncYedek',
      verify: true,
      retryCount: 0,
      waitSeconds: 0,
      parallelGroups: 1,
      parallelFiles: 1,
      postCommandTimeoutSeconds: 5,
      sources: [],
      targetIds: [],
    });
    expect((await h.done).status).toBe('ok');
    expect(read(path.join(R, 'cfg', 'x.ini'))).toBe('old');
    expect(fs.readdirSync(path.join(R, '_SamSyncYedek'))).toHaveLength(3);
  });
});
