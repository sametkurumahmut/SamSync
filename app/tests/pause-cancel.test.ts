import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { buildSendPlan } from '../src/core/plan';
import { startRun, type ExecSettings, type RunHandle } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { tmpDir, write, pathNode, makeCtx, defaultOptions, sleep } from './helpers';

const settings: ExecSettings = {
  label: 'hold',
  origin: 'send',
  dryRun: false,
  backup: false,
  backupKeep: 0,
  backupFolderName: '_y',
  verify: false,
  retryCount: 0,
  waitSeconds: 0,
  parallelGroups: 2,
  parallelFiles: 1,
  postCommandTimeoutSeconds: 5,
  sources: [],
  targetIds: [],
};

/** Two target folders with the same source: 30 small files each, one at a time, so a run takes a moment. */
async function setup() {
  const base = await tmpDir();
  const root = path.join(base, 'root');
  for (let i = 0; i < 30; i++) await write(path.join(root, 'Release', `f${String(i).padStart(2, '0')}.txt`), `file ${i} `.repeat(200));
  const a = path.join(base, 'A');
  const b = path.join(base, 'B');
  await fsp.mkdir(a);
  await fsp.mkdir(b);
  const ctx = makeCtx({ nodes: [pathNode('A', a), pathNode('B', b)] }, [root], path.join(base, 'ud'));
  const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: path.join(root, 'Release') }], targetIds: ['A', 'B'], options: defaultOptions, origin: 'send', label: 'hold' });
  const groups = plan.targets.map((tp) => {
    const node = ctx.config.nodes.find((n) => n.id === tp.targetId)!;
    const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null }));
    return { key: tp.targetId, title: tp.targetName, rootLabel: tp.root, open: () => transportForNode(ctx, node), ops };
  });
  const start = (): RunHandle => startRun(ctx, groups, { ...settings, targetIds: ['A', 'B'] });
  return { ctx, a, b, start };
}

const filesIn = (dir: string) => (fs.existsSync(path.join(dir, 'Release')) ? fs.readdirSync(path.join(dir, 'Release')).length : 0);

describe('pausing and dropping targets from a run', () => {
  it('holds every target while paused and finishes after resume', async () => {
    const { ctx, a, b, start } = await setup();
    const h = start();
    h.pause(true);
    expect(h.paused).toBe(true);
    await sleep(300);
    // nothing moved: the first operation of each target waits at the gate
    expect(filesIn(a)).toBe(0);
    expect(filesIn(b)).toBe(0);
    expect(ctx.events.some((e) => e.type === 'run-paused' && e.paused)).toBe(true);
    h.pause(false);
    const d = await h.done;
    expect(d.status).toBe('ok');
    expect(d.paused).toBeUndefined();
    expect(filesIn(a)).toBe(30);
    expect(filesIn(b)).toBe(30);
    expect(d.log.some((l) => /Duraklatıldı|Paused/.test(l.message))).toBe(true);
  });

  it('drops one target while the other one completes, and the run ends partial', async () => {
    const { a, b, start } = await setup();
    const h = start();
    h.cancelTarget('B');
    const d = await h.done;
    const ta = d.targets.find((x) => x.key === 'A')!;
    const tb = d.targets.find((x) => x.key === 'B')!;
    expect(ta.status).toBe('ok');
    expect(tb.status).toBe('cancelled');
    expect(d.status).toBe('partial');
    expect(filesIn(a)).toBe(30);
    expect(filesIn(b)).toBeLessThan(30);
    expect(d.log.some((l) => l.key === 'B' && /çıkarıldı|dropped/.test(l.message))).toBe(true);
  });

  it('cancel of the whole run also wakes a paused run', async () => {
    const { start } = await setup();
    const h = start();
    h.pause(true);
    await sleep(100);
    h.cancel.cancel();
    const d = await h.done;
    expect(d.status).toBe('cancelled');
  });
});
