import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { buildSendPlan, describeSources, writeSendPack } from '../src/core/plan';
import { startRun, type ExecSettings } from '../src/core/executor';
import { transportForNode } from '../src/core/transport';
import { readPackIndex, isPackFile, packFileName } from '../src/core/packfile';
import { readManifest } from '../src/core/manifest';
import { FsTransport } from '../src/core/transport/fs';
import { tmpDir, write, read, pathNode, makeCtx, defaultOptions } from './helpers';

const settings: ExecSettings = {
  label: 'pack',
  origin: 'send',
  dryRun: false,
  backup: false,
  backupKeep: 0,
  backupFolderName: '_y',
  verify: false,
  retryCount: 0,
  waitSeconds: 0,
  parallelGroups: 2,
  parallelFiles: 4,
  postCommandTimeoutSeconds: 5,
  sources: [],
  targetIds: [],
};

async function runPlan(ctx: ReturnType<typeof makeCtx>, sources: string[], targetIds: string[], options = defaultOptions) {
  const plan = await buildSendPlan(ctx, { sources: sources.map((p) => ({ kind: 'fs', path: p })), targetIds, options, origin: 'send', label: 'pack' });
  const groups = plan.targets
    .filter((tp) => tp.reachable)
    .map((tp) => {
      const node = ctx.config.nodes.find((n) => n.id === tp.targetId)!;
      const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null }));
      return { key: tp.targetId, title: tp.targetName, rootLabel: tp.root, open: () => transportForNode(ctx, node), ops, manifest: new Map([['Release', new Map()]]) };
    });
  const d = groups.some((g) => g.ops.length) ? await startRun(ctx, groups, { ...settings, targetIds }).done : null;
  return { plan, d };
}

