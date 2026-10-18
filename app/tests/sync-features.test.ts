import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { compareJob, syncExecSettings, syncGroups, updateDbAfterRun, canTrash } from '../src/core/sync';
import { startRun, pruneBackups } from '../src/core/executor';
import { buildSendPlan } from '../src/core/plan';
import { parseIgnore, ignoreExcludes } from '../src/core/ignore';
import { findSyncJob, headlessFromDisk, runHeadlessSync } from '../src/core/headless';
import { FsTransport } from '../src/core/transport';
import { Service } from '../src/core/service';
import { parseLaunch } from '../src/main/launch';
import { stamp } from '../src/core/util';
import type { Endpoint, SyncJob } from '../src/shared/types';
import { tmpDir, write, read, pathNode, makeCtx, defaultOptions, daysAgo } from './helpers';
import { t } from '../src/shared/i18n';

const BK = '_SamSyncYedek';

function job(left: Endpoint, right: Endpoint, extra: Partial<SyncJob> = {}): SyncJob {
  return { id: 'j1', name: 'Gece', pairs: [{ id: 'p1', left, right }], compare: 'timeSize', variant: 'mirror', filter: { include: [], exclude: [] }, deletion: 'versioning', versioningKeep: 5, ...extra };
}
const local = (p: string): Endpoint => ({ kind: 'local', path: p });
const node = (id: string, subPath = ''): Endpoint => ({ kind: 'node', nodeId: id, subPath });

async function runSync(ctx: ReturnType<typeof makeCtx>, j: SyncJob) {
  const cmp = await compareJob(ctx, j);
  const groups = syncGroups(ctx, j, cmp);
  const detail = await startRun(ctx, groups, syncExecSettings(ctx, j, 's', cmp, groups)).done;
  await updateDbAfterRun(ctx, j, cmp, detail);
  return { cmp, detail };
}

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
};

