import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import { loadConfig, normalizeConfig, saveConfigFile } from '../src/core/config';
import { buildSendPlan } from '../src/core/plan';
import { filterPreview } from '../src/core/filterpreview';
import { startMessage } from '../src/core/notifications';
import { waitRelayResult } from '../src/core/relay';
import { FsTransport } from '../src/core/transport';
import { CancelToken } from '../src/core/util';
import { errorHint, errorHints } from '../src/shared/errorhint';
import { inHours, parseHours } from '../src/shared/machine';
import { machinesFromCsv, mergeMachines } from '../src/shared/machinecsv';
import { RELAY_FOLDER } from '../src/shared/relay';
import type { NodeConfig, RunDetail, SendPlan, SendRequest } from '../src/shared/types';
import { tmpDir, write, pathNode, makeCtx, defaultOptions, sleep } from './helpers';

describe('error hints', () => {
  it('explain the usual errors and leave the rest alone', () => {
    expect(errorHint("EACCES: permission denied, open '\\\\pc\\share\\a.dll'")).toMatch(/Yazma izni yok|No permission/);
    expect(errorHint('ENOSPC: no space left on device, write')).toMatch(/yer kalmadı|space/);
    expect(errorHint('EBUSY: resource busy or locked')).toMatch(/kullanıyor|program/);
    expect(errorHint('The semaphore timeout period has expired.')).toMatch(/koptu|dropped/);
    expect(errorHint('Logon failure: unknown user name or bad password.')).toMatch(/kullanıcıyla|user/);
    expect(errorHint('ENAMETOOLONG: name too long')).toMatch(/Yol çok uzun|too long/);
    expect(errorHint('something else entirely')).toBeNull();
    expect(errorHint(undefined)).toBeNull();
  });

  it('are counted for a list of errors, most first', () => {
    const h = errorHints(['EBUSY: resource busy', 'EACCES: permission denied', 'EBUSY: resource busy', 'odd']);
    expect(h.map((x) => x.count)).toEqual([2, 1]);
  });
});

describe('bandwidth hours', () => {
  it('read "from-to", also over midnight, and hold always when none are set', () => {
    expect(parseHours('08:00-18:00')).toEqual({ from: 480, to: 1080 });
    expect(parseHours(' 8:30 - 17:05 ')).toEqual({ from: 510, to: 1025 });
    expect(parseHours('18:00-08:00')).toEqual({ from: 1080, to: 480 });
    for (const bad of ['', '8-18', '25:00-26:00', '08:61-09:00', '08:00-08:00']) expect(parseHours(bad)).toBeNull();
    const at = (h: number, m = 0) => new Date(2026, 9, 22, h, m);
    expect(inHours('08:00-18:00', at(12))).toBe(true);
    expect(inHours('08:00-18:00', at(18))).toBe(false);
    expect(inHours('08:00-18:00', at(7, 59))).toBe(false);
    expect(inHours('22:00-06:00', at(23))).toBe(true);
    expect(inHours('22:00-06:00', at(5, 59))).toBe(true);
    expect(inHours('22:00-06:00', at(12))).toBe(false);
    expect(inHours(undefined, at(3))).toBe(true);
    expect(normalizeConfig({ schema: 2, nodes: [], copy: { bandwidthHours: ' 08:00 - 18:00 ' } } as never).copy.bandwidthHours).toBe('08:00-18:00');
    expect(normalizeConfig({ schema: 2, nodes: [], copy: { bandwidthHours: 'never' } } as never).copy.bandwidthHours).toBeUndefined();
  });
});

describe('machine list import with some columns only', () => {
  it('changes only what the file has columns for', () => {
    const current: NodeConfig[] = [{ ...pathNode('A', 'C:\\a', { group: 'G', tags: ['x'], mac: 'AA:BB:CC:DD:EE:FF', relay: true }), localRoots: ['D:\\Data'], enabled: false }];
    const csv = machinesFromCsv('id;name;address\nA;Renamed;10.0.0.9\n');
    expect(csv.columns).toEqual(['id', 'name', 'address']);
    const m = mergeMachines(current, csv.nodes, csv.columns);
    expect(m.changed).toHaveLength(1);
    expect(m.nodes[0]).toMatchObject({ name: 'Renamed', address: '10.0.0.9', group: 'G', tags: ['x'], mac: 'AA:BB:CC:DD:EE:FF', relay: true, localRoots: ['D:\\Data'], enabled: false, transport: 'path' });
    // a column that is there but empty does clear
    const cleared = machinesFromCsv('id;tags;relay\nA;;\n');
    expect(mergeMachines(current, cleared.nodes, cleared.columns).nodes[0]).not.toHaveProperty('tags');
  });
});

