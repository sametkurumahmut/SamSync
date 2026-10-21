import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { buildSendPlan } from '../src/core/plan';
import { startRun, type ExecGroup } from '../src/core/executor';
import { FsTransport, transportForNode } from '../src/core/transport';
import { overrideFor, pickOverrides, setOverride, targetOptions, withoutMirror } from '../src/shared/options';
import { findBackups, otherBackupRoots, restoreGroups } from '../src/core/backups';
import { compareJob } from '../src/core/sync';
import type { SendOptions, SendRequest, SyncJob } from '../src/shared/types';
import { convertWizardState, findWizardStates, type WizardState } from '../src/core/wizardImport';
import { emptyConfig } from '../src/core/config';
import { Service } from '../src/core/service';
import { headlessFromDisk, runHeadless, type HeadlessRequest } from '../src/core/headless';
import { parseLaunch } from '../src/main/launch';
import { setLang } from '../src/shared/i18n';
import { tmpDir, write, read, pathNode, makeCtx, defaultOptions, daysAgo } from './helpers';

// The older tool kept its backups in "_<its name>Yedek"; the name is not written in this app, so the tests use a
// stand-in with the same shape.
const OLD = '_EskiAracYedek';

let src: string;
let t1: string;
let t2: string;
let data: string;

beforeEach(async () => {
  const base = await tmpDir();
  src = path.join(base, 'src');
  t1 = path.join(base, 't1');
  t2 = path.join(base, 't2');
  data = path.join(base, 'userdata');
  await fsp.mkdir(src, { recursive: true });
  await fsp.mkdir(t1, { recursive: true });
  await fsp.mkdir(t2, { recursive: true });
});

const req = (paths: string[], opts: Partial<SendRequest['options']> = {}, targets = ['T1']): SendRequest => ({
  sources: paths.map((p) => ({ kind: 'fs' as const, path: p })),
  targetIds: targets,
  options: { ...defaultOptions, ...opts },
  origin: 'send',
});

