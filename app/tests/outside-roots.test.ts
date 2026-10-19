import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { cleanRel, mapSource, outsidePlaces } from '../src/core/paths';
import { buildSendPlan, describeSources } from '../src/core/plan';
import { changesToSources } from '../src/core/automation';
import { makeFilter } from '../src/core/filter';
import { fsSources, pathWithin, relsFor, samePath } from '../src/shared/sources';
import { tmpDir, write, pathNode, makeCtx, defaultOptions } from './helpers';

const win = process.platform === 'win32';

describe('sources outside every local root', () => {
  it.runIf(win)('take their own folder as the target root by default', () => {
    const roots = ['C:\\Build\\Release'];
    expect(mapSource('D:\\Copy\\Release', roots, true)).toEqual({ rel: '', outside: true, base: 'D:\\Copy\\Release' });
    expect(mapSource('D:\\Copy\\Release\\bin\\x.dll', roots, false)).toEqual({ rel: 'x.dll', outside: true, base: 'D:\\Copy\\Release\\bin' });
    // under a root nothing changes
    expect(mapSource('C:\\Build\\Release\\Data', roots, true)).toMatchObject({ rel: 'Data', outside: false, root: 'C:\\Build\\Release' });
  });

  it.runIf(win)('keep their full path when the old way is chosen', () => {
    expect(mapSource('D:\\Copy\\Release', [], true, 'fullPath')).toEqual({ rel: 'D/Copy/Release', outside: true, full: true });
  });

  it.runIf(win)('go where the Send page placed them', () => {
    expect(mapSource('D:\\Copy\\Release\\bin\\x.dll', [], false, 'own', 'bin/x.dll')).toEqual({ rel: 'bin/x.dll', outside: true, base: 'D:\\Copy\\Release', full: undefined });
    expect(mapSource('D:\\Copy\\Release', [], true, 'own', 'D/Copy/Release')).toMatchObject({ rel: 'D/Copy/Release', full: true });
  });

  it.runIf(win)('offer one place per folder above them, then the full path', () => {
    expect(outsidePlaces('D:\\Copy\\Release\\bin\\x.dll', false)).toEqual([
      { rel: 'x.dll', base: 'D:\\Copy\\Release\\bin' },
      { rel: 'bin/x.dll', base: 'D:\\Copy\\Release' },
      { rel: 'Release/bin/x.dll', base: 'D:\\Copy' },
      { rel: 'Copy/Release/bin/x.dll', base: 'D:\\' },
      { rel: 'D/Copy/Release/bin/x.dll', full: true },
    ]);
    expect(outsidePlaces('\\\\srv\\share\\a', true).map((p) => p.rel)).toEqual(['', 'a', 'UNC/srv/share/a']);
  });

  it('cleans a target path given by hand and refuses one that climbs out', () => {
    expect(cleanRel('/a\\b/./c/')).toBe('a/b/c');
    expect(() => cleanRel('a/../../x')).toThrow();
  });

  it('plans an outside folder straight into the target root, or where it was placed', async () => {
    const base = await tmpDir();
    const copy = path.join(base, 'copy');
    const tgt = path.join(base, 't');
    await write(path.join(copy, 'a.txt'), 'a');
    await write(path.join(copy, 'sub', 'b.txt'), 'b');
    await fsp.mkdir(tgt, { recursive: true });
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [path.join(base, 'elsewhere')], path.join(base, 'ud'));
    const rels = async (rel?: string) => {
      const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: copy, ...(rel !== undefined ? { rel } : {}) }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
      return plan.targets[0].ops.filter((o) => o.kind === 'copy').map((o) => o.rel).sort();
    };
    expect(await rels()).toEqual(['a.txt', 'sub/b.txt']);
    expect(await rels('Release')).toEqual(['Release/a.txt', 'Release/sub/b.txt']);

    const [info] = await describeSources(ctx, [copy]);
    expect(info).toMatchObject({ outsideRoots: true, rel: '', base: path.resolve(copy) });
    expect(info.places?.[0]).toEqual({ rel: '', base: path.resolve(copy) });
    expect(info.places?.at(-1)?.full).toBe(true);
    const [placed] = await describeSources(ctx, [copy], true, undefined, { [copy]: 'Release' });
    expect(placed.rel).toBe('Release');
  });

  it('plans with the full path when the setting asks for the old way', async () => {
    const base = await tmpDir();
    const copy = path.join(base, 'copy');
    await write(path.join(copy, 'a.txt'), 'a');
    await fsp.mkdir(path.join(base, 't'), { recursive: true });
    const ctx = makeCtx({ nodes: [pathNode('T', path.join(base, 't'))], copy: { outsideRoots: 'fullPath' } as never }, [], path.join(base, 'ud'));
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: copy }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
    expect(plan.sources[0].full).toBe(true);
    const rel = plan.targets[0].ops.find((o) => o.kind === 'copy')!.rel;
    expect(rel.endsWith('/copy/a.txt')).toBe(true);
    expect(rel).not.toBe('a.txt');
  });

  it('sends what changed in a watched outside folder to the place of the folder', async () => {
    const root = await tmpDir();
    await write(path.join(root, 'sub', 'x.txt'), 'x');
    const filter = makeFilter({ excludeFiles: [], excludeDirs: [] });
    const changed = [path.join(root, 'sub', 'x.txt'), path.join(root, 'gone.txt')];
    const atRoot = await changesToSources(changed, [root], filter, true, new Set(), () => '');
    expect(atRoot.map((s) => (s.kind === 'git' ? '' : `${s.kind}:${s.rel}`)).sort()).toEqual(['delete:gone.txt', 'fs:sub/x.txt']);
    const placed = await changesToSources(changed.slice(0, 1), [root], filter, false, new Set(), () => 'Release');
    expect(placed).toEqual([{ kind: 'fs', path: changed[0], rel: 'Release/sub/x.txt' }]);
    // a path the local roots decide keeps no rel of its own
    const decided = await changesToSources(changed.slice(0, 1), [root], filter, false, new Set(), () => undefined);
    expect(decided).toEqual([{ kind: 'fs', path: changed[0] }]);
  });

  it('carries the picked places with the paths they belong to', () => {
    expect(fsSources(['a', 'b'], { b: 'x' })).toEqual([{ kind: 'fs', path: 'a' }, { kind: 'fs', path: 'b', rel: 'x' }]);
    expect(relsFor(['a'], { a: '', b: 'x' })).toEqual({ a: '' });
    expect(relsFor(['a'], { b: 'x' })).toBeUndefined();
    expect(samePath('C:\\X\\y\\', 'c:/x/Y')).toBe(true);
    expect(pathWithin('C:\\X\\y\\z.txt', 'c:/x/Y')).toBe(true);
    expect(pathWithin('C:\\X\\yz', 'C:\\X\\y')).toBe(false);
  });
});
