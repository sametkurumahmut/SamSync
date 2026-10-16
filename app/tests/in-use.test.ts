import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { buildSendPlan } from '../src/core/plan';
import { startRun } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { tmpDir, write, pathNode, makeCtx, defaultOptions, sleep } from './helpers';

const win = process.platform === 'win32';

describe('a file in use on the target', () => {
  it.skipIf(!win)('is reported before the copy, without retries, and leaves no temporary file', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    await fsp.mkdir(tgt, { recursive: true });
    // the target holds a running program under the name the source wants to replace (like a loaded DLL)
    await fsp.copyFile(process.execPath, path.join(tgt, 'held.exe'));
    await write(path.join(src, 'held.exe'), 'x'.repeat(2 * 1024 * 1024));
    await write(path.join(src, 'free.txt'), 'hello');
    const child = spawn(path.join(tgt, 'held.exe'), ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });
    await sleep(600);
    try {
      const ctx = makeCtx({ nodes: [pathNode('T', tgt)], copy: { retryCount: 2, waitSeconds: 1 } as never }, [src], path.join(base, 'ud'));
      const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
      const tp = plan.targets[0];
      const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null }));
      const started = Date.now();
      const h = startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, ctx.config.nodes[0]), ops }], {
        label: 'in use',
        origin: 'send',
        dryRun: false,
        backup: false,
        backupKeep: 0,
        backupFolderName: '_y',
        verify: false,
        retryCount: 2,
        waitSeconds: 1,
        parallelGroups: 1,
        parallelFiles: 4,
        postCommandTimeoutSeconds: 5,
        sources: [],
        targetIds: [],
      });
      const d = await h.done;
      expect(d.status).toBe('partial');
      const held = d.results.find((r) => r.rel === 'held.exe');
      expect(held?.ok).toBe(false);
      expect(held?.error).toContain('held.exe');
      expect(held?.error).toMatch(/kullanımda|in use/);
      expect(d.results.find((r) => r.rel === 'free.txt')?.ok).toBe(true);
      // no retry waits (2 × 1 s) and nothing left behind
      expect(Date.now() - started).toBeLessThan(1800);
      expect(fs.readdirSync(tgt).filter((n) => n.includes('samsync-tmp'))).toEqual([]);
      expect(d.log.filter((l) => l.message.includes('yeniden denenecek'))).toEqual([]);
    } finally {
      child.kill();
      await sleep(300);
      await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
