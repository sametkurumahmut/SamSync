import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import type { NodeConfig, RunDetail, SendPlan, SendRequest } from '../src/shared/types';
import { tmpDir, pathNode, defaultOptions, sleep } from './helpers';

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

/**
 * A sender and a group G: T runs SamSync (as relay when \`relay\` is set), PC1 and PC2 do not. Every copy is held
 * to 0.5 MB/s, so a few MB of incompressible files keep the upload and the relay's fan-out going for seconds.
 */
async function world(relay: boolean) {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const dir = { T: path.join(base, 't'), PC1: path.join(base, 'pc1'), PC2: path.join(base, 'pc2') };
  for (const d of [src, ...Object.values(dir)]) await fsp.mkdir(d, { recursive: true });
  for (let i = 0; i < 4; i++) await fsp.writeFile(path.join(src, `f${i}.bin`), crypto.randomBytes(500 * 1024));
  const nodes: NodeConfig[] = [
    { ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] },
    { ...pathNode('T', dir.T, { group: 'G', relay }), localRoots: [dir.T] },
    pathNode('PC1', dir.PC1, { group: 'G' }),
    pathNode('PC2', dir.PC2, { group: 'G' }),
  ];
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0, bandwidthMBps: 0.5, parallelFiles: 1 } }));
  const side = async (id: Id) => {
    const ud = path.join(base, `ud-${id}`);
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: id, agent: { receivePacks: true, notifyOnApply: false } }));
    const svc = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    return svc;
  };
  const me = await side('Me');
  const t = await side('T');
  await until(() => fs.existsSync(path.join(dir.T, '_SamSyncRelay', 'alive.json')));
  await t.relay!.heartbeat();
  const stop = () => {
    for (const s of [me, t]) {
      s.automation?.stop();
      s.relay?.stop();
      s.later.stop();
      s.pending.stop();
    }
  };
  return { base, src, dir, me, t, stop, jobs: path.join(dir.T, '_SamSyncRelay', 'jobs') };
}

const req = (src: string, targetIds: string[]): SendRequest => ({ sources: [{ kind: 'fs', path: src }], targetIds, options: { ...defaultOptions, propagateDeletes: false, backup: false }, origin: 'send', label: 'durdur' });
const selectedOf = (plan: SendPlan) => Object.fromEntries(plan.targets.map((tp) => [tp.targetId, tp.ops.filter((o) => o.selected).map((o) => o.id)]));
const finished = (svc: Service, id: string, ms?: number): Promise<RunDetail> =>
  until(async () => {
    const d = await svc.run(id);
    return d?.finishedAt ? d : null;
  }, ms);
/** The size of the pack being uploaded to T (0 while there is none). */
const uploading = (jobs: string) => (fs.existsSync(jobs) ? fs.readdirSync(jobs).filter((n) => n.endsWith('.pack.tmp')).reduce((a, n) => a + (fs.statSync(path.join(jobs, n), { throwIfNoEntry: false })?.size ?? 0), 0) : 0);
const files = (dir: string) => (fs.existsSync(path.join(dir, 'Data')) ? fs.readdirSync(path.join(dir, 'Data')).filter((n) => n.endsWith('.bin')) : []);

describe('pause and cancel while a pack goes to a machine running SamSync', () => {
  it('cancel stops the upload at once and leaves nothing there', async () => {
    const w = await world(false);
    try {
      const plan = await w.me.planSend(req(w.src, ['T']), 'p');
      expect(plan.targets[0].agent).toBe(true);
      const id = await w.me.executePlan(plan.id, selectedOf(plan), { remember: false });
      await until(() => uploading(w.jobs) > 100 * 1024);
      const asked = Date.now();
      await w.me.cancelRun(id);
      const d = await finished(w.me, id, 8000);
      expect(Date.now() - asked).toBeLessThan(3000);
      expect(d.status).toBe('cancelled');
      expect(d.targets[0].status).toBe('cancelled');
      expect(d.log.some((l) => /İptal istendi|Cancel asked/.test(l.message))).toBe(true);
      await sleep(1500);
      expect(files(w.dir.T)).toEqual([]);
      expect(fs.readdirSync(w.jobs).filter((n) => !n.endsWith('.cancel'))).toEqual([]);
    } finally {
      w.stop();
    }
  }, 60000);

  it('pause holds the upload and resume finishes it', async () => {
    const w = await world(false);
    try {
      const plan = await w.me.planSend(req(w.src, ['T']), 'p');
      const id = await w.me.executePlan(plan.id, selectedOf(plan), { remember: false });
      await until(() => uploading(w.jobs) > 100 * 1024);
      await w.me.pauseRun(id, true);
      await sleep(500);
      const held = uploading(w.jobs);
      await sleep(2000);
      expect(await w.me.run(id)).toBeNull();
      // the upload stands still while paused
      expect(uploading(w.jobs)).toBe(held);
      await w.me.pauseRun(id, false);
      const d = await finished(w.me, id, 30000);
      expect(d.status).toBe('ok');
      expect(files(w.dir.T).sort()).toEqual(['f0.bin', 'f1.bin', 'f2.bin', 'f3.bin']);
    } finally {
      w.stop();
    }
  }, 60000);

  it('a cancel after the relay took the job stops its fan-out and comes back with what it did', async () => {
    const w = await world(true);
    try {
      const plan = await w.me.planSend(req(w.src, ['T', 'PC1', 'PC2']), 'p');
      const id = await w.me.executePlan(plan.id, selectedOf(plan), { remember: false });
      // the relay applied its own pack and sends on to the machines behind it
      await until(() => files(w.dir.PC1).length > 0 || files(w.dir.PC2).length > 0, 30000);
      const asked = Date.now();
      await w.me.cancelRun(id);
      const d = await finished(w.me, id, 20000);
      expect(Date.now() - asked).toBeLessThan(10000);
      expect(d.status).toBe('cancelled');
      expect(d.targets.find((x) => x.key === 'T')!.status).toBe('ok');
      for (const k of ['PC1', 'PC2']) expect(d.targets.find((x) => x.key === k)!.status).toBe('cancelled');
      expect(files(w.dir.PC1).length + files(w.dir.PC2).length).toBeLessThan(8);
      // the relay cleans up its job files once it answered
      await until(() => fs.readdirSync(w.jobs).length === 0, 5000);
    } finally {
      w.stop();
    }
  }, 90000);
});