describe('older backup folders at a target root', () => {
  it('are recognised by their shape: "_" and nothing but date folders', async () => {
    await write(path.join(t1, OLD, '20250101-101010', 'Data', 'x.txt'), 'x');
    await write(path.join(t1, OLD, '20250202-101010', 'y.txt'), 'y');
    await write(path.join(t1, OLD, 'desktop.ini'), '');
    await write(path.join(t1, '_Notlar', '20250101-101010', 'n.txt'), 'n');
    await write(path.join(t1, '_Notlar', 'oku.txt'), 'not a backup folder: it holds a file');
    await write(path.join(t1, '_Karisik', '20250101-101010', 'n.txt'), 'n');
    await fsp.mkdir(path.join(t1, '_Karisik', 'Eski'), { recursive: true });
    await write(path.join(t1, 'Arsiv', '20250101-101010', 'a.txt'), 'no leading underscore');
    await fsp.mkdir(path.join(t1, '_Bos'), { recursive: true });
    await write(path.join(t1, '_SamSyncYedek', '20250101-101010', 'z.txt'), 'the configured folder is not "other"');
    expect(await otherBackupRoots(new FsTransport(t1), '_SamSyncYedek')).toEqual([OLD]);
  });

  it('are neither deleted by a mirror send of the whole root nor written into', async () => {
    await write(path.join(src, 'Data', 'a.txt'), 'a', daysAgo(1));
    await write(path.join(t1, 'Data', 'extra.txt'), 'extra', daysAgo(2));
    await write(path.join(t1, OLD, '20250101-101010', 'Data', 'a.txt'), 'old a', daysAgo(30));
    const ctx = makeCtx({ nodes: [pathNode('T1', t1)] }, [src], data);
    const plan = await buildSendPlan(ctx, req([src], { mode: 'mirror' }));
    const tp = plan.targets[0];
    expect(tp.ops.filter((o) => o.kind === 'delete').map((o) => o.rel)).toEqual(['Data/extra.txt']);
    expect(tp.ops.some((o) => o.rel.startsWith(OLD))).toBe(false);
    expect(plan.warnings.some((w) => w.includes(OLD))).toBe(true);
  });

  it('are not sent along when the local root itself holds one', async () => {
    await write(path.join(src, 'a.txt'), 'a');
    await write(path.join(src, OLD, '20250101-101010', 'a.txt'), 'old a');
    const ctx = makeCtx({ nodes: [pathNode('T1', t1)] }, [src], data);
    const plan = await buildSendPlan(ctx, req([src]));
    expect(plan.targets[0].ops.map((o) => o.rel)).toEqual(['a.txt']);
  });

  it('are left alone by a mirror folder sync of a machine root', async () => {
    await write(path.join(src, 'a.txt'), 'a', daysAgo(1));
    await write(path.join(t1, OLD, '20250101-101010', 'a.txt'), 'old a', daysAgo(30));
    const ctx = makeCtx({ nodes: [pathNode('T1', t1)] }, [], data);
    const job: SyncJob = {
      id: 'j',
      name: 'j',
      pairs: [{ id: 'p', left: { kind: 'local', path: src }, right: { kind: 'node', nodeId: 'T1', subPath: '' } }],
      compare: 'timeSize',
      variant: 'mirror',
      filter: { include: [], exclude: [] },
      deletion: 'permanent',
      versioningKeep: 5,
    };
    const cmp = await compareJob(ctx, job);
    expect(cmp.pairs[0].items.map((i) => i.rel)).toEqual(['a.txt']);
  });

  it('show up on the Backups page and can be restored from', async () => {
    await write(path.join(t1, 'cfg', 'x.ini'), 'current');
    await write(path.join(t1, '_SamSyncYedek', '20260101-101010', 'cfg', 'x.ini'), 'new tool');
    await write(path.join(t1, OLD, '20250101-101010', 'cfg', 'x.ini'), 'old tool');
    const ctx = makeCtx({ nodes: [pathNode('T1', t1)] }, [], data);
    const [found] = await findBackups(ctx, 'cfg/x.ini', ['T1']);
    expect(found.versions.map((v) => [v.folder, v.stamp])).toEqual([
      ['_SamSyncYedek', '20260101-101010'],
      [OLD, '20250101-101010'],
    ]);
    const groups = await restoreGroups(ctx, 'cfg/x.ini', [{ targetId: 'T1', stamp: '20250101-101010', folder: OLD }]);
    const done = await startRun(ctx, groups, {
      label: 'r',
      origin: 'restore',
      dryRun: false,
      backup: false,
      backupKeep: 5,
      backupFolderName: '_SamSyncYedek',
      verify: false,
      retryCount: 0,
      waitSeconds: 0,
      parallelGroups: 1,
      parallelFiles: 1,
      postCommandTimeoutSeconds: 5,
      sources: [],
      targetIds: [],
    }).done;
    expect(done.status).toBe('ok');
    expect(read(path.join(t1, 'cfg', 'x.ini'))).toBe('old tool');
    // a folder that climbs out of the target root is refused
    await expect(restoreGroups(ctx, 'cfg/x.ini', [{ targetId: 'T1', stamp: '20250101-101010', folder: '..' }])).rejects.toThrow();
    await expect(restoreGroups(ctx, 'cfg/x.ini', [{ targetId: 'T1', stamp: '../x', folder: OLD }])).rejects.toThrow();
    expect(fs.existsSync(path.join(t1, OLD, '20250101-101010', 'cfg', 'x.ini'))).toBe(true);
  });
});

