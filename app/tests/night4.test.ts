import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import { normalizeConfig } from '../src/core/config';
import { machinesFromCsv, machinesToCsv, mergeMachines } from '../src/shared/machinecsv';
import { lastMondayNine, weeklyMessage } from '../src/core/weekly';
import { lowOnSpace } from '../src/shared/machine';
import type { NodeConfig, ProbeResult, RunDetail, RunSummary, SendPlan, SendRequest } from '../src/shared/types';
import { tmpDir, write, read, pathNode, defaultOptions, sleep } from './helpers';

async function until<T>(fn: () => T | Promise<T>, ms = 20000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    await sleep(100);
  }
  throw new Error('zaman aşımı');
}

describe('machines as CSV', () => {
  const nodes: NodeConfig[] = [
    { ...pathNode('A', 'C:\\a'), name: 'Room; one', group: 'G', tags: ['x', 'y'], mac: 'AA:BB:CC:DD:EE:FF', relay: true },
    { id: 'B', name: 'B "quoted"', address: '10.0.0.2', localRoots: ['D:\\Data', 'E:\\More'], networkRoot: 'Data', enabled: false, transport: 'smb' },
  ];

  it('goes to a file and comes back the same (quotes, separators and lists inside cells)', () => {
    const text = machinesToCsv(nodes);
    expect(text.startsWith('\uFEFFid;name;')).toBe(true);
    const back = machinesFromCsv(text);
    expect(back.errors).toEqual([]);
    expect(back.nodes[0]).toMatchObject({ id: 'A', name: 'Room; one', group: 'G', tags: ['x', 'y'], mac: 'AA:BB:CC:DD:EE:FF', relay: true, transport: 'path', path: 'C:\\a' });
    expect(back.nodes[1]).toMatchObject({ id: 'B', name: 'B "quoted"', localRoots: ['D:\\Data', 'E:\\More'], enabled: false, transport: 'smb' });
  });

  it('reads a file with commas and its own column order, and reports rows without an id', () => {
    const r = machinesFromCsv('name,id,address,tags\nFirst,N1,10.1.1.1,a|b\nNo id,,10.1.1.2,\n');
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]).toMatchObject({ id: 'N1', name: 'First', address: '10.1.1.1', tags: ['a', 'b'], enabled: true, transport: 'smb' });
    expect(r.errors).toHaveLength(1);
    expect(machinesFromCsv('name;address\nX;1').errors).toEqual(['no id column']);
  });

  it('adds new machines, changes the ones it names, and keeps what a file cannot say', () => {
    const current: NodeConfig[] = [
      { ...nodes[0], color: '#f00', notes: 'kept' },
      { ...nodes[1] },
      { ...pathNode('C', 'C:\\c') },
    ];
    const incoming = machinesFromCsv(machinesToCsv([{ ...nodes[0], name: 'Renamed' }, nodes[1], pathNode('D', 'C:\\d')])).nodes;
    const m = mergeMachines(current, incoming);
    expect(m.added.map((n) => n.id)).toEqual(['D']);
    expect(m.changed.map((n) => n.id)).toEqual(['A']);
    expect(m.same).toBe(1);
    expect(m.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(m.nodes[0]).toMatchObject({ name: 'Renamed', color: '#f00', notes: 'kept' });
  });
});

describe('weekly summary', () => {
  it('goes out on Monday 09:00 local time, for the week before', () => {
    const wed = new Date(2026, 9, 21, 15, 0); // a Wednesday
    expect(new Date(lastMondayNine(wed))).toEqual(new Date(2026, 9, 19, 9, 0));
    // Monday before nine: still the Monday before
    expect(new Date(lastMondayNine(new Date(2026, 9, 19, 8, 59)))).toEqual(new Date(2026, 9, 12, 9, 0));
    expect(new Date(lastMondayNine(new Date(2026, 9, 19, 9, 0)))).toEqual(new Date(2026, 9, 19, 9, 0));
    expect(new Date(lastMondayNine(new Date(2026, 9, 25, 23, 0)))).toEqual(new Date(2026, 9, 19, 9, 0)); // Sunday
  });

  it('counts the sends of the last seven days, the machines that failed and the ones away', () => {
    const now = Date.now();
    const run = (over: Partial<RunSummary>): RunSummary =>
      ({ id: Math.random().toString(), origin: 'send', startedAt: now - 3600_000, status: 'ok', dryRun: false, bytes: 1024, targets: [], ...over }) as RunSummary;
    const runs = [
      run({}),
      run({ status: 'failed', targets: [{ key: 'B', title: 'B', status: 'failed' }] as never }),
      run({ status: 'partial', targets: [{ key: 'B', title: 'B', status: 'partial' }, { key: 'C', title: 'C', status: 'failed' }] as never }),
      run({ startedAt: now - 8 * 86400_000, status: 'failed' }), // older than a week
      run({ dryRun: true }),
      run({ origin: 'restore' as never }),
    ];
    const probes = [{ nodeId: 'C', ok: false } as ProbeResult, { nodeId: 'D', ok: true } as ProbeResult];
    const drift = [{ nodeId: 'D', name: 'D', changed: 2, added: 0, removed: 0 }] as never;
    const m = weeklyMessage(runs, probes, new Map([['C', 'Machine C']]), drift, { host: 'pc', user: 'me', version: '9.9.9' }, now);
    expect(m.payload).toMatchObject({ kind: 'weekly', sends: 3, ok: 1, failed: 1, partial: 1, bytes: 3072, failures: { B: 2, C: 1 }, away: ['Machine C'], drift: ['D'] });
    expect(m.text).toContain('B (2)');
    expect(m.text).toContain('Machine C');
    expect(m.text).toContain('9.9.9');
  });
});