describe('saving the configuration file', () => {
  it('drops a tag, a MAC or the relay mark that was taken off, and keeps the old tool’s own keys', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'config.json');
    await fsp.writeFile(file, JSON.stringify({ schema: 2, menuTitle: 'Eski', nodes: [{ ...pathNode('A', 'C:\\a'), tags: ['x'], mac: 'AA:BB:CC:DD:EE:FF', relay: true, notes: 'n', legacyKey: 1 }] }));
    const cfg = await loadConfig(file);
    cfg.nodes[0] = { ...cfg.nodes[0], tags: undefined, mac: undefined, relay: undefined, notes: undefined };
    await saveConfigFile(file, cfg);
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
    expect(raw.menuTitle).toBe('Eski');
    expect(raw.nodes[0].legacyKey).toBe(1);
    for (const k of ['tags', 'mac', 'relay', 'notes']) expect(raw.nodes[0]).not.toHaveProperty(k);
  });
});

describe('the review', () => {
  it('warns when a source file was written a moment ago', async () => {
    const base = await tmpDir();
    const root = path.join(base, 'root');
    const tgt = path.join(base, 'T');
    await write(path.join(root, 'Data', 'old.txt'), 'eski', new Date(Date.now() - 3600_000));
    await fsp.mkdir(tgt);
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [root], path.join(base, 'ud'));
    const req: SendRequest = { sources: [{ kind: 'fs', path: path.join(root, 'Data') }], targetIds: ['T'], options: defaultOptions, origin: 'send' };
    expect((await buildSendPlan(ctx, req)).warnings.some((w) => /saniyede değişti|seconds/.test(w))).toBe(false);
    await write(path.join(root, 'Data', 'new.dll'), 'yeni');
    const w = (await buildSendPlan(ctx, req)).warnings.find((x) => /saniyede değişti|seconds/.test(x));
    expect(w).toContain('new.dll');
  });

  it('says what the filters leave out and which pattern did it', async () => {
    const base = await tmpDir();
    const root = path.join(base, 'root');
    for (const f of ['Data/a.txt', 'Data/a.pdb', 'Data/Logs/x.log', 'Data/sub/b.txt', 'Data/sub/c.pdb']) await write(path.join(root, ...f.split('/')), 'x');
    await write(path.join(root, 'Data', '.samsyncignore'), 'sub/b.txt\n');
    const ctx = makeCtx({ nodes: [] }, [root], path.join(base, 'ud'));
    const res = await filterPreview(ctx, { sources: [{ kind: 'fs', path: path.join(root, 'Data') }], targetIds: [], options: { ...defaultOptions, excludeFiles: ['*.pdb'], excludeDirs: ['Logs'] }, origin: 'send' });
    const by = Object.fromEntries(res.excluded.map((x) => [x.rel, `${x.pattern}:${x.from}`]));
    expect(by).toEqual({ 'a.pdb': '*.pdb:options', Logs: 'Logs:options', 'sub/c.pdb': '*.pdb:options', 'sub/b.txt': 'sub/b.txt:ignore', '.samsyncignore': '.samsyncignore:samsync' });
    expect(res).toMatchObject({ files: 1, dirs: 1, excludedDirs: 1, excludedFiles: 4, capped: false });
  });
});

describe('the start message', () => {
  it('says what goes where and from whom', () => {
    const m = startMessage('Sürüm', [{ key: 'A1', title: 'A1' }, { key: 'A2', title: 'A2' }, { key: 'X', title: 'X - 10.0.0.1' }], 2048, 7, { host: 'PC', user: 'PC\\ali' }, [
      { id: 'A1', group: 'Lab', enabled: true },
      { id: 'A2', group: 'Lab', enabled: true },
      { id: 'X', enabled: true },
    ]);
    expect(m.text.split('\n')).toEqual(['▶ Sürüm — başladı: 3 makine, 7 işlem, 2.0 KB', '→ Hedefler: Lab (2); X', 'Gönderen: PC\\ali']);
    expect(m.payload).toMatchObject({ event: 'run-start', bytes: 2048, ops: 7 });
  });
});

