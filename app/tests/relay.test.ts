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
async function setup(opts: { relayRunning: boolean; ackSeconds?: number; agentOn?: boolean }) {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const server = path.join(base, 'server');
  const pc1 = path.join(base, 'pc1');
  const pc2 = path.join(base, 'pc2');
  for (const d of [src, server, pc1, pc2]) await fsp.mkdir(d, { recursive: true });
  const nodes: NodeConfig[] = [
    { ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] },
    { ...pathNode('T', server, { group: 'G', relay: true }), localRoots: [server] },
    { ...pathNode('PC1', pc1, { group: 'G' }), localRoots: opts.agentOn ? [pc1] : [] },
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
  const agent = opts.agentOn ? await side('PC1') : null;
  const stop = () => {
    agent?.svc.automation?.stop();
    agent?.svc.relay?.stop();
    me.svc.automation?.stop();
    relay?.svc.automation?.stop();
    relay?.svc.relay?.stop();
    me.svc.relay?.stop();
  };
  return { base, src, server, pc1, pc2, me: me.svc, relay: relay?.svc ?? null, agent: agent?.svc ?? null, stop };
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
      // the sender runs SamSync too, so it takes packs itself: an agent, not a relay
      expect(await s.me.relayState()).toMatchObject({ active: true, role: 'agent', jobs: 0 });
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

describe('agent on a machine without a group', () => {
  it('a machine running SamSync takes the send as one pack and applies it with its own commands', async () => {
    const s = await setup({ relayRunning: false, agentOn: true });
    const send = async (label: string) => (await s.me.runPlan(await s.me.planSend(req(s.src, { targetIds: ['PC1'] }), label), 'default', { notify: false }).done);
    try {
      await write(path.join(s.src, 'a.txt'), 'A');
      await write(path.join(s.src, 'sub', 'b.txt'), 'B');
      const plan = await s.me.planSend(req(s.src, { targetIds: ['PC1'] }), 'ag1');
      expect(plan.targets[0]).toMatchObject({ targetId: 'PC1', agent: true });
      expect(plan.targets[0].via).toBeUndefined();
      const d = await s.me.runPlan(plan, 'default', { notify: false }).done;
      expect(d.status).toBe('ok');
      expect(read(path.join(s.pc1, 'Data', 'sub', 'b.txt'))).toBe('B');
      expect(d.log.some((l) => /^Paket: |^Pack: /.test(l.message))).toBe(true);
      expect(fs.readdirSync(path.join(s.pc1, '_SamSyncRelay', 'jobs'))).toEqual([]);
      expect(await s.agent!.relayState()).toMatchObject({ active: true, role: 'agent', jobs: 1, lastOk: true });
      // after the apply its own command runs (start the program again)
      const marker = path.join(s.base, 'after.txt');
      await s.agent!.saveSettings({ agent: { receivePacks: true, notifyOnApply: false, afterApply: `echo ok> "${marker}"` } });
      await write(path.join(s.src, 'a.txt'), 'A2');
      expect((await send('ag2')).status).toBe('ok');
      expect(read(path.join(s.pc1, 'Data', 'a.txt'))).toBe('A2');
      expect(fs.existsSync(marker)).toBe(true);
      // a command before the apply that fails leaves the files as they were
      await s.agent!.saveSettings({ agent: { receivePacks: true, notifyOnApply: false, beforeApply: 'exit 1' } });
      await write(path.join(s.src, 'a.txt'), 'A333');
      const d3 = await send('ag3');
      expect(d3.status).toBe('failed');
      expect(d3.targets[0].error).toMatch(/Uygulama öncesi|before applying/);
      expect(read(path.join(s.pc1, 'Data', 'a.txt'))).toBe('A2');
      // turned off: the heartbeat goes at once and the sender writes over the share again
      await s.agent!.saveSettings({ agent: { receivePacks: false, notifyOnApply: false } });
      expect((await s.agent!.relayState()).active).toBe(false);
      // and its folder is gone again
      expect(fs.existsSync(path.join(s.pc1, '_SamSyncRelay'))).toBe(false);
      const plan4 = await s.me.planSend(req(s.src, { targetIds: ['PC1'] }), 'ag4');
      expect(plan4.targets[0].agent).toBeUndefined();
      expect((await s.me.runPlan(plan4, 'default', { notify: false }).done).status).toBe('ok');
      expect(read(path.join(s.pc1, 'Data', 'a.txt'))).toBe('A333');
    } finally {
      s.stop();
    }
  }, 40000);
});

describe('content comparison through the agent', () => {
  it('SamSync on the target hashes its own disk; nothing is read back over the network', async () => {
    const s = await setup({ relayRunning: false, agentOn: true });
    try {
      // same size on both sides: only the contents can tell
      await write(path.join(s.src, 'same.txt'), 'AAAA');
      await write(path.join(s.src, 'diff.txt'), 'BBBB');
      await write(path.join(s.src, 'deep', 'one.txt'), 'CCCC');
      await write(path.join(s.pc1, 'Data', 'same.txt'), 'AAAA');
      await write(path.join(s.pc1, 'Data', 'diff.txt'), 'bbbb');
      await write(path.join(s.pc1, 'Data', 'deep', 'one.txt'), 'CCCC');
      const r = req(s.src, { targetIds: ['PC1'], options: { ...defaultOptions, propagateDeletes: false, compare: 'content' } });
      const plan = await s.me.planSend(r, 'h1');
      const tp = plan.targets[0];
      expect(tp.agentHashed).toBe(3);
      expect(tp.ops.filter((o) => o.selected).map((o) => o.rel)).toEqual(['Data/diff.txt']);
      expect(tp.counts.same).toBe(2);
      // the questions and answers are gone again
      expect(fs.readdirSync(path.join(s.pc1, '_SamSyncRelay', 'hashes'))).toEqual([]);
    } finally {
      s.stop();
    }
  }, 30000);

  it('reads over the network when SamSync there does not answer', async () => {
    const s = await setup({ relayRunning: false });
    try {
      // a heartbeat that says hashes are answered, from a SamSync that has just died
      await write(path.join(s.pc1, '_SamSyncRelay', 'alive.json'), JSON.stringify({ at: Date.now(), node: 'PC1', hashes: true }));
      await write(path.join(s.src, 'x.txt'), 'XXXX');
      await write(path.join(s.pc1, 'Data', 'x.txt'), 'xxxx');
      const r = req(s.src, { targetIds: ['PC1'], options: { ...defaultOptions, propagateDeletes: false, compare: 'content' } });
      const plan = await s.me.planSend(r, 'h2');
      const tp = plan.targets[0];
      expect(tp.agentHashed).toBeUndefined();
      expect(tp.ops.filter((o) => o.selected).map((o) => o.rel)).toEqual(['Data/x.txt']);
      expect(fs.readdirSync(path.join(s.pc1, '_SamSyncRelay', 'hashes'))).toEqual([]);
    } finally {
      s.stop();
    }
  }, 30000);
});

describe('direct comparisons through the agent', () => {
  it('the Compare page and a machine-to-machine comparison use the hashes SamSync on the target makes', async () => {
    const s = await setup({ relayRunning: false, agentOn: true });
    try {
      await write(path.join(s.src, 'same.txt'), 'AAAA');
      await write(path.join(s.src, 'diff.txt'), 'BBBB');
      await write(path.join(s.pc1, 'Data', 'same.txt'), 'AAAA');
      await write(path.join(s.pc1, 'Data', 'diff.txt'), 'bbbb');
      // the Compare page plans directly: no relay, no pack, but the hashes are still asked for
      const plan = await s.me.planSend(req(s.src, { targetIds: ['PC1'], direct: true, options: { ...defaultOptions, propagateDeletes: false, compare: 'content' } }), 'c1');
      expect(plan.targets[0].agent).toBeUndefined();
      expect(plan.targets[0].agentHashed).toBe(2);
      expect(plan.targets[0].ops.filter((o) => o.selected).map((o) => o.rel)).toEqual(['Data/diff.txt']);
      // a folder here against the machine's Data folder: the machine side answers by path under its root
      const job = {
        id: 'mm',
        name: 'mm',
        pairs: [{ id: 'p', left: { kind: 'local' as const, path: s.src }, right: { kind: 'node' as const, nodeId: 'PC1', subPath: 'Data' } }],
        compare: 'content' as const,
        variant: 'mirror' as const,
        filter: { include: [], exclude: [] },
        deletion: 'versioning' as const,
        versioningKeep: 0,
      };
      const r = await s.me.compareJob(job, 'c2');
      const pair = r.pairs[0];
      expect(pair.remoteHashed).toBe(2);
      expect(Object.fromEntries(pair.items.map((it) => [it.rel, it.category]))).toEqual({ 'same.txt': 'equal', 'diff.txt': 'different' });
      expect(fs.readdirSync(path.join(s.pc1, '_SamSyncRelay', 'hashes'))).toEqual([]);
    } finally {
      s.stop();
    }
  }, 30000);
});

describe('block delta through the agent', () => {
  it('a big file already on the target goes as the blocks that differ', async () => {
    const s = await setup({ relayRunning: false, agentOn: true });
    try {
      const MB = 1024 * 1024;
      const old = Buffer.alloc(9 * MB + 123);
      for (let i = 0; i < old.length; i += 4096) old.writeUInt32LE((i * 2654435761) >>> 0, i);
      const next = Buffer.from(old);
      next[4 * MB + 10] ^= 0xff;
      await fsp.mkdir(path.join(s.pc1, 'Data'), { recursive: true });
      await fsp.writeFile(path.join(s.pc1, 'Data', 'big.bin'), old);
      fs.utimesSync(path.join(s.pc1, 'Data', 'big.bin'), new Date(Date.now() - 86400_000), new Date(Date.now() - 86400_000));
      await fsp.mkdir(s.src, { recursive: true });
      await fsp.writeFile(path.join(s.src, 'big.bin'), next);
      const plan = await s.me.planSend(req(s.src, { targetIds: ['PC1'] }), 'd1');
      expect(plan.targets[0].agent).toBe(true);
      const d = await s.me.runPlan(plan, 'default', { notify: false }).done;
      expect(d.status).toBe('ok');
      expect(fs.readFileSync(path.join(s.pc1, 'Data', 'big.bin')).equals(next)).toBe(true);
      expect(d.log.some((l) => /^Blok farkı: |^Block delta: /.test(l.message))).toBe(true);
      // one block of nine went into the pack
      const packLine = d.log.find((l) => /^Paket: |^Pack: /.test(l.message))!.message;
      expect(packLine).toMatch(/→ (\d+(\.\d+)? KB|1(\.\d+)? MB)/);
      expect(d.log.find((l) => /^Blok farkı: |^Block delta: /.test(l.message))!.message).toMatch(/1\.0 MB/);
    } finally {
      s.stop();
    }
  }, 40000);
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
