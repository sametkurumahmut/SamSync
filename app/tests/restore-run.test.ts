import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { buildSendPlan } from '../src/core/plan';
import { startRun, type ExecSettings } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { restoreRunGroups } from '../src/core/backups';
import { tmpDir, write, read, pathNode, makeCtx, defaultOptions } from './helpers';

const settings = (backup: boolean): ExecSettings => ({
  label: 'send',
  origin: 'send',
  dryRun: false,
  backup,
  backupKeep: 5,
  backupFolderName: '_Yedek',
  verify: false,
  retryCount: 0,
  waitSeconds: 0,
  parallelGroups: 1,
  parallelFiles: 2,
  postCommandTimeoutSeconds: 5,
  sources: [],
  targetIds: ['T'],
  options: { backup },
});

describe('undoing a whole run', () => {
  it('brings replaced and deleted files back from the run backups and removes what the run created', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    await write(path.join(src, 'a.txt'), 'new a', new Date('2026-02-02T00:00:00Z'));
    await write(path.join(src, 'b.txt'), 'brand new');
    await write(path.join(tgt, 'a.txt'), 'old a', new Date('2026-01-01T00:00:00Z'));
    await write(path.join(tgt, 'gone.txt'), 'to be mirrored away');
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [src], path.join(base, 'ud'));
    const node = ctx.config.nodes[0];

    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: { ...defaultOptions, mode: 'mirror', backup: true }, origin: 'send' });
    const tp = plan.targets[0];
    const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null }));
    const run = await startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, node), ops, backup: true }], settings(true)).done;
    expect(run.status).toBe('ok');
    expect(read(path.join(tgt, 'a.txt'))).toBe('new a');
    expect(read(path.join(tgt, 'b.txt'))).toBe('brand new');
    expect(fs.existsSync(path.join(tgt, 'gone.txt'))).toBe(false);
    expect(run.targets[0].backupPath).toMatch(/^_Yedek\//);

    const groups = await restoreRunGroups(ctx, run);
    expect(groups).toHaveLength(1);
    expect(groups[0].ops.map((o) => `${o.kind}:${o.rel}`).sort()).toEqual(['copy:a.txt', 'copy:gone.txt', 'delete:b.txt']);
    const undo = await startRun(ctx, groups, { ...settings(false), label: 'undo', origin: 'restore' }).done;
    expect(undo.status).toBe('ok');
    expect(read(path.join(tgt, 'a.txt'))).toBe('old a');
    expect(read(path.join(tgt, 'gone.txt'))).toBe('to be mirrored away');
    expect(fs.existsSync(path.join(tgt, 'b.txt'))).toBe(false);
  });

  it('has nothing to offer for a run without backups beyond removing what it created', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    await write(path.join(src, 'n.txt'), 'n');
    await write(path.join(tgt, 'keep.txt'), 'k');
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [src], path.join(base, 'ud'));
    const node = ctx.config.nodes[0];
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
    const tp = plan.targets[0];
    const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: false }));
    const run = await startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, node), ops }], settings(false)).done;
    const groups = await restoreRunGroups(ctx, run);
    expect(groups[0]?.ops.map((o) => `${o.kind}:${o.rel}`)).toEqual(['delete:n.txt']);
  });
});
