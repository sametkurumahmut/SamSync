import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Service } from '../src/core/service';
import { normalizeConfig } from '../src/core/config';
import { expandTargetIds } from '../src/core/context';
import { busyPrograms } from '../src/core/processes';
import { ScheduledSends } from '../src/core/scheduled';
import type { AgentSettings, NodeConfig, RunDetail, SendPlan, SendRequest, ScheduledSend } from '../src/shared/types';
import { tmpDir, write, read, pathNode, defaultOptions, sleep } from './helpers';

// never restart or shut this computer down from a test
const power = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../src/core/power', () => ({ powerAction: async (...a: unknown[]) => void power.calls.push(a) }));

async function until<T>(fn: () => T | Promise<T>, ms = 20000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    await sleep(100);
  }
  throw new Error('zaman aşımı');
}

type Id = 'Me' | 'T' | 'PC1' | 'PC2';
interface World {
  base: string;
  src: string;
  dir: Record<Exclude<Id, 'Me'>, string>;
  svc: Partial<Record<Id, Service>>;
  me: Service;
  stop: () => void;
}

/** A sender ("Me") and a group G of T, PC1, PC2; the ones in \`running\` run SamSync of their own. */
async function world(opts: { running?: Exclude<Id, 'Me'>[]; copy?: Record<string, unknown>; agent?: Partial<Record<Id, Partial<AgentSettings>>>; extra?: Partial<Record<Id, Partial<NodeConfig>>> } = {}): Promise<World> {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const dir = { T: path.join(base, 't'), PC1: path.join(base, 'pc1'), PC2: path.join(base, 'pc2') };
  for (const d of [src, ...Object.values(dir)]) await fsp.mkdir(d, { recursive: true });
  const running = new Set(opts.running ?? []);
  const nodes: NodeConfig[] = [
    { ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] },
    ...(['T', 'PC1', 'PC2'] as const).map((id) => ({ ...pathNode(id, dir[id], { group: 'G', ...opts.extra?.[id] }), localRoots: running.has(id) ? [dir[id]] : [] })),
  ];
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0, ...opts.copy } }));
  const side = async (id: Id) => {
    const ud = path.join(base, `ud-${id}`);
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: id, agent: { receivePacks: true, notifyOnApply: false, ...opts.agent?.[id] } }));
    const svc = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    return svc;
  };
  const svc: World['svc'] = { Me: await side('Me') };
  for (const id of running) svc[id] = await side(id);
  for (const id of running) await until(() => fs.existsSync(path.join(dir[id], '_SamSyncRelay', 'alive.json')));
  const stop = () => {
    for (const s of Object.values(svc)) {
      s!.automation?.stop();
      s!.relay?.stop();
      s!.later.stop();
      s!.pending.stop();
    }
  };
  return { base, src, dir, svc, me: svc.Me!, stop };
}

const req = (w: World, targetIds: string[], options: Partial<SendRequest['options']> = {}): SendRequest => ({ sources: [{ kind: 'fs', path: w.src }], targetIds, options: { ...defaultOptions, propagateDeletes: false, ...options }, origin: 'send', label: 'deneme' });
const selectedOf = (plan: SendPlan) => Object.fromEntries(plan.targets.map((tp) => [tp.targetId, tp.ops.filter((o) => o.selected).map((o) => o.id)]));
const finished = (w: World, id: string): Promise<RunDetail> =>
  until(async () => {
    const d = await w.me.run(id);
    return d?.finishedAt ? d : null;
  });
async function send(w: World, r: SendRequest) {
  const plan = await w.me.planSend(r, `p${Math.random()}`);
  return { plan, run: await finished(w, await w.me.executePlan(plan.id, selectedOf(plan), { remember: false })) };
}

describe('tags', () => {
  it('are kept tidy in the configuration and pick their machines as tag:<name>', () => {
    const cfg = normalizeConfig({
      schema: 2,
      nodes: [
        { ...pathNode('A', 'C:\\a'), tags: ['Ses Sistemi', 'proj', 'geçersiz!'] },
        { ...pathNode('B', 'C:\\b'), tags: ['proj'] },
        pathNode('C', 'C:\\c'),
      ],
    } as never);
    expect(cfg.nodes[0].tags).toEqual(['Ses-Sistemi', 'proj']);
    expect(expandTargetIds(cfg, ['tag:PROJ']).map((n) => n.id)).toEqual(['A', 'B']);
    expect(expandTargetIds(cfg, ['tag:ses-sistemi', 'C']).map((n) => n.id)).toEqual(['A', 'C']);
  });
});