describe('.samsyncignore', () => {
  it('reads one pattern per line, without comments and blank lines', () => {
    expect(parseIgnore('\uFEFF# build output\r\n*.log\r\n\r\n  Cache/  \n#x\nsub/skip.txt\n')).toEqual(['*.log', 'Cache/', 'sub/skip.txt']);
    expect(ignoreExcludes(['*.log', 'Cache/'])).toEqual({ excludeFiles: ['*.log'], excludeDirs: ['*.log', 'Cache/'] });
  });

  it('adds the patterns of both sync roots to the exclusions, read on the target too, and is never copied', async () => {
    const L = await tmpDir();
    const R = await tmpDir();
    await write(path.join(L, '.samsyncignore'), '# left\n*.log\nCache/\nsub/skip.txt\n');
    await write(path.join(L, 'a.txt'), 'a', daysAgo(1));
    await write(path.join(L, 'run.log'), 'log');
    await write(path.join(L, 'Cache', 'c.bin'), 'c');
    await write(path.join(L, 'sub', 'skip.txt'), 's');
    await write(path.join(L, 'sub', 'take.txt'), 't');
    await write(path.join(L, 'other', 'skip.txt'), 'by path only: this one goes');
    // the right side protects its own folder from the mirror
    await write(path.join(R, '.samsyncignore'), 'Local/\n');
    await write(path.join(R, 'Local', 'mine.txt'), 'mine');
    await write(path.join(R, 'old.log'), 'kept: *.log is ignored');
    await write(path.join(R, 'junk.txt'), 'deleted by the mirror');
    const ctx = makeCtx({ nodes: [pathNode('R', R)] }, [], await tmpDir());
    const { cmp, detail } = await runSync(ctx, job(local(L), node('R')));
    expect(detail.status).toBe('ok');
    const rels = cmp.pairs[0].items.map((i) => i.rel).sort();
    expect(rels).toEqual(['a.txt', 'junk.txt', 'other', 'other/skip.txt', 'sub', 'sub/take.txt']);
    expect(read(path.join(R, 'a.txt'))).toBe('a');
    expect(read(path.join(R, 'sub', 'take.txt'))).toBe('t');
    expect(read(path.join(R, 'other', 'skip.txt'))).toBe('by path only: this one goes');
    expect(fs.existsSync(path.join(R, 'run.log'))).toBe(false);
    expect(fs.existsSync(path.join(R, 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(R, 'sub', 'skip.txt'))).toBe(false);
    expect(fs.existsSync(path.join(R, 'junk.txt'))).toBe(false);
    expect(read(path.join(R, 'Local', 'mine.txt'))).toBe('mine');
    expect(read(path.join(R, 'old.log'))).toBe('kept: *.log is ignored');
    expect(read(path.join(R, '.samsyncignore'))).toBe('Local/\n');
  });

  it('merges the ignore files of the sent folders into the send exclusions', async () => {
    const base = await tmpDir();
    const [src, t1] = ['src', 't1'].map((x) => path.join(base, x));
    await write(path.join(src, 'A', '.samsyncignore'), 'obj/\n*.tmp\n');
    await write(path.join(src, 'A', 'x.txt'), 'x');
    await write(path.join(src, 'A', 'y.tmp'), 'y');
    await write(path.join(src, 'A', 'obj', 'o.bin'), 'o');
    await write(path.join(src, 'B', 'z.tmp'), 'a pattern of A applies in B too');
    await write(path.join(src, 'B', 'z.txt'), 'z');
    await write(path.join(t1, 'A', 'obj', 'target-only.bin'), 'not an extra: ignored');
    const ctx = makeCtx({ nodes: [pathNode('T1', t1)] }, [src], path.join(base, 'ud'));
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: path.join(src, 'A') }, { kind: 'fs', path: path.join(src, 'B') }], targetIds: ['T1'], options: { ...defaultOptions, mode: 'mirror' }, origin: 'send' });
    const ops = plan.targets[0].ops.map((o) => `${o.kind} ${o.rel}`).sort();
    expect(ops).toEqual(['copy A/x.txt', 'copy B/z.txt', 'mkdir B']);
  });
});

