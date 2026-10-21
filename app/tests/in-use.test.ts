import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { buildSendPlan } from '../src/core/plan';
import { startRun } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { tmpDir, write, pathNode, makeCtx, defaultOptions, sleep, daysAgo } from './helpers';
import { Service } from '../src/core/service';

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
      // marked, so the run panel offers "retry the files in use"
      expect(held?.inUse).toBe(true);
      expect(d.inUseFailed).toBe(1);
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

  it.skipIf(!win)('that already holds the same content only gets its date aligned, and counts as done', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    await fsp.mkdir(src, { recursive: true });
    await fsp.mkdir(tgt, { recursive: true });
    // the same program on both sides; the target's copy was made without its date (a tool that keeps none)
    await fsp.copyFile(process.execPath, path.join(src, 'held.exe'));
    await fsp.copyFile(process.execPath, path.join(tgt, 'held.exe'));
    const stamp = daysAgo(3);
    await fsp.utimes(path.join(src, 'held.exe'), stamp, stamp);
    await write(path.join(src, 'other.txt'), 'x');
    await write(path.join(tgt, 'other.txt'), 'y', daysAgo(1));
    const child = spawn(path.join(tgt, 'held.exe'), ['-e', 'setTimeout(() => {}, 15000)'], { stdio: 'ignore' });
    await sleep(600);
    try {
      const ctx = makeCtx({ nodes: [pathNode('T', tgt)], copy: { retryCount: 2, waitSeconds: 1 } as never }, [src], path.join(base, 'ud'));
      const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
      const tp = plan.targets[0];
      // the dates differ, so the time comparison wants to write it and overwrite mode selects it
      expect(tp.ops.find((o) => o.rel === 'held.exe')?.selected).toBe(true);
      const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null }));
      const h = startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, ctx.config.nodes[0]), ops }], {
        label: 'same content',
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
      expect(d.status).toBe('ok');
      expect(d.results.find((r) => r.rel === 'held.exe')?.ok).toBe(true);
      expect(d.results.find((r) => r.rel === 'other.txt')?.ok).toBe(true);
      expect(d.log.some((l) => /tarihi eşitlendi|date aligned/.test(l.message))).toBe(true);
      expect(Math.abs(fs.statSync(path.join(tgt, 'held.exe')).mtimeMs - stamp.getTime())).toBeLessThan(2000);
      // the next plan sees nothing to do for it
      const again = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
      expect(again.targets[0].ops.find((o) => o.rel === 'held.exe')).toBeUndefined();
    } finally {
      child.kill();
      await sleep(300);
      await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it.skipIf(!win)('is tried once more at the end of the run when asked for, and goes once the program has let go', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    await fsp.mkdir(tgt, { recursive: true });
    await fsp.copyFile(process.execPath, path.join(tgt, 'held.exe'));
    await write(path.join(src, 'held.exe'), 'x'.repeat(2 * 1024 * 1024));
    await write(path.join(src, 'free.txt'), 'hello');
    // the program lets go of its file after two seconds
    const child = spawn(path.join(tgt, 'held.exe'), ['-e', 'setTimeout(() => {}, 2000)'], { stdio: 'ignore' });
    await sleep(600);
    try {
      const ctx = makeCtx({ nodes: [pathNode('T', tgt)], copy: { retryCount: 0, waitSeconds: 0 } as never }, [src], path.join(base, 'ud'));
      const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
      const tp = plan.targets[0];
      const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null }));
      const h = startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, ctx.config.nodes[0]), ops }], {
        label: 'in use, retried',
        origin: 'send',
        dryRun: false,
        backup: false,
        backupKeep: 0,
        backupFolderName: '_y',
        verify: false,
        retryCount: 0,
        waitSeconds: 0,
        parallelGroups: 1,
        parallelFiles: 4,
        postCommandTimeoutSeconds: 5,
        retryInUseAtEnd: true,
        sources: [],
        targetIds: [],
      });
      const d = await h.done;
      expect(d.status).toBe('ok');
      expect(d.results.filter((r) => r.rel === 'held.exe').map((r) => r.ok)).toEqual([true]);
      expect(fs.statSync(path.join(tgt, 'held.exe')).size).toBe(2 * 1024 * 1024);
      expect(d.log.some((l) => /sonda bir kez daha denenecek|tried once more at the end/.test(l.message))).toBe(true);
      expect(d.inUseFailed).toBeUndefined();
    } finally {
      child.kill();
      await sleep(300);
      await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 20000);

  it.skipIf(!win)('"retry the files in use" writes only those again, to the same machine, without a review', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    // the source folder lands under its own name on the target
    await fsp.mkdir(path.join(tgt, 'src'), { recursive: true });
    await fsp.copyFile(process.execPath, path.join(tgt, 'src', 'held.exe'));
    await write(path.join(src, 'held.exe'), 'y'.repeat(2 * 1024 * 1024));
    await write(path.join(src, 'free.txt'), 'hello');
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [{ ...pathNode('Me', src), localRoots: [base] }, pathNode('T', tgt)], copy: { retryCount: 0, waitSeconds: 0 } }));
    const ud = path.join(base, 'ud');
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me', agent: { receivePacks: false, notifyOnApply: false } }));
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    const child = spawn(path.join(tgt, 'src', 'held.exe'), ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'ignore' });
    await sleep(600);
    try {
      const plan = await svc.planSend({ sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: { ...defaultOptions, backup: false }, origin: 'send', label: 'deneme' }, 'iu');
      expect(plan.targets[0].reachable).toBe(true);
      const first = await svc.runPlan(plan, 'default', { notify: false }).done;
      expect(first.status).toBe('partial');
      expect(first.inUseFailed).toBe(1);
      // the program is closed: only held.exe goes again
      await new Promise<void>((r) => (child.exitCode != null ? r() : child.once('exit', () => r())));
      await sleep(300);
      const id = await svc.retryInUse(first.id);
      let again = await svc.run(id);
      for (let i = 0; i < 100 && !again; i++) {
        await sleep(100);
        again = await svc.run(id);
      }
      expect(again!.status).toBe('ok');
      expect(again!.results.map((r) => r.rel)).toEqual(['src/held.exe']);
      expect(again!.label).toMatch(/deneme/);
      expect(fs.statSync(path.join(tgt, 'src', 'held.exe')).size).toBe(2 * 1024 * 1024);
      await expect(svc.retryInUse(id)).rejects.toThrow();
    } finally {
      child.kill();
      svc.automation?.stop();
      svc.pending.stop();
      await sleep(300);
      await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 20000);
});