describe('send queue', () => {
  it('starts a send to machines another run writes to once that run ends', async () => {
    const w = await world({ copy: { queueSends: true } });
    try {
      for (let i = 0; i < 40; i++) await write(path.join(w.src, `f${i}.txt`), 'x'.repeat(2000));
      const p1 = await w.me.planSend(req(w, ['PC2']), 'a');
      const p2 = await w.me.planSend(req(w, ['PC2', 'PC1']), 'b');
      const id1 = await w.me.executePlan(p1.id, selectedOf(p1), { remember: false });
      const id2 = await w.me.executePlan(p2.id, selectedOf(p2), { remember: false });
      const [r1, r2] = await Promise.all([finished(w, id1), finished(w, id2)]);
      expect(r2.log.some((l) => /Sırada|Queued/.test(l.message))).toBe(true);
      expect(Math.min(...r2.targets.map((x) => x.startedAt ?? Infinity))).toBeGreaterThanOrEqual(r1.finishedAt!);
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('busy machines', () => {
  it('counts programs started from inside the folder or named in the list', () => {
    const procs = [
      { pid: 11, name: 'app.exe', path: 'C:\\Release\\bin\\app.exe' },
      { pid: 12, name: 'other.exe', path: 'C:\\Programs\\other.exe' },
      { pid: 13, name: 'Viewer.exe', path: 'D:\\x\\Viewer.exe' },
      { pid: 14, name: 'release.exe', path: 'C:\\Releases\\release.exe' },
    ];
    expect(busyPrograms(procs, 'C:\\Release').map((p) => p.pid)).toEqual(process.platform === 'win32' ? [11] : []);
    expect(busyPrograms(procs, 'C:\\Release', ['viewer.EXE']).map((p) => p.pid)).toEqual(process.platform === 'win32' ? [11, 13] : [13]);
  });

  it('show on the card and in the review, and a machine that asks for it waits until the program closes', async () => {
    const w = await world({ running: ['PC1'], agent: { PC1: { holdWhileBusy: true } } });
    // a program started from inside the machine's folder (a copy of this very runtime)
    const exe = path.join(w.dir.PC1, 'bin', path.basename(process.execPath));
    await fsp.mkdir(path.dirname(exe), { recursive: true });
    await fsp.copyFile(process.execPath, exe);
    const child = spawn(exe, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    try {
      await until(async () => (await w.svc.PC1!.relay!.checkBusy()).some((p) => p.pid === child.pid));
      await w.svc.PC1!.relay!.heartbeat();
      const [p] = await w.me.probe(['PC1']);
      expect(p.agent?.busyBy?.some((x) => x.pid === child.pid)).toBe(true);
      expect(p.agent?.holdWhileBusy).toBe(true);
      await write(path.join(w.src, 'a.txt'), 'A');
      const { plan, run } = await send(w, req(w, ['PC1']));
      expect(plan.targets[0]).toMatchObject({ held: true });
      expect(plan.targets[0].busyBy).toContain(path.basename(exe));
      expect(run.targets[0].status).toBe('failed');
      expect(read(path.join(w.dir.PC1, 'Data', 'a.txt'))).toBeNull();
      expect(w.me.pending.list()).toHaveLength(1);
      // the program closes: the waiting send goes
      child.kill();
      await until(async () => !(await w.svc.PC1!.relay!.checkBusy()).length);
      await w.svc.PC1!.relay!.heartbeat();
      await w.me.pending.tick();
      await until(() => read(path.join(w.dir.PC1, 'Data', 'a.txt')) === 'A');
      expect(w.me.pending.list()).toHaveLength(0);
    } finally {
      child.kill();
      w.stop();
    }
  }, 60000);
});

describe('send later', () => {
  it('wakes a few minutes before and runs at its time', async () => {
    const dir = await tmpDir();
    const ran: string[] = [];
    const woke: string[] = [];
    const s = new ScheduledSends(path.join(dir, 's.json'), { run: async (i) => void ran.push(i.id), wake: async (i) => void woke.push(i.id), changed: () => undefined });
    const at = Date.now() + 3600_000;
    const item: ScheduledSend = await s.add({ sources: [], targetIds: ['A'], options: defaultOptions, origin: 'send' }, at, true);
    await s.tick(at - 10 * 60_000);
    expect([woke, ran]).toEqual([[], []]);
    await s.tick(at - 4 * 60_000);
    expect([woke, ran]).toEqual([[item.id], []]);
    await s.tick(at + 1);
    expect([woke, ran]).toEqual([[item.id], [item.id]]);
    expect(s.list()).toEqual([]);
    // kept across a restart
    await s.add({ sources: [], targetIds: ['A'], options: defaultOptions, origin: 'send' }, at, false);
    const again = new ScheduledSends(path.join(dir, 's.json'), { run: async () => undefined, wake: async () => undefined, changed: () => undefined });
    await again.load();
    expect(again.list()).toHaveLength(1);
  });

  it('plans the send again at its time, with the sources as they are then', async () => {
    const w = await world();
    try {
      await write(path.join(w.src, 'a.txt'), 'önce');
      const plan = await w.me.planSend(req(w, ['PC2']), 'p');
      await expect(w.me.scheduleSend(plan.id, Date.now() - 1000, false)).rejects.toThrow();
      const item = await w.me.scheduleSend(plan.id, Date.now() + 60_000, false);
      expect((await w.me.scheduledSends()).map((x) => x.id)).toEqual([item.id]);
      await write(path.join(w.src, 'a.txt'), 'o saatte');
      await w.me.later.tick(Date.now() + 61_000);
      await until(() => read(path.join(w.dir.PC2, 'Data', 'a.txt')) === 'o saatte');
      expect(await w.me.scheduledSends()).toEqual([]);
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('remote restart and shutdown', () => {
  it('go only to a machine that allows them, from its card or after a send', async () => {
    const w = await world({ running: ['PC1', 'PC2'], agent: { PC1: { allowPower: true } } });
    try {
      power.calls.length = 0;
      const [p1, p2] = await w.me.probe(['PC1', 'PC2']);
      expect(p1.agent?.power).toBe(true);
      expect(p2.agent?.power).toBeUndefined();
      expect(await w.me.power(['PC1'], 'restart')).toEqual([{ nodeId: 'PC1', ok: true }]);
      const refused = await w.me.power(['PC2'], 'shutdown');
      expect(refused[0].ok).toBe(false);
      expect(power.calls.map((c) => c[0])).toEqual(['restart']);
      await write(path.join(w.src, 'a.txt'), 'A');
      await send(w, req(w, ['PC1'], { powerAfter: 'shutdown' }));
      await until(() => power.calls.length === 2);
      expect(power.calls[1][0]).toBe('shutdown');
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('distributing from a machine', () => {
  it('has SamSync there send its own folders to the others, nothing from here', async () => {
    const w = await world({ running: ['PC1'] });
    try {
      await write(path.join(w.src, 'a.txt'), 'A');
      await write(path.join(w.src, 'sub', 'b.txt'), 'B');
      await send(w, req(w, ['PC1']));
      expect((await w.me.machineFolders('PC1')).map((f) => [f.rel, f.files])).toEqual([['Data', 2]]);
      // this computer's copy changes; the machines get what PC1 holds
      await write(path.join(w.src, 'a.txt'), 'yalnız burada');
      const run = await finished(w, await w.me.distributeFrom('PC1', ['Data'], ['PC2', 'T'], 'overwrite'));
      expect(run.status).toBe('ok');
      for (const d of [w.dir.PC2, w.dir.T]) {
        expect(read(path.join(d, 'Data', 'a.txt'))).toBe('A');
        expect(read(path.join(d, 'Data', 'sub', 'b.txt'))).toBe('B');
      }
      expect(run.targets.map((x) => [x.key, x.via ?? '-'])).toEqual([
        ['PC1', '-'],
        ['PC2', 'PC1'],
        ['T', 'PC1'],
      ]);
      await expect(w.me.distributeFrom('PC2', ['Data'], ['T'], 'overwrite')).rejects.toThrow();
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('machine timeline', () => {
  it('lists the runs that reached a machine, newest first, with their release points', async () => {
    const w = await world();
    try {
      await write(path.join(w.src, 'a.txt'), 'A');
      const first = await send(w, req(w, ['PC2']));
      await w.me.saveSettings({ releaseTags: [{ runId: first.run.id, name: 'v1', at: Date.now() }] });
      await write(path.join(w.src, 'b.txt'), 'B');
      await send(w, { ...req(w, ['PC2', 'PC1']), label: 'ikinci' });
      const tl = await w.me.machineTimeline('PC2');
      expect(tl.map((x) => [x.label, x.status, x.release ?? '-'])).toEqual([
        ['ikinci', 'ok', '-'],
        ['deneme', 'ok', 'v1'],
      ]);
      expect((await w.me.machineTimeline('PC1')).length).toBe(1);
    } finally {
      w.stop();
    }
  }, 60000);
});