describe('Recycle Bin', () => {
  async function sides() {
    const L = await tmpDir();
    const R = await tmpDir();
    await write(path.join(L, 'a.txt'), 'new a', daysAgo(1));
    await write(path.join(R, 'a.txt'), 'old a', daysAgo(3));
    await write(path.join(R, 'extra', 'e.txt'), 'extra');
    return { L, R };
  }
  /** A trash that keeps what it gets, like the operating system's would. */
  async function fakeTrash() {
    const bin = await tmpDir();
    const got: string[] = [];
    const trash = async (abs: string) => {
      got.push(abs);
      await fsp.rename(abs, path.join(bin, `${got.length}-${path.basename(abs)}`));
    };
    return { bin, got, trash };
  }

  it('sends what a local side deletes or replaces to the trash instead of the versioning folder', async () => {
    const { L, R } = await sides();
    const tr = await fakeTrash();
    const ctx = makeCtx({}, [], await tmpDir());
    ctx.trash = tr.trash;
    const { detail } = await runSync(ctx, job(local(L), local(R), { deletion: 'recycle' }));
    expect(detail.status).toBe('ok');
    expect(read(path.join(R, 'a.txt'))).toBe('new a');
    expect(fs.existsSync(path.join(R, 'extra'))).toBe(false);
    expect(tr.got.map((p) => path.relative(R, p).split(path.sep).join('/')).sort()).toEqual(['a.txt', 'extra', 'extra/e.txt']);
    expect(fs.existsSync(path.join(R, BK))).toBe(false);
    const binA = fs.readdirSync(tr.bin).find((n) => n.endsWith('-a.txt'))!;
    expect(read(path.join(tr.bin, binA))).toBe('old a');
    expect(detail.log.some((l) => /geri dönüşüm kutusuna taşındı/.test(l.message))).toBe(true);
  });

  it('falls back to the versioning folder on a target machine, a UNC path, without a trash or when it fails', async () => {
    expect(canTrash(local('C:\\Data'))).toBe(true);
    expect(canTrash(local('\\\\server\\share\\Data'))).toBe(false);
    expect(canTrash(local('//server/share/Data'))).toBe(false);
    expect(canTrash(node('R'))).toBe(false);

    // a target machine: versioning, the trash is not asked
    let s = await sides();
    const tr = await fakeTrash();
    let ctx = makeCtx({ nodes: [pathNode('R', s.R)] }, [], await tmpDir());
    ctx.trash = tr.trash;
    expect((await runSync(ctx, job(local(s.L), node('R'), { deletion: 'recycle' }))).detail.status).toBe('ok');
    expect(tr.got).toEqual([]);
    expect(fs.readdirSync(path.join(s.R, BK))).toHaveLength(1);

    // no trash on this host (tests, the web preview)
    s = await sides();
    ctx = makeCtx({}, [], await tmpDir());
    expect((await runSync(ctx, job(local(s.L), local(s.R), { deletion: 'recycle' }))).detail.status).toBe('ok');
    const stampDir = fs.readdirSync(path.join(s.R, BK))[0];
    expect(read(path.join(s.R, BK, stampDir, 'a.txt'))).toBe('old a');
    expect(read(path.join(s.R, BK, stampDir, 'extra', 'e.txt'))).toBe('extra');

    // a trash that refuses: the run still keeps the old versions
    s = await sides();
    ctx = makeCtx({}, [], await tmpDir());
    ctx.trash = async () => {
      throw new Error('no trash here');
    };
    const { detail } = await runSync(ctx, job(local(s.L), local(s.R), { deletion: 'recycle' }));
    expect(detail.status).toBe('ok');
    expect(read(path.join(s.R, 'a.txt'))).toBe('new a');
    expect(fs.readdirSync(path.join(s.R, BK))).toHaveLength(1);
    expect(detail.log.some((l) => l.level === 'warn' && l.message.includes('no trash here'))).toBe(true);
  });
});

describe('versions by age', () => {
  it('removes stamp folders older than the limit, keeps hand made folders and the count limit still applies', async () => {
    const R = await tmpDir();
    const now = new Date(2026, 9, 16, 12, 0, 0).getTime();
    const day = 86400_000;
    for (const d of [1, 2, 10, 40, 41]) await fsp.mkdir(path.join(R, BK, stamp(new Date(now - d * day))), { recursive: true });
    await fsp.mkdir(path.join(R, BK, 'elle-kaydedilen'), { recursive: true });
    const t = new FsTransport(R);
    const removed = await pruneBackups(t, BK, 0, undefined, 30, now);
    expect(removed.map((r) => path.basename(r)).sort()).toEqual([stamp(new Date(now - 41 * day)), stamp(new Date(now - 40 * day))].sort());
    expect(await pruneBackups(t, BK, 2, undefined, 5, now)).toEqual([`${BK}/${stamp(new Date(now - 10 * day))}`]);
    expect(fs.readdirSync(path.join(R, BK)).sort()).toEqual([stamp(new Date(now - 2 * day)), stamp(new Date(now - day)), 'elle-kaydedilen'].sort());
  });

  it('prunes by age after a successful sync run, also on a side that kept nothing new', async () => {
    const L = await tmpDir();
    const R = await tmpDir();
    const oldStamp = stamp(daysAgo(45));
    const recent = stamp(daysAgo(3));
    await write(path.join(R, BK, oldStamp, 'x.txt'), 'old');
    await write(path.join(R, BK, recent, 'x.txt'), 'recent');
    await write(path.join(L, 'new.txt'), 'n');
    const ctx = makeCtx({ nodes: [pathNode('R', R)] }, [], await tmpDir());
    const j = job(local(L), node('R'), { variant: 'update', versioningKeep: 10, versioningMaxDays: 30 });
    const { detail } = await runSync(ctx, j);
    expect(detail.status).toBe('ok');
    expect(read(path.join(R, 'new.txt'))).toBe('n');
    expect(fs.readdirSync(path.join(R, BK))).toEqual([recent]);

    // without an age limit nothing old goes when nothing new was kept
    await write(path.join(R, BK, oldStamp, 'x.txt'), 'old');
    await write(path.join(L, 'new2.txt'), 'n2');
    await runSync(ctx, { ...j, versioningMaxDays: 0 });
    expect(fs.readdirSync(path.join(R, BK)).sort()).toEqual([oldStamp, recent].sort());
  });
});

