import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { ChangeCollector, changesToSources, nextRun } from '../src/core/automation';
import { makeFilter } from '../src/core/filter';
import { Service } from '../src/core/service';
import type { AppEvent, SyncSchedule } from '../src/shared/types';
import { tmpDir, write, read, pathNode, defaultOptions, sleep } from './helpers';

async function until(fn: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error('zaman aşımı');
}

describe('change collection', () => {
  it('reports a burst of changes once, after the quiet period', async () => {
    const batches: string[][] = [];
    const c = new ChangeCollector([], 80, (b) => batches.push(b));
    c.touch('C:/x/a.txt', false);
    c.touch('C:/x/b.txt');
    await sleep(30);
    c.touch('C:/x/a.txt');
    c.touch('C:/x/.git/index');
    c.touch('C:/x/~$doc.docx');
    expect(batches).toHaveLength(0);
    await sleep(150);
    expect(batches).toEqual([['C:/x/a.txt', 'C:/x/b.txt']]);
  });

  it('turns changed paths into sources, honouring excludes and deletions', async () => {
    const root = await tmpDir();
    await write(path.join(root, 'keep.txt'), 'k');
    await write(path.join(root, 'skip.pdb'), 'p');
    await write(path.join(root, 'Logs', 'l.txt'), 'l');
    await write(path.join(root, 'newdir', 'inner.txt'), 'i');
    const filter = makeFilter({ excludeFiles: ['*.pdb'], excludeDirs: ['Logs'] });
    const changed = ['keep.txt', 'skip.pdb', 'Logs/l.txt', 'gone.txt', 'newdir', 'newdir/inner.txt'].map((p) => path.join(root, p));
    const withDel = await changesToSources(changed, [root], filter, true);
    expect(withDel.map((s) => `${s.kind}:${path.basename(s.path)}`).sort()).toEqual(['delete:gone.txt', 'fs:keep.txt', 'fs:newdir']);
    const noDel = await changesToSources(changed, [root], filter, false);
    expect(noDel.some((s) => s.kind === 'delete')).toBe(false);
    // a folder that only reported "content changed" is not sent as a whole
    const contentOnly = await changesToSources([path.join(root, 'newdir')], [root], filter, false, new Set([path.join(root, 'newdir')]));
    expect(contentOnly).toEqual([]);
  });
});

describe('schedules', () => {
  const base: SyncSchedule = { enabled: true, mode: 'interval', everyMinutes: 30, times: [], notify: 'errors' };
  it('runs intervals from the last run, or from app start', () => {
    expect(nextRun(base, 1_000_000, 0)).toBe(1_000_000 + 30 * 60_000);
    expect(nextRun(base, undefined, 5_000)).toBe(5_000 + 30 * 60_000);
  });
  it('picks the next clock time and catches up a slot missed today', () => {
    const now = new Date(2026, 9, 15, 10, 0, 0).getTime();
    const s: SyncSchedule = { ...base, mode: 'times', times: ['09:00', '18:30'] };
    // ran yesterday evening, app started at 08:00 today: the 09:00 slot was missed -> due now
    const missed = nextRun(s, new Date(2026, 9, 14, 18, 30).getTime(), new Date(2026, 9, 15, 8, 0).getTime(), now);
    expect(missed).toBe(new Date(2026, 9, 15, 9, 0).getTime());
    // already ran at 09:00 -> next is 18:30
    const next = nextRun(s, new Date(2026, 9, 15, 9, 0, 5).getTime(), new Date(2026, 9, 15, 8, 0).getTime(), now);
    expect(next).toBe(new Date(2026, 9, 15, 18, 30).getTime());
  });
});