describe('pack files', () => {
  it('writes the sources to one file and applies it on another machine, with the manifest left behind', async () => {
    const base = await tmpDir();
    const root = path.join(base, 'root');
    const rel = path.join(root, 'Release');
    await write(path.join(rel, 'bin', 'app.exe'), 'exe'.repeat(5000), new Date('2026-01-02T10:00:00Z'));
    await write(path.join(rel, 'data', 'cfg.ini'), '[a]\nb=1\n', new Date('2026-01-03T10:00:00Z'));
    await write(path.join(rel, 'data', 'skip.tmp'), 'tmp');
    await write(path.join(rel, 'pic.png'), 'png-bytes');
    await fsp.mkdir(path.join(rel, 'empty'), { recursive: true });
    const sender = makeCtx({ nodes: [pathNode('Me', root)] }, [root], path.join(base, 'ud1'));

    // written like a send: the exclusions apply
    const pack = path.join(base, 'usb', packFileName('Sürüm 3.4'));
    expect(isPackFile(pack)).toBe(true);
    const r = await writeSendPack(sender, { sources: [{ kind: 'fs', path: rel }], targetIds: [], options: { ...defaultOptions, excludeFiles: ['*.tmp'] }, origin: 'send', label: 'Sürüm 3.4' }, pack);
    expect(r.files).toBe(3);
    expect(r.packed).toBeGreaterThan(0);
    const idx = await readPackIndex(pack);
    expect(idx.label).toBe('Sürüm 3.4');
    expect(idx.subtrees).toEqual([{ rel: 'Release', isDir: true }]);
    expect(idx.entries.map((e) => e.rel).sort()).toEqual(['Release/bin', 'Release/bin/app.exe', 'Release/data', 'Release/data/cfg.ini', 'Release/empty', 'Release/pic.png']);
    expect(idx.entries.find((e) => e.rel === 'Release/pic.png')?.method).toBe('store');

    // the Send page shows what is in it
    const [info] = await describeSources(sender, [pack]);
    expect(info.pack?.files).toBe(3);
    expect(info.rel).toBe('Release');

    // the other machine: the pack is a source, the plan compares it with the machine's own root
    const other = path.join(base, 'other');
    await write(path.join(other, 'Release', 'data', 'cfg.ini'), 'old', new Date('2025-01-01T00:00:00Z'));
    await write(path.join(other, 'Release', 'data', 'extra.txt'), 'gone with mirror');
    const receiver = makeCtx({ nodes: [pathNode('Other', other)] }, [path.join(base, 'elsewhere')], path.join(base, 'ud2'));
    const { plan, d } = await runPlan(receiver, [pack], ['Other'], { ...defaultOptions, mode: 'mirror' });
    const tp = plan.targets[0];
    expect(tp.reachable).toBe(true);
    expect(tp.counts.new).toBe(4); // app.exe, pic.png and the bin and empty folders (data is there already)
    expect(tp.counts.changed).toBe(1);
    expect(tp.counts.extra).toBe(1);
    expect(d?.status).toBe('ok');
    expect(read(path.join(other, 'Release', 'bin', 'app.exe'))).toBe('exe'.repeat(5000));
    expect(read(path.join(other, 'Release', 'data', 'cfg.ini'))).toBe('[a]\nb=1\n');
    expect(read(path.join(other, 'Release', 'pic.png'))).toBe('png-bytes');
    expect(fs.existsSync(path.join(other, 'Release', 'empty'))).toBe(true);
    expect(fs.existsSync(path.join(other, 'Release', 'data', 'extra.txt'))).toBe(false);
    expect(fs.existsSync(path.join(other, 'Release', 'data', 'skip.tmp'))).toBe(false);
    // the time stamps travel with the files
    expect(Math.abs(fs.statSync(path.join(other, 'Release', 'bin', 'app.exe')).mtimeMs - new Date('2026-01-02T10:00:00Z').getTime())).toBeLessThan(2000);
    // and the manifest is there for the next network send
    const m = await readManifest(new FsTransport(other));
    expect(m?.subtrees['Release']).toBeTruthy();

    // a second apply has nothing to do
    const again = await runPlan(receiver, [pack], ['Other'], { ...defaultOptions, mode: 'mirror' });
    expect(again.plan.targets[0].ops.filter((o) => o.selected)).toEqual([]);
  });

  it('can be applied to this very machine, straight to its local root', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    await write(path.join(src, 'Release', 'a.txt'), 'A');
    const sender = makeCtx({ nodes: [pathNode('Me', src)] }, [src], path.join(base, 'ud1'));
    const pack = path.join(base, 'p.samsync-pack');
    await writeSendPack(sender, { sources: [{ kind: 'fs', path: path.join(src, 'Release') }], targetIds: [], options: defaultOptions, origin: 'send', label: 'x' }, pack);

    const here = path.join(base, 'here');
    await fsp.mkdir(here, { recursive: true });
    // the machine's own node, as the identity would resolve it: its network root is not reachable in the test
    const ctx = makeCtx({ nodes: [{ ...pathNode('PC1', path.join(base, 'nowhere')), transport: undefined, path: undefined, address: '10.0.0.9', networkRoot: 'Sim' }] }, [here], path.join(base, 'ud2'));
    ctx.localNodeId = 'PC1';
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: pack }], targetIds: ['PC1'], options: defaultOptions, origin: 'send' });
    expect(plan.warnings.some((w) => /kendisi hedef listesinden/.test(w))).toBe(false);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].reachable).toBe(true);
    const tp = plan.targets[0];
    const ops = tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: false }));
    const node = ctx.config.nodes[0];
    const d = await startRun(ctx, [{ key: 'PC1', title: 'PC1', rootLabel: tp.root, open: () => transportForNode(ctx, node), ops }], settings).done;
    expect(d.status).toBe('ok');
    expect(read(path.join(here, 'Release', 'a.txt'))).toBe('A');

    // a folder as a source still never targets this machine
    const plan2 = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: path.join(src, 'Release') }], targetIds: ['PC1'], options: defaultOptions, origin: 'send' });
    expect(plan2.targets).toHaveLength(0);
  });

  it('refuses a file that is not a pack', async () => {
    const base = await tmpDir();
    const bogus = path.join(base, 'x.samsync-pack');
    await write(bogus, 'not a pack at all');
    const ctx = makeCtx({ nodes: [pathNode('T', path.join(base, 't'))] }, [], path.join(base, 'ud'));
    const [info] = await describeSources(ctx, [bogus]);
    expect(info.exists).toBe(false);
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: bogus }], targetIds: ['T'], options: defaultOptions, origin: 'send' });
    expect(plan.warnings.some((w) => /Paket okunamadı|could not be read/.test(w))).toBe(true);
  });
});