describe('waiting for a relay while paused', () => {
  it('does not count the pause against the time the relay has', async () => {
    const dir = await tmpDir();
    const tgt = new FsTransport(dir);
    const jobs = path.join(dir, RELAY_FOLDER, 'jobs');
    await fsp.mkdir(jobs, { recursive: true });
    await fsp.writeFile(path.join(jobs, 'j1.ack'), '{}');
    let paused = true;
    const started = Date.now();
    const wait = waitRelayResult(tgt, 'j1', { cancel: new CancelToken(), ackMs: 5000, doneMs: 600, paused: () => paused });
    const outcome = wait.then(
      () => 'result',
      (e: Error) => `${Date.now() - started}:${e.message}`,
    );
    await sleep(1500);
    paused = false;
    const r = await outcome;
    // without counting the pause out it would give up after 600 ms, in the middle of the pause
    expect(Number(r.split(":")[0])).toBeGreaterThan(1500);
  }, 20000);
});

describe('a pack whose source goes away before it is sent', () => {
  it('fails that machine instead of taking the app down', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'me', 'Data');
    const dirT = path.join(base, 't');
    await fsp.mkdir(src, { recursive: true });
    await fsp.mkdir(dirT, { recursive: true });
    for (let i = 0; i < 3; i++) await fsp.writeFile(path.join(src, `f${i}.bin`), crypto.randomBytes(200 * 1024));
    const nodes: NodeConfig[] = [{ ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] }, { ...pathNode('T', dirT), localRoots: [dirT] }];
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0, bandwidthMBps: 1 } }));
    const mk = async (id: string) => {
      const ud = path.join(base, `ud-${id}`);
      await fsp.mkdir(ud, { recursive: true });
      await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: id, agent: { receivePacks: true, notifyOnApply: false } }));
      const s = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: () => undefined });
      await s.init();
      return s;
    };
    const me = await mk('Me');
    const t = await mk('T');
    try {
      while (!fs.existsSync(path.join(dirT, RELAY_FOLDER, 'alive.json'))) await sleep(100);
      await t.relay!.heartbeat();
      const plan: SendPlan = await me.planSend({ sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send' }, 'p');
      expect(plan.targets[0].agent).toBe(true);
      await fsp.rm(path.join(src, 'f2.bin'));
      const id = await me.executePlan(plan.id, Object.fromEntries(plan.targets.map((tp) => [tp.targetId, tp.ops.filter((o) => o.selected).map((o) => o.id)])), { remember: false });
      let d: RunDetail | null = null;
      for (let i = 0; i < 200 && !d?.finishedAt; i++) {
        await sleep(100);
        d = await me.run(id);
      }
      expect(d?.targets[0].status).toBe('failed');
      expect(fs.readdirSync(path.join(dirT, RELAY_FOLDER, 'jobs')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    } finally {
      for (const s of [me, t]) {
        s.automation?.stop();
        s.relay?.stop();
        s.later.stop();
        s.pending.stop();
      }
    }
  }, 60000);
});

describe('a note on a run', () => {
  it('is kept in the list and in the run, and an empty one removes it', async () => {
    const { History } = await import('../src/core/history');
    const h = new History(await tmpDir());
    const run = { id: 'run-1', label: 'x', origin: 'send', startedAt: 1, finishedAt: 2, status: 'ok', dryRun: false, targets: [], opsTotal: 0, opsOk: 0, opsFailed: 0, bytes: 0, sources: [], targetIds: [], results: [], log: [] } as unknown as RunDetail;
    await h.save(run);
    await h.setNote('run-1', 'ders öncesi');
    expect((await h.list())[0].note).toBe('ders öncesi');
    expect((await h.get('run-1'))?.note).toBe('ders öncesi');
    // a new History reads it from disk
    await h.setNote('run-1', '');
    expect((await h.list())[0]).not.toHaveProperty('note');
    await expect(h.setNote('nope', 'x')).rejects.toThrow();
  });
});

