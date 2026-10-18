import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import { relayRouting } from '../src/shared/relay';
import type { NodeConfig, SendRequest } from '../src/shared/types';
import { tmpDir, write, read, pathNode, defaultOptions, sleep } from './helpers';

async function until(fn: () => boolean | Promise<boolean>, ms = 15000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error('zaman aşımı');
}

describe('relay routing', () => {
  it('sends the group through its relay only when the relay is chosen too', () => {
    const T = pathNode('T', 'x', { group: 'G', relay: true });
    const PC1 = pathNode('PC1', 'y', { group: 'G' });
    const PC2 = pathNode('PC2', 'z', { group: 'G' });
    const Other = pathNode('O', 'o', { group: 'H' });
    const r = relayRouting([T, PC1, PC2, Other]);
    expect(r.direct.map((n) => n.id)).toEqual(['T', 'O']);
    expect([...r.via.entries()].map(([k, v]) => [k, v.map((n) => n.id)])).toEqual([['T', ['PC1', 'PC2']]]);
    // one PC alone: straight to it, the relay is not touched
    expect(relayRouting([PC1]).direct.map((n) => n.id)).toEqual(['PC1']);
    expect(relayRouting([PC1]).via.size).toBe(0);
  });
});

interface Side {
  svc: Service;
  base: string;
}

/** A sender ("Me") and a relay ("T") in one process, sharing one configuration; the IGs are plain folders. */
async function setup(opts: { relayRunning: boolean; ackSeconds?: number }) {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const server = path.join(base, 'server');
  const pc1 = path.join(base, 'pc1');
  const pc2 = path.join(base, 'pc2');
  for (const d of [src, server, pc1, pc2]) await fsp.mkdir(d, { recursive: true });
  const nodes: NodeConfig[] = [
    { ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] },
    { ...pathNode('T', server, { group: 'G', relay: true }), localRoots: [server] },
    pathNode('PC1', pc1, { group: 'G' }),
    pathNode('PC2', pc2, { group: 'G' }),
  ];
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0, relayAckSeconds: opts.ackSeconds ?? 60 } }));
  const side = async (id: string): Promise<Side> => {
    const ud = path.join(base, `ud-${id}`);
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: id }));
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    return { svc, base };
  };
  const me = await side('Me');
  const relay = opts.relayRunning ? await side('T') : null;
  const stop = () => {
    me.svc.automation?.stop();
    relay?.svc.automation?.stop();
    relay?.svc.relay?.stop();
    me.svc.relay?.stop();
  };
  return { base, src, server, pc1, pc2, me: me.svc, relay: relay?.svc ?? null, stop };
}

