import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { buildSendPlan } from '../src/core/plan';
import { tmpDir, write, pathNode, makeCtx, defaultOptions, daysAgo } from './helpers';

const plan = async (ctx: ReturnType<typeof makeCtx>, paths: string[], mode: 'overwrite' | 'mirror' = 'mirror') => {
  const p = await buildSendPlan(ctx, { sources: paths.map((x) => ({ kind: 'fs' as const, path: x })), targetIds: ['T'], options: { ...defaultOptions, mode }, origin: 'send' });
  const ops = p.targets[0].ops;
  return {
    warnings: p.warnings,
    copies: ops.filter((o) => o.kind === 'copy').map((o) => `${o.rel} <- ${o.src?.kind === 'fs' ? path.relative(path.dirname(path.dirname(o.src.abs)), o.src.abs).split(path.sep).join('/') : '?'}`).sort(),
    deletes: ops.filter((o) => o.kind === 'delete' && o.selected).map((o) => o.rel).sort(),
  };
};

describe('sources that land inside one another on the targets', () => {
  it('lets a folder from elsewhere take over its part of the target', async () => {
    const base = await tmpDir();
    const release = path.join(base, 'build', 'Release');
    const contentsRoot = path.join(base, 'contents');
    const tgt = path.join(base, 't');
    await write(path.join(release, 'app.exe'), 'new app');
    await write(path.join(release, 'Contents', 'stale.dat'), 'from the build');
    await write(path.join(contentsRoot, 'Contents', 'map.dat'), 'new map');
    await write(path.join(tgt, 'app.exe'), 'old app', daysAgo(2));
    await write(path.join(tgt, 'old.txt'), 'gone in the new release');
    await write(path.join(tgt, 'Contents', 'map.dat'), 'old map', daysAgo(2));
    await write(path.join(tgt, 'Contents', 'extra.dat'), 'not in the contents folder');
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [release, contentsRoot], path.join(base, 'ud'));

    const r = await plan(ctx, [release, path.join(contentsRoot, 'Contents')]);
    // the release goes to the root but leaves Contents alone; Contents comes from the contents folder only
    expect(r.copies).toEqual(['Contents/map.dat <- Contents/map.dat', 'app.exe <- Release/app.exe']);
    expect(r.deletes).toEqual(['Contents/extra.dat', 'old.txt']);
    expect(r.warnings.some((w) => /aynı yere gidiyor|same place/.test(w))).toBe(false);
  });

  it('sends a folder inside a sent folder from the same place once', async () => {
    const base = await tmpDir();
    const release = path.join(base, 'Release');
    const tgt = path.join(base, 't');
    await write(path.join(release, 'Data', 'a.dat'), 'a');
    await fsp.mkdir(tgt, { recursive: true });
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [release], path.join(base, 'ud'));
    const r = await plan(ctx, [release, path.join(release, 'Data'), path.join(release, 'Data', 'a.dat')], 'overwrite');
    expect(r.copies).toEqual(['Data/a.dat <- Data/a.dat']);
  });

  it('merges two folders that go to the same place, the first one winning a clash', async () => {
    const base = await tmpDir();
    const a = path.join(base, 'disk1', 'Release');
    const b = path.join(base, 'disk2', 'Release');
    await write(path.join(a, 'x.txt'), 'a');
    await write(path.join(a, 'a.txt'), 'a');
    await write(path.join(b, 'x.txt'), 'b');
    await write(path.join(b, 'sub', 'b.txt'), 'b');
    await fsp.mkdir(path.join(base, 't'), { recursive: true });
    // both lie outside every root, so each stands for the target root
    const ctx = makeCtx({ nodes: [pathNode('T', path.join(base, 't'))] }, [], path.join(base, 'ud'));
    const r = await plan(ctx, [a, b], 'overwrite');
    expect(r.copies).toEqual(['a.txt <- Release/a.txt', 'sub/b.txt <- sub/b.txt', 'x.txt <- Release/x.txt']);
    const p = await buildSendPlan(ctx, { sources: [a, b].map((x) => ({ kind: 'fs' as const, path: x })), targetIds: ['T'], options: defaultOptions, origin: 'send' });
    const x = p.targets[0].ops.find((o) => o.rel === 'x.txt')!;
    expect(x.src?.kind === 'fs' && x.src.abs).toBe(path.join(a, 'x.txt'));
    expect(r.warnings.some((w) => w.includes(b) && /hem .* içinde var|both/.test(w))).toBe(true);
  });

  it('sends two local roots that both stand for the target root as one, mirroring their union', async () => {
    const base = await tmpDir();
    const release = path.join(base, 'Build64');
    const contents = path.join(base, 'content');
    const tgt = path.join(base, 't');
    await write(path.join(release, 'app.exe'), 'new app');
    await write(path.join(contents, 'Contents', 'map.dat'), 'new map');
    await write(path.join(tgt, 'app.exe'), 'old app', daysAgo(2));
    await write(path.join(tgt, 'Contents', 'map.dat'), 'old map', daysAgo(2));
    await write(path.join(tgt, 'Contents', 'extra.dat'), 'x');
    await write(path.join(tgt, 'old.txt'), 'x');
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [contents, release], path.join(base, 'ud'));
    const r = await plan(ctx, [contents, release]);
    expect(r.copies).toEqual(['Contents/map.dat <- Contents/map.dat', 'app.exe <- Build64/app.exe']);
    // nothing either folder holds is deleted; what neither holds goes in the mirror
    expect(r.deletes).toEqual(['Contents/extra.dat', 'old.txt']);
  });
});