describe('a run as an HTML report', () => {
  it('lists the machines with their result, the errors with a likely cause, the note, and escapes what it shows', async () => {
    const { writeRunHtml } = await import('../src/core/runreport');
    const dir = await tmpDir();
    const run = {
      id: 'run-2', label: 'Sürüm <3>', note: 'not & dikkat', origin: 'send', startedAt: 1_000_000, finishedAt: 1_060_000, status: 'partial', dryRun: false,
      targets: [
        { key: 'A', title: 'PC-A', root: '', total: 2, done: 2, failed: 0, bytesTotal: 10, bytesDone: 10, status: 'ok', startedAt: 1_000_000, finishedAt: 1_010_000 },
        { key: 'B', title: 'PC-B', root: '', total: 2, done: 2, failed: 2, bytesTotal: 10, bytesDone: 0, status: 'failed', error: 'EACCES: permission denied', startedAt: 1_000_000, finishedAt: 1_020_000 },
      ],
      opsTotal: 4, opsOk: 2, opsFailed: 2, bytes: 10, sources: ['D:\\Data'], targetIds: ['A', 'B'],
      results: [{ key: 'B', opId: '1', rel: 'a/<b>.txt', kind: 'copy', ok: false, error: 'EACCES: permission denied' }],
      log: [],
    } as unknown as RunDetail;
    const file = await writeRunHtml(run, dir, 'v1');
    const html = await fsp.readFile(file, 'utf8');
    // a name the file system takes: what it cannot hold becomes _
    expect(path.basename(file)).toMatch(/^rapor-[\d-]+-Sürüm _3_\.html$/);
    expect(html).toContain('Sürüm &lt;3&gt; — v1');
    expect(html).toContain('not &amp; dikkat');
    expect(html).toContain('a/&lt;b&gt;.txt');
    // a service started by an earlier test may have switched the language
    expect(html).toMatch(/class="hint">(Yazma izni yok|No permission to write)/);
    expect(html).toContain('PC-A');
    expect(html).not.toContain('<script');
  });
});

describe('folders that go away keep what the filter left out', () => {
  it('a mirror send removes the scanned items of an extra folder and leaves an excluded file, and the folder, in place', async () => {
    const base = await tmpDir();
    const root = path.join(base, 'root');
    const tgt = path.join(base, 'T');
    await write(path.join(root, 'Data', 'a.txt'), 'a');
    await write(path.join(tgt, 'Data', 'Old', 'x.txt'), 'x');
    await write(path.join(tgt, 'Data', 'Old', 'user.cfg'), 'mine');
    await write(path.join(tgt, 'Data', 'Gone', 'y.txt'), 'y');
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [root], path.join(base, 'ud'));
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: path.join(root, 'Data') }], targetIds: ['T'], options: { ...defaultOptions, mode: 'mirror', excludeFiles: ['*.cfg'] }, origin: 'send' });
    const { startRun } = await import('../src/core/executor');
    const groups = plan.targets.map((tp) => ({ key: tp.targetId, title: tp.targetName, rootLabel: tgt, open: async () => new FsTransport(tgt), ops: tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null, onlyIfEmpty: o.onlyIfEmpty })) }));
    const d = await startRun(ctx, groups, { label: 'm', origin: 'send', dryRun: false, backup: false, backupKeep: 0, backupFolderName: '_y', verify: false, retryCount: 0, waitSeconds: 0, parallelGroups: 1, parallelFiles: 2, postCommandTimeoutSeconds: 5, sources: [], targetIds: ['T'] }).done;
    expect(d.status).toBe('ok');
    expect(fs.existsSync(path.join(tgt, 'Data', 'Old', 'x.txt'))).toBe(false);
    expect(await fsp.readFile(path.join(tgt, 'Data', 'Old', 'user.cfg'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(tgt, 'Data', 'Gone'))).toBe(false);
    expect(d.log.some((l) => /yerinde kaldı|stayed/.test(l.message))).toBe(true);
  });

  it('a two-way sync does not take a folder away from the side that added a file to it', async () => {
    const { compareJob, syncExecSettings, syncGroups, updateDbAfterRun } = await import('../src/core/sync');
    const { startRun } = await import('../src/core/executor');
    const base = await tmpDir();
    const L = path.join(base, 'L');
    const R = path.join(base, 'R');
    await write(path.join(L, 'A', 'old.txt'), 'o', new Date(Date.now() - 3600_000));
    await write(path.join(R, 'A', 'old.txt'), 'o', new Date(Date.now() - 3600_000));
    const ctx = makeCtx({ nodes: [] }, [], path.join(base, 'ud'));
    const job = { id: 'j2', name: 'iki yön', pairs: [{ id: 'p1', left: { kind: 'local' as const, path: L }, right: { kind: 'local' as const, path: R } }], compare: 'timeSize' as const, variant: 'twoWay' as const, filter: { include: [], exclude: [] }, deletion: 'permanent' as const, versioningKeep: 5 };
    const sync = async () => {
      const cmp = await compareJob(ctx, job as never);
      const groups = syncGroups(ctx, job as never, cmp);
      const detail = await startRun(ctx, groups, syncExecSettings(ctx, job as never, 's', cmp, groups)).done;
      await updateDbAfterRun(ctx, job as never, cmp, detail);
      return detail;
    };
    await sync();
    // the right takes the folder away while the left adds a file to it
    await fsp.rm(path.join(R, 'A'), { recursive: true });
    await write(path.join(L, 'A', 'new.txt'), 'yeni');
    await sync();
    await sync();
    expect(await fsp.readFile(path.join(L, 'A', 'new.txt'), 'utf8')).toBe('yeni');
    expect(await fsp.readFile(path.join(R, 'A', 'new.txt'), 'utf8')).toBe('yeni');
    expect(fs.existsSync(path.join(L, 'A', 'old.txt'))).toBe(false);
  });
});