describe('free space limit', () => {
  it('is 2 GB unless set, and 0 turns it off', () => {
    expect(lowOnSpace(1024 ** 3, undefined)).toBe(true);
    expect(lowOnSpace(3 * 1024 ** 3, undefined)).toBe(false);
    expect(lowOnSpace(3 * 1024 ** 3, 5)).toBe(true);
    expect(lowOnSpace(1, 0)).toBe(false);
    expect(lowOnSpace(undefined, 5)).toBe(false);
    expect(normalizeConfig({ schema: 2, nodes: [], copy: { minFreeGB: -3 } } as never).copy.minFreeGB).toBe(0);
    expect(normalizeConfig({ schema: 2, nodes: [], copy: {} } as never).copy.minFreeGB).toBeUndefined();
  });
});

async function service(base: string, copy: Record<string, unknown> = {}) {
  const src = path.join(base, 'me', 'Data');
  const tgt = path.join(base, 'pc1');
  await fsp.mkdir(src, { recursive: true });
  await fsp.mkdir(tgt, { recursive: true });
  const nodes = [{ ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] }, pathNode('PC1', tgt)];
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0, ...copy } }));
  const ud = path.join(base, 'ud');
  await fsp.mkdir(ud, { recursive: true });
  await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
  const svc = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: () => undefined });
  await svc.init();
  const stop = () => {
    svc.automation?.stop();
    svc.relay?.stop();
    svc.later.stop();
    svc.pending.stop();
  };
  return { svc, src, tgt, ud, stop };
}

const selectedOf = (plan: SendPlan) => Object.fromEntries(plan.targets.map((tp) => [tp.targetId, tp.ops.filter((o) => o.selected).map((o) => o.id)]));

describe('failed machines tried again', () => {
  it('schedules the machines a send failed on, numbered, until the limit, and stops once they take it', async () => {
    const w = await service(await tmpDir(), { retryFailedMinutes: 5, retryFailedTimes: 2 });
    try {
      await write(path.join(w.src, 'a.txt'), 'bir');
      const r: SendRequest = { sources: [{ kind: 'fs', path: w.src }], targetIds: ['PC1'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'deneme' };
      const plan = await w.svc.planSend(r, 'p');
      // the target's folder turns into a file: every write fails
      await fsp.rm(w.tgt, { recursive: true });
      await fsp.writeFile(w.tgt, 'not a folder');
      const id = await w.svc.executePlan(plan.id, selectedOf(plan), { remember: false });
      const d = await until(async () => {
        const x: RunDetail | null = await w.svc.run(id);
        return x?.finishedAt ? x : null;
      });
      expect(d.targets[0].status).toBe('failed');
      const [first] = await until(async () => {
        const l = await w.svc.scheduledSends();
        return l.length ? l : null;
      });
      expect(first.request).toMatchObject({ targetIds: ['PC1'], attempt: 1, retryLabel: 'deneme' });
      expect(first.label).toContain('1/2');
      expect(first.at).toBeGreaterThan(Date.now() + 4 * 60_000);
      // fixed before the next try: the files arrive and nothing more is scheduled
      await fsp.rm(w.tgt);
      await fsp.mkdir(w.tgt);
      await w.svc.later.tick(Date.now() + 6 * 60_000);
      await until(() => read(path.join(w.tgt, 'Data', 'a.txt')) === 'bir');
      await sleep(500);
      expect(await w.svc.scheduledSends()).toEqual([]);
    } finally {
      w.stop();
    }
  }, 60000);

  it('is off unless set', async () => {
    const w = await service(await tmpDir());
    try {
      await write(path.join(w.src, 'a.txt'), 'bir');
      const plan = await w.svc.planSend({ sources: [{ kind: 'fs', path: w.src }], targetIds: ['PC1'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send' }, 'p');
      await fsp.rm(w.tgt, { recursive: true });
      await fsp.writeFile(w.tgt, 'x');
      const id = await w.svc.executePlan(plan.id, selectedOf(plan), { remember: false });
      await until(async () => (await w.svc.run(id))?.finishedAt);
      await sleep(300);
      expect(await w.svc.scheduledSends()).toEqual([]);
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('last seen', () => {
  it('remembers when a machine last answered, across a restart, and shows it while it is away', async () => {
    const base = await tmpDir();
    const w = await service(base);
    try {
      const [on] = await w.svc.probe(['PC1']);
      expect(on.ok).toBe(true);
      expect(fs.existsSync(path.join(w.ud, 'last-seen.json'))).toBe(true);
      await fsp.rm(w.tgt, { recursive: true });
      const [off] = await w.svc.probe(['PC1']);
      expect(off.ok).toBe(false);
      expect(off.lastSeenAt).toBe(on.checkedAt);
    } finally {
      w.stop();
    }
    const again = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: w.ud, initialPaths: [], emit: () => undefined });
    await again.init();
    try {
      const [off] = await again.probe(['PC1']);
      expect(off.lastSeenAt).toBeGreaterThan(0);
    } finally {
      again.automation?.stop();
      again.relay?.stop();
      again.later.stop();
      again.pending.stop();
    }
  }, 60000);
});