describe('--sync', () => {
  it('reads the job from the command line', () => {
    expect(parseLaunch(['--sync', 'Gece yedeği'])).toMatchObject({ headless: 'sync', syncJob: 'Gece yedeği', paths: [], missing: [] });
    expect(parseLaunch(['--sync=job-1'])).toMatchObject({ headless: 'sync', syncJob: 'job-1' });
    expect(parseLaunch(['--sync']).syncJob).toBe('');
  });

  it('finds a job by id or name and refuses a name two jobs share', () => {
    const cfg = makeCtx({ syncJobs: [job(local('a'), local('b')), { ...job(local('a'), local('b')), id: 'j2', name: 'Yedek' }, { ...job(local('a'), local('b')), id: 'j3', name: 'yedek' }] }, [], 'x').config;
    expect(findSyncJob(cfg, 'J1').job?.id).toBe('j1');
    expect(findSyncJob(cfg, ' gece ').job?.id).toBe('j1');
    expect(findSyncJob(cfg, 'YEDEK').error).toContain('j2, j3');
    expect(findSyncJob(cfg, 'yok').job).toBeUndefined();
  });

  it('runs the default actions, prints the summary and exits 0, then 1 when something fails', async () => {
    const L = await tmpDir();
    const R = await tmpDir();
    await write(path.join(L, 'a.txt'), 'a', daysAgo(1));
    await write(path.join(L, 'd', 'b.txt'), 'b', daysAgo(1));
    await write(path.join(R, 'junk.txt'), 'j');
    const ud = await tmpDir();
    const j = job(local(L), node('R'));
    const ctx = makeCtx({ nodes: [pathNode('R', R)], syncJobs: [j] }, [], ud);
    const recorded: string[] = [];
    const r = io();
    expect(await runHeadlessSync(ctx, 'gece', r.io, async (d) => void recorded.push(d.id))).toBe(0);
    expect(read(path.join(R, 'd', 'b.txt'))).toBe('b');
    expect(fs.existsSync(path.join(R, 'junk.txt'))).toBe(false);
    expect(recorded).toHaveLength(1);
    expect(r.out[0]).toContain('Gece (j1)');
    expect(r.out[1].split(/\s+/)).toEqual(['Pair', 'Side', 'Root', 'Copied', 'Deleted', 'Failed', 'Status']);
    const rows = r.out.slice(3, 5).map((l) => l.split(/\s{2,}/));
    expect(rows).toEqual([
      ['1', 'right', R, '3', '1', '0', 'ok'],
      ['1', 'left', L, '0', '0', '0', 'none'],
    ]);
    expect(r.out.slice(5)).toEqual(['Çakışma: 0 (dokunulmadı)', 'Hata: 0']);

    // nothing left to do: still a success
    const again = io();
    expect(await runHeadlessSync(ctx, 'j1', again.io)).toBe(0);
    expect(again.out.slice(3, 5).map((l) => l.split(/\s{2,}/)[6])).toEqual(['none', 'none']);

    // a pair that cannot be compared, an unknown job, no job at all
    const broken = io();
    ctx.config.syncJobs = [job(local(path.join(L, 'yok')), node('R'))];
    expect(await runHeadlessSync(ctx, 'j1', broken.io)).toBe(1);
    expect(broken.out.slice(3, 5).map((l) => l.split(/\s{2,}/)[6])).toEqual(['error', 'error']);
    expect(broken.out.at(-1)).toBe('Hata: 1');
    expect(broken.err.join('\n')).toContain('yok');
    expect(await runHeadlessSync(ctx, 'hayalet', io().io)).toBe(1);
    expect(await runHeadlessSync(ctx, '', io().io)).toBe(1);
  });

  it('loads the config from disk and keeps the run in the history', async () => {
    const base = await tmpDir();
    const [L, R, ud] = ['l', 'r', 'ud'].map((x) => path.join(base, x));
    await write(path.join(L, 'a.txt'), 'a', daysAgo(1));
    await fsp.mkdir(R, { recursive: true });
    await write(path.join(ud, 'config.json'), JSON.stringify({ nodes: [pathNode('R', R)], syncJobs: [job(local(L), node('R'))] }));
    const r = io();
    expect(await headlessFromDisk({ userDataPath: ud, appVersion: '9', systemLanguages: ['tr-TR'], env: {} }, { mode: 'sync', paths: [], missing: [], targets: [], job: 'Gece' }, r.io)).toBe(0);
    expect(read(path.join(R, 'a.txt'))).toBe('a');
    expect(r.err[0]).toContain('--sync');
    const index = JSON.parse(read(path.join(ud, 'history', 'index.json'))!);
    expect(index).toHaveLength(1);
    expect(index[0].origin).toBe('sync');
    expect(fs.readdirSync(path.join(ud, 'reports')).some((n) => n.endsWith('.csv'))).toBe(true);
  });
});

