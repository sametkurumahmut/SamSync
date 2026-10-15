import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { buildSendPlan } from '../src/core/plan';
import { startRun } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { RateLimiter } from '../src/core/util';
import { tmpDir, write, read, pathNode, makeCtx, defaultOptions } from './helpers';

describe('bandwidth limit', () => {
  it('spaces reservations by the rate', () => {
    const l = new RateLimiter(1000); // 1000 B/s
    expect(l.reserve(500)).toBe(0);
    const w = l.reserve(500);
    expect(w).toBeGreaterThanOrEqual(480);
    expect(w).toBeLessThanOrEqual(500);
  });

  it('keeps parallel copies to one target under the shared limit and still copies correctly', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    await fsp.mkdir(tgt, { recursive: true });
    for (const n of ['a', 'b', 'c', 'd']) await write(path.join(src, `${n}.bin`), 'x'.repeat(512 * 1024));
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [src], path.join(base, 'ud'));
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
    const tp = plan.targets[0];
    const started = Date.now();
    const h = startRun(
      ctx,
      [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, ctx.config.nodes[0]), ops: tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src })) }],
      { label: 'bw', origin: 'send', dryRun: false, backup: false, backupKeep: 0, backupFolderName: '_y', verify: false, retryCount: 0, waitSeconds: 0, parallelGroups: 1, parallelFiles: 4, postCommandTimeoutSeconds: 5, bandwidthMBps: 4, sources: [], targetIds: [] },
    );
    const d = await h.done;
    const elapsed = Date.now() - started;
    expect(d.status).toBe('ok');
    // 2 MB at 4 MB/s shared by four parallel files: about half a second (the first chunk passes at once)
    expect(elapsed).toBeGreaterThanOrEqual(350);
    // src is the local root itself, so its files land directly under the target root
    expect(read(path.join(tgt, 'c.bin'))?.length).toBe(512 * 1024);
    const again = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
    expect(again.targets[0].counts.same).toBe(4);
  });
});