describe('scheduled sync (end to end)', () => {
  it('runs a scheduled mirror job only on its machine and records the result', async () => {
    const base = await tmpDir();
    const left = path.join(base, 'left');
    const right = path.join(base, 'right');
    const ud = path.join(base, 'ud');
    await write(path.join(left, 'x.txt'), 'x');
    await write(path.join(right, 'old.txt'), 'old');
    await fsp.mkdir(ud, { recursive: true });
    const job = {
      id: 'j1',
      name: 'Gece',
      pairs: [{ id: 'p1', left: { kind: 'local', path: left }, right: { kind: 'node', nodeId: 'R', subPath: '' } }],
      compare: 'timeSize',
      variant: 'mirror',
      filter: { include: [], exclude: [] },
      deletion: 'versioning',
      versioningKeep: 3,
      schedule: { enabled: true, mode: 'interval', everyMinutes: 60, times: [], machineId: 'Me', notify: 'errors' },
    };
    const other = { ...job, id: 'j2', name: 'Başka makine', schedule: { ...job.schedule, machineId: 'R' } };
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [pathNode('Me', path.join(base, 'me')), pathNode('R', right)], syncJobs: [job, other] }));
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    try {
      const before = (await svc.automationState()).schedules;
      expect(before.find((s) => s.jobId === 'j1')).toMatchObject({ activeHere: true, running: false });
      expect(before.find((s) => s.jobId === 'j2')?.activeHere).toBe(false);
      await svc.automation!.runSchedule(svc.config.syncJobs[0]);
      const after = (await svc.automationState()).schedules.find((s) => s.jobId === 'j1')!;
      // runSchedule resolves when the run is done
      expect(after.lastStatus).toBe('ok');
      expect(read(path.join(right, 'x.txt'))).toBe('x');
      expect(fs.existsSync(path.join(right, 'old.txt'))).toBe(false);
      expect(after.nextAt).toBeGreaterThan(Date.now() + 59 * 60_000);
      // nothing left to do on the next run
      await svc.automation!.runSchedule(svc.config.syncJobs[0]);
      expect((await svc.automationState()).schedules.find((s) => s.jobId === 'j1')?.lastStatus).toBe('nothing');
    } finally {
      svc.automation?.stop();
    }
  });
});

describe('watch → automatic send (end to end)', () => {
  it('sends a changed file to the targets without any user action', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'src');
    const tgt = path.join(base, 't1');
    const ud = path.join(base, 'ud');
    await fsp.mkdir(path.join(src, 'Data'), { recursive: true });
    await fsp.mkdir(tgt, { recursive: true });
    await fsp.mkdir(ud, { recursive: true });
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(
      cfgFile,
      JSON.stringify({ schema: 2, nodes: [{ ...pathNode('Me', path.join(base, 'me')), localRoots: [src], transport: 'path' }, pathNode('T1', tgt)] }),
    );
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const events: AppEvent[] = [];
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: (e) => events.push(e) });
    await svc.init();
    try {
      await svc.watchAdd({ name: 'Data', paths: [path.join(src, 'Data')], targetIds: ['T1'], options: { ...defaultOptions, notify: false }, quietMs: 150, enabled: true });
      expect((await svc.automationState()).watches[0].status).toBe('watching');
      await sleep(100);
      await write(path.join(src, 'Data', 'a.entity'), 'v1');
      await until(() => read(path.join(tgt, 'Data', 'a.entity')) === 'v1');
      await write(path.join(src, 'Data', 'a.entity'), 'v2 longer');
      await until(() => read(path.join(tgt, 'Data', 'a.entity')) === 'v2 longer');
      await until(async () => ((await svc.automationState()).watches[0].runs ?? 0) >= 2);
      const st = (await svc.automationState()).watches[0];
      expect(st.lastStatus).toBe('ok');
      expect(events.some((e) => e.type === 'automation')).toBe(true);
      // the runs land in history like manual sends (written just after the run ends, so wait for it)
      await until(async () => (await svc.runs()).length >= 2);
      // pausing stops watching
      await svc.automationPause(true);
      expect((await svc.automationState()).watches[0].status).toBe('paused');
      await write(path.join(src, 'Data', 'b.entity'), 'not sent');
      await sleep(500);
      expect(fs.existsSync(path.join(tgt, 'Data', 'b.entity'))).toBe(false);
    } finally {
      svc.automation?.stop();
    }
  });
});

describe('clock-time schedules without catching up', () => {
  const s = { enabled: true, mode: 'times' as const, everyMinutes: 60, times: ['09:00'], notify: 'errors' as const };
  it('run when their time comes and skip one missed for long', () => {
    const since = new Date(2026, 9, 15, 8, 0).getTime();
    // the check comes a few seconds after nine: due
    expect(nextRun(s, undefined, since, new Date(2026, 9, 15, 9, 0, 20).getTime(), false)).toBe(new Date(2026, 9, 15, 9, 0).getTime());
    // three hours later (the computer slept): skipped, tomorrow it is
    expect(nextRun(s, undefined, since, new Date(2026, 9, 15, 12, 0).getTime(), false)).toBe(new Date(2026, 9, 16, 9, 0).getTime());
  });
  it('with catching up, also run a slot that passed while the app was closed', () => {
    const last = new Date(2026, 9, 14, 9, 0, 5).getTime();
    const since = new Date(2026, 9, 15, 10, 0).getTime();
    expect(nextRun(s, last, since, new Date(2026, 9, 15, 10, 1).getTime(), true)).toBe(new Date(2026, 9, 15, 9, 0).getTime());
  });
});
