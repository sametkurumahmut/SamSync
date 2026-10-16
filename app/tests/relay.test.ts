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
    const IG1 = pathNode('IG1', 'y', { group: 'G' });
    const IG2 = pathNode('IG2', 'z', { group: 'G' });
    const Other = pathNode('O', 'o', { group: 'H' });
    const r = relayRouting([T, IG1, IG2, Other]);
    expect(r.direct.map((n) => n.id)).toEqual(['T', 'O']);
    expect([...r.via.entries()].map(([k, v]) => [k, v.map((n) => n.id)])).toEqual([['T', ['IG1', 'IG2']]]);
    // one IG alone: straight to it, the relay is not touched
    expect(relayRouting([IG1]).direct.map((n) => n.id)).toEqual(['IG1']);
    expect(relayRouting([IG1]).via.size).toBe(0);
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
  const trainer = path.join(base, 'trainer');
  const ig1 = path.join(base, 'ig1');
  const ig2 = path.join(base, 'ig2');
  for (const d of [src, trainer, ig1, ig2]) await fsp.mkdir(d, { recursive: true });
  const nodes: NodeConfig[] = [
    { ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] },
    { ...pathNode('T', trainer, { group: 'G', relay: true }), localRoots: [trainer] },
    pathNode('IG1', ig1, { group: 'G' }),
    pathNode('IG2', ig2, { group: 'G' }),
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
  return { base, src, trainer, ig1, ig2, me: me.svc, relay: relay?.svc ?? null, stop };
}

const req = (src: string, extra: Partial<SendRequest> = {}): SendRequest => ({ sources: [{ kind: 'fs', path: src }], targetIds: ['T', 'IG1', 'IG2'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'deneme', ...extra });

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
        ['IG1', 'T', true],
        ['IG2', 'T', true],
      ]);
      expect(plan.warnings.some((w) => w.includes('IG1'))).toBe(true);
      const h = s.me.runPlan(plan, 'default', { notify: false });
      const d = await h.done;
      expect(d.status).toBe('ok');
      const rows = Object.fromEntries(d.targets.map((x) => [x.key, x]));
      expect(rows.T.status).toBe('ok');
      expect(rows.IG1.via).toBe('T');
      expect(rows.IG1.status).toBe('ok');
      expect(rows.IG2.status).toBe('ok');
      expect(rows.IG1.done).toBeGreaterThan(0);
      expect(read(path.join(s.trainer, 'Data', 'a.txt'))).toBe('A');
      expect(read(path.join(s.ig1, 'Data', 'sub', 'b.txt'))).toBe('B');
      expect(read(path.join(s.ig2, 'Data', 'a.txt'))).toBe('A');
      // the job folder is tidy again and is never sent along
      expect(fs.readdirSync(path.join(s.trainer, '_SamSyncRelay', 'jobs'))).toEqual([]);
      expect(fs.existsSync(path.join(s.ig1, '_SamSyncRelay'))).toBe(false);
      expect(d.log.some((l) => /röle dağıttı|passed on by the relay/.test(l.message))).toBe(true);
      // the relay's own files came as one compressed pack, applied there, and the pack is gone again
      expect(d.log.some((l) => /^Paket: |^Pack: /.test(l.message))).toBe(true);
      expect(rows.T.done).toBe(rows.T.total);
      expect(fs.existsSync(path.join(s.trainer, '_SamSyncRelay', 'jobs', `${d.id}.pack`))).toBe(false);
      // the relay's own history shows the apply
      const relayRuns = await s.relay!.runs();
      expect(relayRuns.some((r) => /^Paket: |^Pack: /.test(r.label))).toBe(true);
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
      expect(read(path.join(s.trainer, 'Data', 'alone.txt'))?.length).toBe(50_000);
      expect(d.log.some((l) => /^Paket: |^Pack: /.test(l.message))).toBe(true);
    } finally {
      s.stop();
    }
  }, 30000);

  it('falls back to a direct send when no SamSync runs on the relay', async () => {
    const s = await setup({ relayRunning: false, ackSeconds: 5 });
    try {
      await write(path.join(s.src, 'c.txt'), 'C');
      const plan = await s.me.planSend(req(s.src), 't2');
      const d = await s.me.runPlan(plan, 'default', { notify: false }).done;
      const ig1 = d.targets.find((x) => x.key === 'IG1')!;
      expect(ig1.status).toBe('failed');
      expect(ig1.relayUnanswered).toBe(true);
      expect(ig1.error).toMatch(/işi almadı|did not pick the job up/);
      // the job was taken back, and a direct run brings the file anyway
      expect(fs.readdirSync(path.join(s.trainer, '_SamSyncRelay', 'jobs'))).toEqual([]);
      // the relay itself got nothing but a pack nobody opened: the direct run covers it too
      expect(d.targets.find((x) => x.key === 'T')!.relayUnanswered).toBe(true);
      expect(fs.readdirSync(path.join(s.trainer, '_SamSyncRelay', 'jobs')).filter((n) => n.endsWith('.pack'))).toEqual([]);
      await until(() => read(path.join(s.ig1, 'Data', 'c.txt')) === 'C' && read(path.join(s.ig2, 'Data', 'c.txt')) === 'C' && read(path.join(s.trainer, 'Data', 'c.txt')) === 'C');
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
      expect(plan.targets.find((tp) => tp.targetId === 'IG1')!.counts.new).toBe(2);
    } finally {
      s.stop();
    }
  });
});
