import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { buildSendPlan } from '../src/core/plan';
import { startRun, type ExecGroup } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import type { SendPlan, SendRequest } from '../src/shared/types';
import { tmpDir, write, read, pathNode, makeCtx, defaultOptions, daysAgo, gitCmd } from './helpers';

let src: string;
let t1: string;
let t2: string;
let data: string;

beforeEach(async () => {
  const base = await tmpDir();
  src = path.join(base, 'src');
  t1 = path.join(base, 't1');
  t2 = path.join(base, 't2');
  data = path.join(base, 'userdata');
  await fsp.mkdir(t1, { recursive: true });
  await fsp.mkdir(t2, { recursive: true });
});

function ctxFor() {
  return makeCtx({ nodes: [pathNode('T1', t1), pathNode('T2', t2)] }, [src], data);
}

async function execute(ctx: ReturnType<typeof ctxFor>, plan: SendPlan, opts: Partial<SendRequest['options']> = {}) {
  const groups: ExecGroup[] = plan.targets
    .filter((t) => t.reachable)
    .map((tp) => ({
      key: tp.targetId,
      title: tp.targetName,
      rootLabel: tp.root,
      open: () => transportForNode(ctx, ctx.config.nodes.find((n) => n.id === tp.targetId)!),
      ops: tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, replaceType: o.replaceType })),
    }));
  const o = { ...plan.request.options, ...opts };
  const h = startRun(ctx, groups, {
    label: 't',
    origin: 'send',
    dryRun: o.dryRun,
    backup: o.backup,
    backupKeep: 2,
    backupFolderName: ctx.config.copy.backupFolderName,
    verify: o.verify,
    retryCount: 0,
    waitSeconds: 0,
    parallelGroups: 2,
    parallelFiles: 4,
    postCommandTimeoutSeconds: 5,
    sources: [],
    targetIds: [],
  });
  return h.done;
}

const req = (paths: string[], opts: Partial<SendRequest['options']> = {}, targets = ['T1', 'T2']): SendRequest => ({
  sources: paths.map((p) => ({ kind: 'fs' as const, path: p })),
  targetIds: targets,
  options: { ...defaultOptions, ...opts },
  origin: 'send',
});