describe('per target backup / newer only / mirror', () => {
  it('keeps only real exceptions and finds them without case', () => {
    const o = { ...defaultOptions, mode: 'overwrite' as const, backup: false };
    let per = setOverride(o, 'PC1', { mode: 'mirror', backup: true });
    expect(per).toEqual({ PC1: { mode: 'mirror', backup: true } });
    // the general value is not an exception
    per = setOverride({ ...o, perTarget: per }, 'pc1', { backup: false });
    expect(per).toEqual({ pc1: { mode: 'mirror' } });
    expect(overrideFor(per, 'PC1')).toEqual({ mode: 'mirror' });
    expect(setOverride({ ...o, perTarget: per }, 'PC1', { mode: 'overwrite' })).toEqual({});
    expect(setOverride({ ...o, perTarget: { PC1: { backup: true }, PC2: { mode: 'update' } } }, 'PC1', null)).toEqual({ PC2: { mode: 'update' } });
    expect(targetOptions({ ...o, perTarget: { PC2: { mode: 'update', backup: true } } }, 'pc2')).toMatchObject({ mode: 'update', backup: true });
    expect(targetOptions(o, 'PC3')).toBe(o);
    expect(pickOverrides({ PC1: { backup: true }, PC2: { mode: 'update' } }, ['pc2'])).toEqual({ PC2: { mode: 'update' } });
    expect(withoutMirror({ PC1: { mode: 'mirror' }, PC2: { mode: 'mirror', backup: true }, PC3: { mode: 'update' } })).toEqual({ PC2: { backup: true }, PC3: { mode: 'update' } });
  });

  it('plans and runs each target with its own mode and backup', async () => {
    await write(path.join(src, 'D', 'a.txt'), 'new a', daysAgo(2));
    await write(path.join(src, 'D', 'old.txt'), 'source', daysAgo(5));
    for (const t of [t1, t2]) {
      await write(path.join(t, 'D', 'a.txt'), 'old a', daysAgo(4));
      await write(path.join(t, 'D', 'old.txt'), 'target is newer', daysAgo(1));
      await write(path.join(t, 'D', 'extra.txt'), 'extra', daysAgo(3));
    }
    const ctx = makeCtx({ nodes: [pathNode('T1', t1), pathNode('T2', t2)] }, [src], data);
    // general: overwrite, no backup; T1 mirrors with backup, T2 only takes newer files
    const plan = await buildSendPlan(ctx, req([path.join(src, 'D')], { perTarget: { T1: { mode: 'mirror', backup: true }, t2: { mode: 'update' } } }, ['T1', 'T2']));
    const [p1, p2] = plan.targets;
    expect([p1.mode, p1.backup, p2.mode, p2.backup]).toEqual(['mirror', true, 'update', false]);
    const sel = (tp: typeof p1) => tp.ops.filter((o) => o.selected).map((o) => o.rel).sort();
    expect(sel(p1)).toEqual(['D/a.txt', 'D/extra.txt', 'D/old.txt']);
    expect(sel(p2)).toEqual(['D/a.txt']);
    // only the mirroring target counts towards the deletion warning
    expect(plan.warnings.find((w) => w.startsWith('Ayna kipi'))).toContain('1 ');
    const groups: ExecGroup[] = plan.targets.map((tp) => ({
      key: tp.targetId,
      title: tp.targetName,
      rootLabel: tp.root,
      backup: tp.backup,
      open: () => transportForNode(ctx, ctx.config.nodes.find((n) => n.id === tp.targetId)!),
      ops: tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src })),
    }));
    const done = await startRun(ctx, groups, {
      label: 't',
      origin: 'send',
      dryRun: false,
      backup: false,
      backupKeep: 5,
      backupFolderName: '_SamSyncYedek',
      verify: false,
      retryCount: 0,
      waitSeconds: 0,
      parallelGroups: 2,
      parallelFiles: 2,
      postCommandTimeoutSeconds: 5,
      sources: [],
      targetIds: [],
    }).done;
    expect(done.status).toBe('ok');
    expect(fs.existsSync(path.join(t1, 'D', 'extra.txt'))).toBe(false);
    expect(read(path.join(t1, 'D', 'old.txt'))).toBe('source');
    expect(fs.readdirSync(path.join(t1, '_SamSyncYedek'))).toHaveLength(1);
    expect(read(path.join(t2, 'D', 'old.txt'))).toBe('target is newer');
    expect(read(path.join(t2, 'D', 'extra.txt'))).toBe('extra');
    expect(read(path.join(t2, 'D', 'a.txt'))).toBe('new a');
    expect(fs.existsSync(path.join(t2, '_SamSyncYedek'))).toBe(false);
  });
});