describe('sync job files', () => {
  async function service(jobs: SyncJob[]) {
    const base = await tmpDir();
    const ud = path.join(base, 'ud');
    await fsp.mkdir(ud, { recursive: true });
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [pathNode('Me', path.join(base, 'me'))], syncJobs: jobs }, null, 2));
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    return { svc, base, cfgFile };
  }

  it('exports a job without its machine and imports it as a new job with a free id and name', async () => {
    const scheduled = job(local('C:\\Data'), node('R', 'Data'), { lastRun: '2026-10-01T10:00:00.000Z', schedule: { enabled: true, mode: 'interval', everyMinutes: 30, times: [], machineId: 'Other', notify: 'errors' } });
    const { svc, base, cfgFile } = await service([scheduled]);
    try {
      const file = path.join(base, 'Gece.samsync-job.json');
      await svc.exportSyncJob('j1', file);
      const raw = JSON.parse(read(file)!);
      expect(raw.samsyncSyncJob).toBe(1);
      expect(raw.job.name).toBe('Gece');
      expect(raw.job.pairs).toEqual(scheduled.pairs);
      expect(raw.job.schedule).toEqual({ enabled: true, mode: 'interval', everyMinutes: 30, times: [], notify: 'errors' });
      await expect(svc.exportSyncJob('yok', file)).rejects.toThrow();

      const id = await svc.importSyncJob(file);
      expect(id).not.toBe('j1');
      const added = svc.config.syncJobs.find((j) => j.id === id)!;
      expect(added.name).toBe('Gece (2)');
      expect(added.lastRun).toBeUndefined();
      // its schedule runs on this machine, not on every machine sharing the configuration
      expect(added.schedule).toMatchObject({ enabled: true, machineId: 'Me' });
      const saved = JSON.parse(read(cfgFile)!);
      expect(saved.syncJobs.map((j: SyncJob) => j.id)).toEqual(['j1', id]);
      expect(await svc.importSyncJob(file)).not.toBe(id);
      expect(svc.config.syncJobs.map((j) => j.name)).toEqual(['Gece', 'Gece (2)', 'Gece (3)']);
    } finally {
      svc.automation?.stop();
    }
  });

  it('keeps the id when it is free and refuses files that are not job files', async () => {
    const { svc, base } = await service([]);
    try {
      const file = path.join(base, 'x.json');
      await fsp.writeFile(file, JSON.stringify({ samsyncSyncJob: 1, job: job(local('a'), local('b'), { id: 'kendi' }) }));
      expect(await svc.importSyncJob(file)).toBe('kendi');
      for (const bad of [{ schema: 2, nodes: [] }, { samsyncSyncJob: 1, job: { id: 'x', name: 'x', pairs: [] } }, { samsyncSyncJob: 1, job: { id: 'x', pairs: [{ left: {}, right: {} }] } }]) {
        await fsp.writeFile(file, JSON.stringify(bad));
        await expect(svc.importSyncJob(file)).rejects.toThrow();
      }
      await fsp.writeFile(file, '{ bozuk');
      await expect(svc.importSyncJob(file)).rejects.toThrow();
      expect(svc.config.syncJobs.map((j) => j.id)).toEqual(['kendi']);
    } finally {
      svc.automation?.stop();
    }
  });
});