describe('send plan + run', () => {
  it('copies a file and a folder keeping relative paths, then sees everything as the same', async () => {
    await write(path.join(src, 'Data', 'a.entity'), 'AAA', daysAgo(2));
    await write(path.join(src, 'Models', 'm1.fbx'), 'M1', daysAgo(2));
    await write(path.join(src, 'Models', 'sub', 'm2.fbx'), 'M2', daysAgo(2));
    await fsp.mkdir(path.join(src, 'Models', 'empty'), { recursive: true });
    const ctx = ctxFor();
    const plan = await buildSendPlan(ctx, req([path.join(src, 'Data', 'a.entity'), path.join(src, 'Models')]));
    expect(plan.targets).toHaveLength(2);
    const tp = plan.targets[0];
    expect(tp.reachable).toBe(true);
    expect(tp.counts.new).toBeGreaterThanOrEqual(3);
    const run = await execute(ctx, plan);
    expect(run.status).toBe('ok');
    for (const t of [t1, t2]) {
      expect(read(path.join(t, 'Data', 'a.entity'))).toBe('AAA');
      expect(read(path.join(t, 'Models', 'sub', 'm2.fbx'))).toBe('M2');
      expect(fs.existsSync(path.join(t, 'Models', 'empty'))).toBe(true);
    }
    // mtimes are preserved, so a second plan has nothing to do
    const again = await buildSendPlan(ctx, req([path.join(src, 'Data', 'a.entity'), path.join(src, 'Models')]));
    expect(again.targets[0].ops.filter((o) => o.selected)).toHaveLength(0);
    expect(again.targets[0].counts.same).toBe(3);
    // no temp files left behind
    const leftovers = fs.readdirSync(path.join(t1, 'Models'), { recursive: true }).filter((f) => String(f).includes('.samsync-tmp'));
    expect(leftovers).toEqual([]);
  });

  it('classifies changed, target newer and extra files and honours update mode', async () => {
    await write(path.join(src, 'D', 'changed.txt'), 'new content', daysAgo(1));
    await write(path.join(src, 'D', 'older.txt'), 'source', daysAgo(5));
    await write(path.join(src, 'D', 'same.txt'), 'same', daysAgo(3));
    await write(path.join(t1, 'D', 'changed.txt'), 'old', daysAgo(4));
    await write(path.join(t1, 'D', 'older.txt'), 'target is newer', daysAgo(1));
    await write(path.join(t1, 'D', 'same.txt'), 'same', daysAgo(3));
    await write(path.join(t1, 'D', 'extra.txt'), 'extra', daysAgo(3));
    const ctx = ctxFor();
    const plan = await buildSendPlan(ctx, req([path.join(src, 'D')], { mode: 'update' }, ['T1']));
    const by = Object.fromEntries(plan.targets[0].ops.map((o) => [o.rel, o]));
    expect(by['D/changed.txt'].category).toBe('changed');
    expect(by['D/older.txt'].category).toBe('targetNewer');
    expect(by['D/older.txt'].selected).toBe(false);
    expect(by['D/extra.txt'].category).toBe('extra');
    expect(by['D/extra.txt'].selected).toBe(false);
    expect(by['D/same.txt']).toBeUndefined();
    expect(plan.targets[0].counts.same).toBe(1);
    await execute(ctx, plan);
    expect(read(path.join(t1, 'D', 'changed.txt'))).toBe('new content');
    expect(read(path.join(t1, 'D', 'older.txt'))).toBe('target is newer');
    expect(read(path.join(t1, 'D', 'extra.txt'))).toBe('extra');
  });

  it('mirror deletes extras and backup keeps the replaced and deleted versions', async () => {
    await write(path.join(src, 'M', 'keep.txt'), 'v2', daysAgo(1));
    await write(path.join(t1, 'M', 'keep.txt'), 'v1', daysAgo(3));
    await write(path.join(t1, 'M', 'gone.txt'), 'bye', daysAgo(3));
    await write(path.join(t1, 'M', 'olddir', 'x.txt'), 'x', daysAgo(3));
    const ctx = ctxFor();
    const plan = await buildSendPlan(ctx, req([path.join(src, 'M')], { mode: 'mirror', backup: true }, ['T1']));
    const dels = plan.targets[0].ops.filter((o) => o.kind === 'delete');
    // each item of an extra folder goes on its own, the folder itself once it is empty
    expect(dels.map((d) => d.rel).sort()).toEqual(['M/gone.txt', 'M/olddir', 'M/olddir/x.txt']);
    expect(dels.find((d) => d.rel === 'M/olddir')?.onlyIfEmpty).toBe(true);
    expect(dels.every((d) => d.selected)).toBe(true);
    const run = await execute(ctx, plan);
    expect(run.status).toBe('ok');
    expect(read(path.join(t1, 'M', 'keep.txt'))).toBe('v2');
    expect(fs.existsSync(path.join(t1, 'M', 'gone.txt'))).toBe(false);
    expect(fs.existsSync(path.join(t1, 'M', 'olddir'))).toBe(false);
    const backups = fs.readdirSync(path.join(t1, '_SamSyncYedek'));
    expect(backups).toHaveLength(1);
    const b = path.join(t1, '_SamSyncYedek', backups[0]);
    expect(read(path.join(b, 'M', 'keep.txt'))).toBe('v1');
    expect(read(path.join(b, 'M', 'gone.txt'))).toBe('bye');
    expect(read(path.join(b, 'M', 'olddir', 'x.txt'))).toBe('x');
    // the backup folder is never treated as an extra
    const plan2 = await buildSendPlan(ctx, req([src], { mode: 'mirror' }, ['T1']));
    expect(plan2.targets[0].ops.some((o) => o.rel.includes('_SamSyncYedek'))).toBe(false);
  });

  it('dry run writes nothing', async () => {
    await write(path.join(src, 'x.txt'), 'x');
    const ctx = ctxFor();
    const plan = await buildSendPlan(ctx, req([path.join(src, 'x.txt')], { dryRun: true }));
    const run = await execute(ctx, plan);
    expect(run.status).toBe('ok');
    expect(run.opsOk).toBe(2);
    expect(fs.existsSync(path.join(t1, 'x.txt'))).toBe(false);
  });

  it('content comparison catches equal size changes with equal times', async () => {
    const t = daysAgo(2);
    await write(path.join(src, 'c.txt'), 'abcd', t);
    await write(path.join(t1, 'c.txt'), 'abce', t);
    const ctx = ctxFor();
    expect((await buildSendPlan(ctx, req([path.join(src, 'c.txt')], {}, ['T1']))).targets[0].counts.same).toBe(1);
    const plan = await buildSendPlan(ctx, req([path.join(src, 'c.txt')], { compare: 'content' }, ['T1']));
    expect(plan.targets[0].ops[0].category).toBe('changed');
  });

  it('applies exclude filters and reports unreachable targets', async () => {
    await write(path.join(src, 'F', 'a.txt'), 'a');
    await write(path.join(src, 'F', 'a.pdb'), 'p');
    await write(path.join(src, 'F', 'Logs', 'l.txt'), 'l');
    const ctx = makeCtx({ nodes: [pathNode('T1', t1), pathNode('Gone', path.join(t1, 'does-not-exist'))] }, [src], data);
    const plan = await buildSendPlan(ctx, req([path.join(src, 'F')], { excludeFiles: ['*.pdb'], excludeDirs: ['Logs'] }, ['T1', 'Gone']));
    expect(plan.targets[0].ops.map((o) => o.rel).sort()).toEqual(['F', 'F/a.txt']);
    expect(plan.targets[1].reachable).toBe(false);
  });

  it('fills {source} and {destination} of the post-copy command, and counts a machine that was off as failed', async () => {
    await write(path.join(src, 'F', 'a.txt'), 'a');
    const ctx = ctxFor();
    const plan = await buildSendPlan(ctx, req([path.join(src, 'F')], {}, ['T1']));
    const node = ctx.config.nodes[0];
    const groups: ExecGroup[] = [
      {
        key: 'T1',
        title: 'T1',
        rootLabel: t1,
        node,
        open: () => transportForNode(ctx, node),
        ops: plan.targets[0].ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src })),
      },
      // what the service adds for an unreachable target: no operations, and opening it fails
      { key: 'Off', title: 'Off', rootLabel: '\\\\10.0.0.9\\x', open: () => Promise.reject(new Error('erişilemiyor')), ops: [] },
    ];
    const done = await startRun(ctx, groups, {
      label: 't',
      origin: 'send',
      dryRun: false,
      backup: false,
      backupKeep: 2,
      backupFolderName: ctx.config.copy.backupFolderName,
      verify: false,
      retryCount: 0,
      waitSeconds: 0,
      parallelGroups: 2,
      parallelFiles: 4,
      postCommand: 'echo {source} {destination}',
      postCommandTimeoutSeconds: 10,
      postSource: { path: path.join(src, 'F'), rel: 'F' },
      sources: [],
      targetIds: [],
    }).done;
    expect(done.log.some((l) => l.message.includes(`echo ${path.join(src, 'F')} ${path.join(t1, 'F')}`))).toBe(true);
    expect(done.targets.find((x) => x.key === 'Off')).toMatchObject({ status: 'failed', error: 'erişilemiyor' });
    expect(done.status).toBe('partial');
  });

  it('git deletions remove files on the target', async () => {
    await write(path.join(t1, 'old.txt'), 'old');
    const ctx = ctxFor();
    const plan = await buildSendPlan(ctx, { ...req([], {}, ['T1']), sources: [{ kind: 'delete', path: path.join(src, 'old.txt') }] });
    expect(plan.targets[0].ops[0]).toMatchObject({ kind: 'delete', category: 'deleted', selected: true });
    await execute(ctx, plan);
    expect(fs.existsSync(path.join(t1, 'old.txt'))).toBe(false);
  });

  it('sends commit content (git blobs) and compares by blob id', async () => {
    await fsp.mkdir(src, { recursive: true });
    gitCmd(src, 'init', '-q');
    await write(path.join(src, 'g', 'f.txt'), 'committed\n');
    gitCmd(src, 'add', '.');
    gitCmd(src, 'commit', '-q', '-m', 'c1');
    const sha = gitCmd(src, 'rev-parse', 'HEAD').trim();
    await write(path.join(src, 'g', 'f.txt'), 'edited after commit\n');
    const ctx = ctxFor();
    const plan = await buildSendPlan(ctx, { ...req([], {}, ['T1']), sources: [{ kind: 'git', repo: src, rev: sha, path: 'g/f.txt' }] });
    expect(plan.targets[0].ops[0].src?.kind).toBe('git');
    await execute(ctx, plan);
    expect(read(path.join(t1, 'g', 'f.txt'))?.replace(/\r\n/g, '\n')).toBe('committed\n');
    const again = await buildSendPlan(ctx, { ...req([], {}, ['T1']), sources: [{ kind: 'git', repo: src, rev: sha, path: 'g/f.txt' }] });
    expect(again.targets[0].counts.same).toBe(1);
  });
});
