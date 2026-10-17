import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { buildSendPlan } from '../src/core/plan';
import { startRun, RESUME_MIN, type ExecSettings } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { tmpDir, pathNode, makeCtx, defaultOptions, sleep } from './helpers';

const hash = (p: string) => createHash('sha1').update(fs.readFileSync(p)).digest('hex');

const settings: ExecSettings = {
  label: 'resume',
  origin: 'send',
  dryRun: false,
  backup: false,
  backupKeep: 0,
  backupFolderName: '_y',
  verify: false,
  retryCount: 0,
  waitSeconds: 0,
  parallelGroups: 1,
  parallelFiles: 2,
  postCommandTimeoutSeconds: 5,
  sources: [],
  targetIds: [],
};

async function setup() {
  const base = await tmpDir();
  const src = path.join(base, 'src');
  const tgt = path.join(base, 't');
  await fsp.mkdir(src, { recursive: true });
  await fsp.mkdir(tgt, { recursive: true });
  // just over the resume threshold, random so a wrong prefix would not pass by chance
  const big = Buffer.concat([randomBytes(RESUME_MIN), randomBytes(1024 * 1024)]);
  await fsp.writeFile(path.join(src, 'big.bin'), big);
  await fsp.writeFile(path.join(src, 'small.txt'), 'hello');
  const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [src], path.join(base, 'ud'));
  return { base, src, tgt, big, ctx };
}

async function run(ctx: ReturnType<typeof makeCtx>, src: string, extra: Partial<ExecSettings> = {}) {
  const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
  const tp = plan.targets[0];
  const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null }));
  return startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, ctx.config.nodes[0]), ops }], { ...settings, ...extra });
}

describe('a copy that broke off', () => {
  it('continues a big file from the bytes already on the target', async () => {
    const { src, tgt, big, ctx } = await setup();
    // the first 5 MB arrived last time
    const part = path.join(tgt, '.big.bin.resume.samsync-tmp');
    await fsp.writeFile(part, big.subarray(0, 5 * 1024 * 1024));
    const d = await (await run(ctx, src)).done;
    expect(d.status).toBe('ok');
    expect(hash(path.join(tgt, 'big.bin'))).toBe(hash(path.join(src, 'big.bin')));
    expect(fs.existsSync(part)).toBe(false);
    expect(d.log.some((l) => /kaldığı yerden|from where it stopped/.test(l.message))).toBe(true);
    expect(d.targets[0].bytesDone).toBe(big.length + 5);
  });

  it('starts over when the partial file is not a prefix of the source', async () => {
    const { src, tgt, ctx } = await setup();
    const part = path.join(tgt, '.big.bin.resume.samsync-tmp');
    await fsp.writeFile(part, randomBytes(5 * 1024 * 1024));
    const d = await (await run(ctx, src)).done;
    expect(d.status).toBe('ok');
    expect(hash(path.join(tgt, 'big.bin'))).toBe(hash(path.join(src, 'big.bin')));
    expect(d.log.some((l) => /kaldığı yerden|from where it stopped/.test(l.message))).toBe(false);
  });

  it('stops at once on cancel and leaves the partial file for the next send, which finishes it', async () => {
    const { src, tgt, ctx } = await setup();
    // 2 MB/s: the 9 MB file takes over four seconds, so a cancel after one lands in the middle of it
    const h = await run(ctx, src, { bandwidthMBps: 2 });
    await sleep(1200);
    const t0 = Date.now();
    h.cancel.cancel();
    const d = await h.done;
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(d.status).toBe('cancelled');
    const part = path.join(tgt, '.big.bin.resume.samsync-tmp');
    expect(fs.existsSync(part)).toBe(true);
    const partial = fs.statSync(part).size;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(RESUME_MIN + 1024 * 1024);
    expect(fs.existsSync(path.join(tgt, 'big.bin'))).toBe(false);

    const d2 = await (await run(ctx, src)).done;
    expect(d2.status).toBe('ok');
    expect(d2.log.some((l) => /kaldığı yerden|from where it stopped/.test(l.message))).toBe(true);
    expect(hash(path.join(tgt, 'big.bin'))).toBe(hash(path.join(src, 'big.bin')));
    expect(fs.readdirSync(tgt).filter((n) => n.includes('samsync-tmp'))).toEqual([]);
  });

  it('removes the partial file when the write itself failed for another reason', async () => {
    const { src, tgt, ctx } = await setup();
    // the source shrinks after the plan: the size check fails after the write, and nothing is kept
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
    const tp = plan.targets[0];
    const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size + (o.rel === 'big.bin' ? 7 : 0), mtimeMs: o.srcMtime, src: o.src, dstExists: false }));
    const d = await startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, ctx.config.nodes[0]), ops }], settings).done;
    expect(d.results.find((r) => r.rel === 'big.bin')?.ok).toBe(false);
    expect(fs.readdirSync(tgt).filter((n) => n.includes('samsync-tmp'))).toEqual([]);
  });
});