describe('--plan-only and --check-only', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
  };
  const me = { id: 'Me', name: 'Me', address: '198.51.100.1', localRoots: [] as string[], networkRoot: 'x', enabled: true };
  const identity = (node: typeof me | null) => ({ node, reason: 'test', method: 'override' as const, candidates: [], hostname: 'h', addresses: [] });
  const rowsOf = (out: string[]) => out.slice(2).map((l) => l.split(/\s{2,}/));

  it('reads the flags and keeps the paths that do not exist for the report', () => {
    const l = parseLaunch(['--check-only', '--to', 'group:U1', __filename, 'C:\\yok\\boyle.txt']);
    expect(l).toMatchObject({ headless: 'check', targets: ['group:U1'], paths: [path.resolve(__filename)], missing: [path.resolve('C:\\yok\\boyle.txt')] });
    expect(parseLaunch(['--plan-only']).headless).toBe('plan');
    expect(parseLaunch([__filename]).headless).toBeUndefined();
  });

  it('checks every target the old way: same, different, missing, unreachable; exit code 1 when not all the same', async () => {
    const base = path.dirname(t1);
    const [same, diff, none] = ['same', 'diff', 'none'].map((x) => path.join(base, x));
    await write(path.join(src, 'D', 'a.txt'), 'a', daysAgo(2));
    await write(path.join(src, 'D', 'sub', 'b.txt'), 'b', daysAgo(2));
    await write(path.join(src, 'top.txt'), 't', daysAgo(2));
    for (const d of [same, diff]) {
      await write(path.join(d, 'D', 'a.txt'), 'a', daysAgo(2));
      await write(path.join(d, 'D', 'sub', 'b.txt'), 'b', daysAgo(2));
      await write(path.join(d, 'top.txt'), 't', daysAgo(2));
    }
    await write(path.join(same, 'D', 'extra.txt'), 'an extra file alone does not make a difference', daysAgo(2));
    await write(path.join(diff, 'D', 'a.txt'), 'changed on the target later', daysAgo(1));
    await fsp.rm(path.join(diff, 'top.txt'));
    await fsp.mkdir(none, { recursive: true });
    const local = { ...me, localRoots: [src] };
    const ctx = makeCtx({ nodes: [local, pathNode('Same', same), pathNode('Diff', diff), pathNode('None', none), pathNode('Off', path.join(base, 'off'))] }, [src], data);
    ctx.localNodeId = 'Me';
    const r = io();
    const code = await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'check', paths: [path.join(src, 'D'), path.join(src, 'top.txt')], missing: [], targets: [] }, r.io);
    expect(code).toBe(1);
    expect(r.out[0].split(/\s+/)).toEqual(['Target', 'TargetId', 'State', 'Changes', 'Missing', 'DestNewer', 'Extras']);
    expect(rowsOf(r.out)).toEqual([
      ['Same', 'Same', 'Ayni', '0', '0', '0', '1'],
      ['Diff', 'Diff', 'Farkli', '1', '1', '1', '0'],
      ['None', 'None', 'Yok', '0', '2', '0', '0'],
      ['Off', 'Off', 'Erisilemedi', '0', '0', '0', '0'],
    ]);
    const ok = io();
    expect(await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'check', paths: [path.join(src, 'D')], missing: [], targets: ['Same'] }, ok.io)).toBe(0);
  });

  it("prints where every item goes, with each target's own options from a profile, without touching the targets", async () => {
    await write(path.join(src, 'Data', 'x.entity'), 'x');
    const local = { ...me, localRoots: [src] };
    const ctx = makeCtx(
      {
        nodes: [local, pathNode('PC1', path.join(t1, 'nope'), { group: 'U1' }), pathNode('PC2', t2, { group: 'U1' })],
        profiles: [{ id: 'p', name: 'Dene', targetIds: ['PC1', 'PC2'], options: { mode: 'update', perTarget: { PC2: { mode: 'mirror', backup: true } } } }],
      },
      [src],
      data,
    );
    ctx.localNodeId = 'Me';
    const r = io();
    const code = await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'plan', paths: [path.join(src, 'Data', 'x.entity')], missing: [], targets: ['profile:dene'] }, r.io);
    expect(code).toBe(0);
    const rows = rowsOf(r.out);
    expect(rows.map((x) => [x[3], x[4], x[5] ?? ''])).toEqual([
      ['PC1', path.join(t1, 'nope', 'Data', 'x.entity'), 'OnlyNewer'],
      ['PC2', path.join(t2, 'Data', 'x.entity'), 'Backup,Mirror'],
    ]);
    expect(rows[0][1]).toBe(src);
    expect(fs.existsSync(path.join(t2, 'Data'))).toBe(false);
  });

  it('fails with exit code 1 on a missing source, an unknown target or an unknown machine', async () => {
    const local = { ...me, localRoots: [src] };
    const ctx = makeCtx({ nodes: [local, pathNode('T1', t1)] }, [src], data);
    ctx.localNodeId = 'Me';
    const run = async (req: Partial<HeadlessRequest>, node: typeof me | null = local) => {
      const r = io();
      const code = await runHeadless(ctx, identity(node), { lastTargets: [] }, { mode: 'check', paths: [src], missing: [], targets: [], ...req }, r.io);
      return { code, err: r.err.join('\n') };
    };
    expect((await run({ missing: [path.join(src, 'yok.txt')] })).code).toBe(1);
    const ghost = await run({ targets: ['group:Hayalet'] });
    expect(ghost.code).toBe(1);
    expect(ghost.err).toContain('group:Hayalet');
    expect((await run({}, null)).code).toBe(1);
    expect((await run({ paths: [] })).code).toBe(1);
  });

  it('loads the settings and the config the way the app does', async () => {
    await write(path.join(src, 'a.txt'), 'a', daysAgo(1));
    await write(path.join(t1, 'a.txt'), 'a', daysAgo(1));
    const configPath = path.join(data, 'shared', 'config.json');
    await write(configPath, JSON.stringify({ nodes: [{ ...me, localRoots: [src] }, pathNode('T1', t1)] }));
    await write(path.join(data, 'settings.json'), JSON.stringify({ configPath, localNodeId: 'Me', language: 'en' }));
    const r = io();
    try {
      const code = await headlessFromDisk({ userDataPath: data, appVersion: '9.9.9', systemLanguages: ['tr-TR'], env: {} }, { mode: 'check', paths: [path.join(src, 'a.txt')], missing: [], targets: ['all'] }, r.io);
      expect(code).toBe(0);
      expect(rowsOf(r.out)).toEqual([['T1', 'T1', 'Ayni', '0', '0', '0', '0']]);
      expect(r.err.join('\n')).toContain('This machine: Me');
      const empty = await headlessFromDisk({ userDataPath: path.join(data, 'bos'), appVersion: '9', systemLanguages: [], env: {} }, { mode: 'plan', paths: [src], missing: [], targets: [] }, io().io);
      expect(empty).toBe(1);
    } finally {
      setLang('tr');
    }
  });

  it('--pack writes the items as one pack; --since leaves out what an earlier pack or a machine already has', async () => {
    const out = path.join(path.dirname(t1), 'packs');
    const l = parseLaunch(['--pack', out, '--since', 'T1', __filename]);
    expect(l).toMatchObject({ headless: 'pack', packDir: path.resolve(out), since: 'T1', paths: [path.resolve(__filename)] });
    expect(parseLaunch(['--pack=x', '--since=old.samsync-pack']).since).toBe(path.resolve('old.samsync-pack'));
    await write(path.join(src, 'Data', 'a.txt'), 'a', daysAgo(2));
    await write(path.join(src, 'Data', 'b.txt'), 'b', daysAgo(2));
    const local = { ...me, localRoots: [src] };
    const ctx = makeCtx({ nodes: [local, pathNode('T1', t1)] }, [src], data);
    ctx.localNodeId = 'Me';
    const full = io();
    expect(await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'pack', paths: [path.join(src, 'Data')], missing: [], targets: [], packDir: out }, full.io)).toBe(0);
    const first = full.out[0];
    expect(first.endsWith('.samsync-pack')).toBe(true);
    expect(fs.existsSync(first)).toBe(true);
    expect(full.err.join('\n')).toMatch(/2 dosya|2 files/);
    // one file changes: a pack against the first one holds only that
    await write(path.join(src, 'Data', 'b.txt'), 'b2', daysAgo(1));
    await fsp.rename(first, path.join(out, 'first.samsync-pack'));
    const inc = io();
    expect(await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'pack', paths: [path.join(src, 'Data')], missing: [], targets: [], packDir: out, since: path.join(out, 'first.samsync-pack') }, inc.io)).toBe(0);
    expect(inc.err.join('\n')).toMatch(/1 dosya,|1 files?,/);
    // the machine T1 holds a.txt as it is: a pack against it leaves that out
    await write(path.join(t1, 'Data', 'a.txt'), 'a', daysAgo(2));
    const { scanTree } = await import('../src/core/scan');
    const { saveManifestSubtree } = await import('../src/core/manifest');
    const t1fs = new FsTransport(t1);
    await saveManifestSubtree(t1fs, 'Data', (await scanTree(t1fs, 'Data', { caseInsensitive: true })).entries, { host: 'h' }, 'önceki');
    const m = io();
    expect(await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'pack', paths: [path.join(src, 'Data')], missing: [], targets: [], packDir: out, since: 'T1' }, m.io)).toBe(0);
    expect(m.err.join('\n')).toMatch(/1 dosya,|1 files?,/);
    // errors: no folder, an unknown machine, a pack that is not there
    expect(await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'pack', paths: [path.join(src, 'Data')], missing: [], targets: [] }, io().io)).toBe(1);
    expect(await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'pack', paths: [path.join(src, 'Data')], missing: [], targets: [], packDir: out, since: 'Yok' }, io().io)).toBe(1);
    expect(await runHeadless(ctx, identity(local), { lastTargets: [] }, { mode: 'pack', paths: [path.join(src, 'Data')], missing: [], targets: [], packDir: out, since: path.join(out, 'none.samsync-pack') }, io().io)).toBe(1);
  });
});