describe('conflicts kept both ways', () => {
  it('copies each side next to the other, remembers the pair and leaves it alone until one side changes', async () => {
    const base = await tmpDir();
    const L = path.join(base, 'L');
    const Rt = path.join(base, 'R');
    const when = daysAgo(1);
    await write(path.join(L, 'doc.txt'), 'left v2', when);
    await write(path.join(Rt, 'doc.txt'), 'right v2!', when);
    await write(path.join(L, 'same.txt'), 'same', when);
    await write(path.join(Rt, 'same.txt'), 'same', when);
    const ctx = makeCtx({}, [], path.join(base, 'ud'));
    const j = job(local(L), local(Rt), { variant: 'twoWay' });

    // same time, different content: a conflict with no suggestion
    const cmp = await compareJob(ctx, j);
    const it = cmp.pairs[0].items.find((x) => x.rel === 'doc.txt')!;
    expect(it.category).toBe('conflict');
    expect(it.action).toBe('none');
    it.action = 'keepBoth';
    const groups = syncGroups(ctx, j, cmp);
    const [SOL, SAG] = [t('sol'), t('sağ')];
    expect(groups.map((g) => g.ops.map((o) => o.rel)).flat().sort()).toEqual([`doc (${SOL}).txt`, `doc (${SAG}).txt`].sort());
    const d = await startRun(ctx, groups, syncExecSettings(ctx, j, 's', cmp, groups)).done;
    expect(d.status).toBe('ok');
    await updateDbAfterRun(ctx, j, cmp, d);
    expect(read(path.join(Rt, `doc (${SOL}).txt`))).toBe('left v2');
    expect(read(path.join(L, `doc (${SAG}).txt`))).toBe('right v2!');
    expect(read(path.join(L, 'doc.txt'))).toBe('left v2');
    expect(read(path.join(Rt, 'doc.txt'))).toBe('right v2!');

    // next time: the pair is known and stays quiet; the two copies travel like any new file
    const again = await compareJob(ctx, j);
    const it2 = again.pairs[0].items.find((x) => x.rel === 'doc.txt')!;
    expect(it2.action).toBe('none');
    expect(it2.category).toBe('conflict');
    expect(it2.conflict).toMatch(/saklanmıştı|kept/);
    const copies = again.pairs[0].items.filter((x) => x.rel.includes(`(${SOL})`) || x.rel.includes(`(${SAG})`));
    expect(copies.map((c) => c.action).sort()).toEqual(['copyLeft', 'copyRight']);

    // one side edited afterwards: the usual two way rule again
    await write(path.join(L, 'doc.txt'), 'left v3', new Date());
    const third = await compareJob(ctx, j);
    expect(third.pairs[0].items.find((x) => x.rel === 'doc.txt')!.action).toBe('copyRight');
  });
});