describe('a sync whose right side is gone', () => {
  it('refuses instead of deleting the left side', async () => {
    const { compareJob, syncExecSettings, syncGroups, updateDbAfterRun } = await import('../src/core/sync');
    const { startRun } = await import('../src/core/executor');
    const base = await tmpDir();
    const L = path.join(base, 'L');
    const R = path.join(base, 'R');
    await write(path.join(L, 'a.txt'), 'a');
    await write(path.join(L, 'sub', 'b.txt'), 'b');
    const ctx = makeCtx({ nodes: [] }, [], path.join(base, 'ud'));
    const job = { id: 'j3', name: 'yedek', pairs: [{ id: 'p1', left: { kind: 'local', path: L }, right: { kind: 'local', path: R } }], compare: 'timeSize', variant: 'twoWay', filter: { include: [], exclude: [] }, deletion: 'permanent', versioningKeep: 5 } as never;
    const sync = async () => {
      const cmp = await compareJob(ctx, job);
      const groups = syncGroups(ctx, job, cmp);
      const detail = await startRun(ctx, groups, syncExecSettings(ctx, job, 's', cmp, groups)).done;
      await updateDbAfterRun(ctx, job, cmp, detail);
      return cmp;
    };
    await sync();
    expect(await fsp.readFile(path.join(R, 'a.txt'), 'utf8')).toBe('a');
    // the drive is unplugged
    await fsp.rm(R, { recursive: true });
    const cmp = await sync();
    expect(cmp.pairs[0].error).toMatch(/Sağ klasör bulunamadı|Right folder not found/);
    expect(cmp.pairs[0].items).toEqual([]);
    expect(await fsp.readFile(path.join(L, 'a.txt'), 'utf8')).toBe('a');
    expect(await fsp.readFile(path.join(L, 'sub', 'b.txt'), 'utf8')).toBe('b');
  });
});

describe('undoing a run on a machine that kept no backup', () => {
  it('leaves the files the run replaced there, and still takes away the ones it created', async () => {
    const { startRun } = await import('../src/core/executor');
    const { restoreRunGroups } = await import('../src/core/backups');
    const base = await tmpDir();
    const root = path.join(base, 'root');
    const tgt = path.join(base, 'T');
    await write(path.join(root, 'Data', 'old.txt'), 'yeni', new Date(Date.now() - 60_000));
    await write(path.join(root, 'Data', 'add.txt'), 'eklendi', new Date(Date.now() - 60_000));
    await write(path.join(tgt, 'Data', 'old.txt'), 'eski', new Date(Date.now() - 3600_000));
    const ctx = makeCtx({ nodes: [pathNode('T', tgt)] }, [root], path.join(base, 'ud'));
    const plan = await buildSendPlan(ctx, { sources: [{ kind: 'fs', path: path.join(root, 'Data') }], targetIds: ['T'], options: { ...defaultOptions, backup: true }, origin: 'send' });
    const settings = { label: 'b', origin: 'send' as const, dryRun: false, backup: true, backupKeep: 5, backupFolderName: '_y', verify: false, retryCount: 0, waitSeconds: 0, parallelGroups: 1, parallelFiles: 2, postCommandTimeoutSeconds: 5, sources: [], targetIds: ['T'] };
    // this machine's own choice: no backup, whatever the run says
    const groups = plan.targets.map((tp) => ({ key: tp.targetId, title: tp.targetName, rootLabel: tgt, open: async () => new FsTransport(tgt), backup: false, ops: tp.ops.filter((o) => o.selected).map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, dstExists: o.dstMtime != null })) }));
    const run = await startRun(ctx, groups, settings).done;
    expect(await fsp.readFile(path.join(tgt, 'Data', 'old.txt'), 'utf8')).toBe('yeni');
    const undo = await restoreRunGroups(ctx, run);
    const ops = undo.flatMap((g) => g.ops);
    expect(ops.map((o) => `${o.kind}:${o.rel}`)).toEqual(['delete:Data/add.txt']);
  });
});