describe('importing the old wizard state', () => {
  const nodes = [pathNode('Me', '/x'), pathNode('PC1', '/1', { group: 'U1' }), pathNode('PC2', '/2', { group: 'U1' }), pathNode('PC3', '/3'), pathNode('Server', '/t')];
  const cfgPath = 'C:\\Tools\\Old\\config.json';
  // the shape the PowerShell wizard wrote (ConvertTo-Json of its settings, keyed by the lower case config path)
  const state: WizardState & { version: number } = {
    version: 1,
    configs: {
      'c:\\somewhere\\else\\config.json': { global: {}, targets: { Other1: { selected: true } } },
      [cfgPath.toLowerCase()]: {
        global: { dryRun: true, fastCopy: false, excludeFiles: '*.pdb; *.tmp', excludeDirectories: 'Logs', notify: false, parallelTargets: 6, throttleMilliseconds: 0, retryCount: -1, waitSeconds: -1 },
        targets: {
          pc1: { selected: true, backup: true, onlyNewer: false, mirror: false },
          PC2: { selected: true, backup: true, onlyNewer: false, mirror: true },
          PC3: { selected: false, backup: false, onlyNewer: true, mirror: false },
          Server: { selected: true, backup: true, onlyNewer: false, mirror: false },
          Gone: { selected: true, backup: false, onlyNewer: false, mirror: false },
        },
        profiles: {
          Lab1PC: { global: {}, targets: { PC1: { selected: true, onlyNewer: true }, PC2: { selected: true, onlyNewer: true }, PC3: { selected: false } } },
        },
      },
    },
  };

  it('turns the per machine columns into general options plus exceptions, so no machine changes', () => {
    const cfg = { ...emptyConfig(), nodes };
    const c = convertWizardState(state, cfg, cfgPath)!;
    expect(c.configKey).toBe(cfgPath.toLowerCase());
    expect(c.lastTargets).toEqual(['PC1', 'PC2', 'Server']);
    expect(c.unknownTargets).toEqual(['Gone']);
    expect(c.lastOptions).toMatchObject({ mode: 'overwrite', backup: true, notify: false, parallelTargets: 6, perTarget: { PC2: { mode: 'mirror' }, PC3: { mode: 'update', backup: false } } });
    // the wizard's lists come on top of the config's defaults
    expect(c.lastOptions.excludeFiles).toEqual(['*.pdb', '*.tmp']);
    expect(c.lastOptions.excludeDirs).toEqual([...cfg.copy.excludeDirs, 'Logs']);
    expect(c.lastOptions).not.toHaveProperty('dryRun');
    // every machine ends up with exactly the columns it had in the wizard
    const columns = { PC1: [true, 'overwrite'], PC2: [true, 'mirror'], PC3: [false, 'update'], Server: [true, 'overwrite'] };
    for (const [id, want] of Object.entries(columns)) {
      const eff = targetOptions({ ...defaultOptions, ...c.lastOptions } as SendOptions, id);
      expect([eff.backup, eff.mode]).toEqual(want);
    }
    expect(c.profiles).toEqual([{ id: 'Lab1PC', name: 'Lab1PC', targetIds: ['PC1', 'PC2'], options: { mode: 'update', backup: false, perTarget: {} } }]);
  });

  it('picks the entry that knows this config\'s machines when the folder has moved', () => {
    const c = convertWizardState(state, { ...emptyConfig(), nodes }, 'D:\\moved\\config.json')!;
    expect(c.configKey).toBe(cfgPath.toLowerCase());
    expect(convertWizardState({ configs: {} }, { ...emptyConfig(), nodes }, cfgPath)).toBeNull();
  });

  it('finds the state file one folder below %LOCALAPPDATA% without knowing the folder name', async () => {
    const lad = await tmpDir();
    await write(path.join(lad, 'SomeTool', 'wizard-state.json'), '\ufeff' + JSON.stringify(state));
    await write(path.join(lad, 'Other', 'wizard-state.json'), JSON.stringify({ something: 'else' }));
    await write(path.join(lad, 'Third', 'settings.json'), '{}');
    expect(await findWizardStates(lad)).toEqual([path.join(lad, 'SomeTool', 'wizard-state.json')]);
    expect(await findWizardStates(path.join(lad, 'nope'))).toEqual([]);
  });

  it('imports once through the app: profiles into the config, the last selection into the settings', async () => {
    const base = await tmpDir();
    const ud = path.join(base, 'ud');
    const cfgFile = path.join(base, 'config.json');
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, profiles: [{ id: 'lab1ig', name: 'lab1PC', targetIds: ['PC3'] }] }));
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const file = path.join(base, 'wizard-state.json');
    await fsp.writeFile(file, JSON.stringify({ ...state, configs: { ...state.configs, [cfgFile.toLowerCase()]: { ...state.configs[cfgPath.toLowerCase()], profiles: { ...state.configs[cfgPath.toLowerCase()].profiles, Sunucular: { targets: { Server: { selected: true, backup: true } } } } } } }));
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    try {
      const r = await svc.importWizardState(file);
      expect(r.configKey).toBe(cfgFile.toLowerCase());
      expect(r.profilesAdded).toEqual(['Sunucular']);
      expect(r.profilesSkipped).toEqual(['Lab1PC']);
      expect(r.settings.lastTargets).toEqual(['PC1', 'PC2', 'Server']);
      expect(r.settings.lastOptions?.perTarget).toEqual({ PC2: { mode: 'mirror' }, PC3: { mode: 'update', backup: false } });
      expect(r.settings.wizardImport?.file).toBe(file);
      const saved = JSON.parse(await fsp.readFile(cfgFile, 'utf8'));
      expect(saved.profiles.map((p: { name: string }) => p.name)).toEqual(['lab1PC', 'Sunucular']);
      expect(saved.profiles[1]).toMatchObject({ targetIds: ['Server'], options: { backup: true } });
      const settings = JSON.parse(await fsp.readFile(path.join(ud, 'settings.json'), 'utf8'));
      expect(settings.lastTargets).toEqual(['PC1', 'PC2', 'Server']);
      await fsp.writeFile(path.join(base, 'not-it.json'), '{"nodes": []}');
      await expect(svc.importWizardState(path.join(base, 'not-it.json'))).rejects.toThrow(/wizard|sihirbaz/);
    } finally {
      svc.automation?.stop();
      setLang('tr');
    }
  });
});
