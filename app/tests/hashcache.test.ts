import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { HashCache } from '../src/core/hashcache';
import { buildSendPlan } from '../src/core/plan';
import { startRun, type ExecSettings } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { tmpDir, write, pathNode, makeCtx, defaultOptions } from './helpers';

describe('hash cache', () => {
  it('answers only while size and time still match, and survives a restart', async () => {
    const base = await tmpDir();
    const file = path.join(base, 'hashcache.json');
    const c = new HashCache(file);
    await c.load();
    c.set('\\\\srv\\share', 'Data/a.bin', 10, 1_000_000, 'abc');
    expect(c.get('\\\\SRV\\share', 'data/A.BIN', 10, 1_001_500)).toBe('abc');
    expect(c.get('\\\\srv\\share', 'Data/a.bin', 11, 1_000_000)).toBeUndefined();
    expect(c.get('\\\\srv\\share', 'Data/a.bin', 10, 1_003_000)).toBeUndefined();
    await c.flush();
    const again = new HashCache(file);
    await again.load();
    expect(again.get('\\\\srv\\share', 'Data/a.bin', 10, 1_000_000)).toBe('abc');
  });

  it('prunes the least recently used entries past the cap', async () => {
    const base = await tmpDir();
    const c = new HashCache(path.join(base, 'h.json'), 10);
    for (let i = 0; i < 20; i++) c.set('r', `f${i}`, 1, 0, `h${i}`);
    await c.flush();
    expect(c.size).toBeLessThanOrEqual(9);
    expect(c.get('r', 'f19', 1, 0)).toBe('h19');
  });

  it('is filled by a streamed copy and spares the read on the next content comparison', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't');
    await fsp.mkdir(tgt, { recursive: true });
    // over the streaming threshold, so the copy hashes on the way
    await write(path.join(src, 'big.bin'), 'x'.repeat(400 * 1024));
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [src], path.join(base, 'ud'));
    ctx.hashCache = new HashCache(path.join(base, 'ud', 'hashcache.json'));
    // a send compared by content: the copy hashes on the way
    const settings: ExecSettings = { label: 'h', origin: 'send', dryRun: false, backup: false, backupKeep: 0, backupFolderName: '_y', verify: false, retryCount: 0, waitSeconds: 0, parallelGroups: 1, parallelFiles: 2, postCommandTimeoutSeconds: 5, sources: [], targetIds: [], options: { compare: 'content' } };
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
    const tp = plan.targets[0];
    const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: false }));
    const d = await startRun(ctx, [{ key: 'T', title: 'T', rootLabel: tp.root, open: () => transportForNode(ctx, ctx.config.nodes[0]), ops }], settings).done;
    expect(d.status).toBe('ok');
    const st = fs.statSync(path.join(tgt, 'big.bin'));
    const root = (await transportForNode(ctx, ctx.config.nodes[0])).root;
    expect(ctx.hashCache.get(root, 'big.bin', st.size, st.mtimeMs)).toMatch(/^[0-9a-f]{64}$/);

    // a content comparison now: the target side comes from the cache, the file is 'same'
    const plan2 = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: { ...defaultOptions, compare: 'content' }, origin: 'send' });
    expect(plan2.targets[0].counts.same).toBe(1);
    expect(plan2.targets[0].ops.filter((o) => o.selected)).toEqual([]);
    // the source side was remembered too
    expect(ctx.hashCache.get('src', path.join(src, 'big.bin'), st.size, fs.statSync(path.join(src, 'big.bin')).mtimeMs)).toBeDefined();
  });
});