describe('sends set for later', () => {
  it('skip one cancelled while an earlier one was being sent', async () => {
    const { ScheduledSends } = await import('../src/core/scheduled');
    const dir = await tmpDir();
    const ran: string[] = [];
    let s!: InstanceType<typeof ScheduledSends>;
    let second = '';
    s = new ScheduledSends(path.join(dir, 's.json'), {
      run: async (item) => {
        ran.push(item.id);
        // the user cancels the next one while this one goes
        await s.remove(second);
      },
      wake: async () => undefined,
      changed: () => undefined,
    });
    const req = { sources: [], targetIds: ['A'], options: defaultOptions, origin: 'send' as const };
    await s.add(req, Date.now() + 1000, false);
    second = (await s.add(req, Date.now() + 2000, false)).id;
    await s.tick(Date.now() + 5000);
    expect(ran).toHaveLength(1);
    expect(s.list()).toEqual([]);
  });
});

describe('a git watch', () => {
  it('does not take a shortened reflog for new moves', async () => {
    const { ReflogWatcher } = await import('../src/core/gitwatch');
    const { execFileSync } = await import('node:child_process');
    const repo = await tmpDir();
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' }).toString();
    git('init', '-q');
    git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--allow-empty', '-qm', 'one');
    git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--allow-empty', '-qm', 'two');
    const moves: unknown[] = [];
    const w = new ReflogWatcher(repo, ['commit'] as never, (m) => moves.push(...m), 60_000);
    await w.start();
    try {
      // gc expires the reflog: only the last line is left
      const log = path.join(repo, '.git', 'logs', 'HEAD');
      const lines = (await fsp.readFile(log, 'utf8')).trim().split('\n');
      await fsp.writeFile(log, lines[lines.length - 1] + '\n');
      await w.read();
      expect(moves).toEqual([]);
    } finally {
      w.stop();
    }
  });
});

describe('a target manifest and the send’s exclusions', () => {
  it('is trusted only by a send that leaves out at least what the manifest’s send left out', async () => {
    const { saveManifestSubtree, manifestEntries, exclusionsOf } = await import('../src/core/manifest');
    const dir = await tmpDir();
    await write(path.join(dir, 'Bin', 'a.dll'), 'a');
    const tgt = new FsTransport(dir);
    const st = fs.statSync(path.join(dir, 'Bin', 'a.dll'));
    const entries = new Map([
      ['a.dll', { rel: 'a.dll', isDir: false, size: st.size, mtimeMs: st.mtimeMs }],
    ]);
    const pdbOut = exclusionsOf(['*.pdb'], []);
    expect(pdbOut).toEqual(['f:*.pdb']);
    await saveManifestSubtree(tgt, 'Bin', entries, {}, 'x', pdbOut);
    expect(await manifestEntries(tgt, 'Bin', Date.now(), 86400_000, pdbOut)).not.toBeNull();
    expect(await manifestEntries(tgt, 'Bin', Date.now(), 86400_000, exclusionsOf(['*.pdb'], ['Logs']))).not.toBeNull();
    // the next send takes the .pdb files too: the manifest does not know about them
    expect(await manifestEntries(tgt, 'Bin', Date.now(), 86400_000, exclusionsOf([], []))).toBeNull();
    // a manifest that does not say what it left out is not trusted by a send that asks
    await saveManifestSubtree(tgt, 'Bin', entries, {}, 'x');
    expect(await manifestEntries(tgt, 'Bin', Date.now(), 86400_000, pdbOut)).toBeNull();
    expect(await manifestEntries(tgt, 'Bin', Date.now(), 86400_000)).not.toBeNull();
  });
});

describe('a watch on a file that keeps changing', () => {
  it('sends after the longest wait, not only after a quiet moment that never comes', async () => {
    const { ChangeCollector } = await import('../src/core/automation');
    const batches: string[][] = [];
    const c = new ChangeCollector([], 150, (b) => batches.push(b), () => false, undefined, 400);
    const until = Date.now() + 900;
    while (Date.now() < until) {
      c.touch(path.join('C:\\w', 'log.txt'));
      await sleep(50);
    }
    c.stop();
    expect(batches.length).toBeGreaterThanOrEqual(1);
  });
});