const req = (src: string, extra: Partial<SendRequest> = {}): SendRequest => ({ sources: [{ kind: 'fs', path: src }], targetIds: ['T', 'PC1', 'PC2'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'deneme', ...extra });

describe('relay end to end', () => {
  it('writes to the relay only; SamSync on the relay sends on and the result shows per machine', async () => {
    const s = await setup({ relayRunning: true });
    try {
      expect(s.relay!.relay).not.toBeNull();
      await write(path.join(s.src, 'a.txt'), 'A');
      await write(path.join(s.src, 'sub', 'b.txt'), 'B');
      const plan = await s.me.planSend(req(s.src), 't1');
      expect(plan.targets.map((tp) => [tp.targetId, tp.via ?? '-', tp.reachable])).toEqual([
        ['T', '-', true],
        ['PC1', 'T', true],
        ['PC2', 'T', true],
      ]);
      expect(plan.warnings.some((w) => w.includes('PC1'))).toBe(true);
      const h = s.me.runPlan(plan, 'default', { notify: false });
      const d = await h.done;
      expect(d.status).toBe('ok');
      const rows = Object.fromEntries(d.targets.map((x) => [x.key, x]));
      expect(rows.T.status).toBe('ok');
      expect(rows.PC1.via).toBe('T');
      expect(rows.PC1.status).toBe('ok');
      expect(rows.PC2.status).toBe('ok');
      expect(rows.PC1.done).toBeGreaterThan(0);
      expect(read(path.join(s.server, 'Data', 'a.txt'))).toBe('A');
      expect(read(path.join(s.pc1, 'Data', 'sub', 'b.txt'))).toBe('B');
      expect(read(path.join(s.pc2, 'Data', 'a.txt'))).toBe('A');
      // the job folder is tidy again and is never sent along
      expect(fs.readdirSync(path.join(s.server, '_SamSyncRelay', 'jobs'))).toEqual([]);
      expect(fs.existsSync(path.join(s.pc1, '_SamSyncRelay'))).toBe(false);
      expect(d.log.some((l) => /röle dağıttı|passed on by the relay/.test(l.message))).toBe(true);
      // the relay's own files came as one compressed pack, applied there, and the pack is gone again
      expect(d.log.some((l) => /^Paket: |^Pack: /.test(l.message))).toBe(true);
      expect(rows.T.done).toBe(rows.T.total);
      expect(fs.existsSync(path.join(s.server, '_SamSyncRelay', 'jobs', `${d.id}.pack`))).toBe(false);
      // the relay's own history shows the apply, and its card state counts the job
      const relayRuns = await s.relay!.runs();
      expect(relayRuns.some((r) => /^Paket: |^Pack: /.test(r.label))).toBe(true);
      const state = await s.relay!.relayState();
      expect(state).toMatchObject({ active: true, group: 'G', jobs: 1, lastOk: true, lastLabel: 'deneme' });
      // the relay left its manifest from its own disk, so the sender's next plan starts from it
      const manifest = JSON.parse(fs.readFileSync(path.join(s.server, 'samsync-manifest.json'), 'utf8'));
      expect(manifest.subtrees['Data'].entries.length).toBe(3);
      const again = await s.me.planSend(req(s.src), 't1b');
      expect(again.targets.find((tp) => tp.targetId === 'T')!.fromManifest).toBeTruthy();
      expect(await s.me.relayState()).toMatchObject({ active: false, jobs: 0 });
    } finally {
      s.stop();
    }
  }, 30000);

  it('a machine marked as relay takes its own changes as a pack even when nothing is behind it', async () => {
    const s = await setup({ relayRunning: true });
    try {
      await write(path.join(s.src, 'alone.txt'), 'X'.repeat(50_000));
      const plan = await s.me.planSend(req(s.src, { targetIds: ['T'] }), 't-alone');
      expect(plan.targets.map((tp) => tp.targetId)).toEqual(['T']);
      const d = await s.me.runPlan(plan, 'default', { notify: false }).done;
      expect(d.status).toBe('ok');
      expect(read(path.join(s.server, 'Data', 'alone.txt'))?.length).toBe(50_000);
      expect(d.log.some((l) => /^Paket: |^Pack: /.test(l.message))).toBe(true);
    } finally {
      s.stop();
    }
  }, 30000);

  it('writes directly, without waiting, when the relay has no fresh heartbeat', async () => {
    const s = await setup({ relayRunning: false });
    try {
      await write(path.join(s.src, 'h.txt'), 'H');
      const started = Date.now();
      const plan = await s.me.planSend(req(s.src), 't-down');
      expect(plan.targets.find((tp) => tp.targetId === 'T')!.relayDown).toBe(true);
      expect(plan.targets.map((tp) => [tp.targetId, tp.via ?? '-'])).toEqual([
        ['T', '-'],
        ['PC1', '-'],
        ['PC2', '-'],
      ]);
      expect(plan.warnings.some((w) => /SamSync çalışmıyor|no SamSync runs/.test(w))).toBe(true);
      const d = await s.me.runPlan(plan, 'default', { notify: false }).done;
      expect(d.status).toBe('ok');
      expect(Date.now() - started).toBeLessThan(5000);
      for (const dir of [s.server, s.pc1, s.pc2]) expect(read(path.join(dir, 'Data', 'h.txt'))).toBe('H');
      expect(fs.existsSync(path.join(s.server, '_SamSyncRelay', 'jobs'))).toBe(false);
    } finally {
      s.stop();
    }
  });

  it('falls back to a direct send when the relay stops answering after a fresh heartbeat', async () => {
    const s = await setup({ relayRunning: false, ackSeconds: 5 });
    try {
      // a heartbeat from a SamSync that has just died: the plan still trusts it
      await write(path.join(s.server, '_SamSyncRelay', 'alive.json'), JSON.stringify({ at: Date.now(), node: 'T' }));
      await write(path.join(s.src, 'c.txt'), 'C');
      const plan = await s.me.planSend(req(s.src), 't2');
      const d = await s.me.runPlan(plan, 'default', { notify: false }).done;
      const pc1 = d.targets.find((x) => x.key === 'PC1')!;
      expect(pc1.status).toBe('failed');
      expect(pc1.relayUnanswered).toBe(true);
      expect(pc1.error).toMatch(/işi almadı|did not pick the job up/);
      // the job was taken back, and a direct run brings the file anyway
      expect(fs.readdirSync(path.join(s.server, '_SamSyncRelay', 'jobs'))).toEqual([]);
      // the relay itself got nothing but a pack nobody opened: the direct run covers it too
      expect(d.targets.find((x) => x.key === 'T')!.relayUnanswered).toBe(true);
      expect(fs.readdirSync(path.join(s.server, '_SamSyncRelay', 'jobs')).filter((n) => n.endsWith('.pack'))).toEqual([]);
      await until(() => read(path.join(s.pc1, 'Data', 'c.txt')) === 'C' && read(path.join(s.pc2, 'Data', 'c.txt')) === 'C' && read(path.join(s.server, 'Data', 'c.txt')) === 'C');
      await until(async () => (await s.me.runs()).length >= 2);
      const runs = await s.me.runs();
      expect(runs.some((r) => /doğrudan|direct/.test(r.label))).toBe(true);
    } finally {
      s.stop();
    }
  }, 30000);

  it('compares directly even where a relay would send', async () => {
    const s = await setup({ relayRunning: false });
    try {
      await write(path.join(s.src, 'd.txt'), 'D');
      const plan = await s.me.planSend(req(s.src, { direct: true }), 't3');
      expect(plan.targets.every((tp) => !tp.via)).toBe(true);
      expect(plan.targets.find((tp) => tp.targetId === 'PC1')!.counts.new).toBe(2);
    } finally {
      s.stop();
    }
  });
});

describe('relay delivery queue', () => {
  it('keeps the job of a machine that is off and delivers it once the machine answers', async () => {
    const s = await setup({ relayRunning: true });
    try {
      // PC2 is off: its folder does not exist while the job comes
      await fsp.rm(s.pc2, { recursive: true, force: true });
      await write(path.join(s.src, 'a.txt'), 'A');
      const plan = await s.me.planSend(req(s.src), 'q1');
      const d = await s.me.runPlan(plan, 'default', { notify: false }).done;
      const rows = Object.fromEntries(d.targets.map((x) => [x.key, x]));
      expect(rows.PC1.status).toBe('ok');
      expect(rows.PC2.status).toBe('failed');
      expect(rows.PC2.deferred).toBe(true);
      expect(rows.PC2.error).toMatch(/teslim|deliver/);
      expect(d.status).toBe('partial');
      expect(d.log.some((l) => l.key === 'PC2' && /röle açılınca|relay delivers/.test(l.message))).toBe(true);
      // the queue on the relay: one file for PC2 with the job in it, and the card shows it
      const pendingDir = path.join(s.server, '_SamSyncRelay', 'pending');
      await until(() => fs.existsSync(path.join(pendingDir, 'PC2.json')));
      const pending = JSON.parse(fs.readFileSync(path.join(pendingDir, 'PC2.json'), 'utf8'));
      expect(pending.jobs).toHaveLength(1);
      expect(pending.jobs[0].sources[0].rel).toBe('Data');
      const relay = s.relay!.relay!;
      await until(async () => ((await s.relay!.relayState()).pending?.length ?? 0) === 1);
      // a second job while PC2 is still off joins the queue
      await write(path.join(s.src, 'b.txt'), 'B');
      const plan2 = await s.me.planSend(req(s.src), 'q2');
      await s.me.runPlan(plan2, 'default', { notify: false }).done;
      await until(() => JSON.parse(fs.readFileSync(path.join(pendingDir, 'PC2.json'), 'utf8')).jobs.length === 2);
      // still off: a pass over the queue changes nothing but the attempt count
      await relay.deliverPending();
      expect(JSON.parse(fs.readFileSync(path.join(pendingDir, 'PC2.json'), 'utf8')).attempts).toBe(1);
      expect(fs.existsSync(path.join(s.pc2, 'Data', 'a.txt'))).toBe(false);
      // PC2 comes back: the next pass delivers both jobs and empties the queue
      await fsp.mkdir(s.pc2, { recursive: true });
      await relay.deliverPending();
      expect(read(path.join(s.pc2, 'Data', 'a.txt'))).toBe('A');
      expect(read(path.join(s.pc2, 'Data', 'b.txt'))).toBe('B');
      expect(fs.existsSync(path.join(pendingDir, 'PC2.json'))).toBe(false);
      expect((await s.relay!.relayState()).pending).toEqual([]);
      const relayRuns = await s.relay!.runs();
      expect(relayRuns.filter((r) => /kuyruktan|from the queue/.test(r.label)).length).toBeGreaterThanOrEqual(1);
    } finally {
      s.stop();
    }
  }, 40000);
});
