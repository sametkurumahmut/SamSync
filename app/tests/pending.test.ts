import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import { PENDING_KEEP_MS } from '../src/core/pending';
import type { NodeConfig, SendRequest } from '../src/shared/types';
import { tmpDir, write, read, pathNode, defaultOptions, sleep } from './helpers';

async function setup(sendWhenOnline: boolean) {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const pc1 = path.join(base, 'pc1');
  await fsp.mkdir(src, { recursive: true });
  // PC1 is off: its folder is not there
  const nodes: NodeConfig[] = [{ ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] }, pathNode('PC1', pc1)];
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0 } }));
  const ud = path.join(base, 'ud');
  await fsp.mkdir(ud, { recursive: true });
  await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me', sendWhenOnline, agent: { receivePacks: false, notifyOnApply: false } }));
  const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
  await svc.init();
  const stop = () => {
    svc.automation?.stop();
    svc.pending.stop();
    svc.relay?.stop();
  };
  return { base, src, pc1, ud, svc, stop };
}

const req = (src: string, label = 'deneme'): SendRequest => ({ sources: [{ kind: 'fs', path: src }], targetIds: ['PC1'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label });

describe('send when the machine is back', () => {
  it('keeps the send of a machine that is off and sends the sources as they are once it answers', async () => {
    const s = await setup(true);
    try {
      await write(path.join(s.src, 'a.txt'), 'A');
      const plan = await s.svc.planSend(req(s.src), 'p1');
      expect(plan.targets[0].reachable).toBe(false);
      expect(await s.svc.executePlan(plan.id, {})).toBeTruthy();
      expect(s.svc.pending.list().map((p) => [p.targetId, p.label])).toEqual([['PC1', 'deneme']]);
      for (let i = 0; i < 250 && !fs.existsSync(path.join(s.ud, 'pending-sends.json')); i++) await sleep(20);
      expect(JSON.parse(fs.readFileSync(path.join(s.ud, 'pending-sends.json'), 'utf8')).items).toHaveLength(1);
      // a second send of the same sources replaces the first one waiting
      await s.svc.executePlan((await s.svc.planSend(req(s.src, 'ikinci'), 'p2')).id, {});
      expect(s.svc.pending.list().map((p) => p.label)).toEqual(['ikinci']);
      // still off: a look changes nothing
      await s.svc.pending.tick();
      expect(s.svc.pending.list()).toHaveLength(1);
      // the source changed meanwhile, and the machine is back: it gets the files as they are now
      await write(path.join(s.src, 'b.txt'), 'B');
      await fsp.mkdir(s.pc1, { recursive: true });
      await s.svc.pending.tick();
      expect(read(path.join(s.pc1, 'Data', 'a.txt'))).toBe('A');
      expect(read(path.join(s.pc1, 'Data', 'b.txt'))).toBe('B');
      expect(s.svc.pending.list()).toEqual([]);
      // the history is written just after the run ends
      const back = async () => (await s.svc.runs()).some((r) => /^Açılınca: ikinci$|^When back: ikinci$/.test(r.label));
      for (let i = 0; i < 100 && !(await back()); i++) await sleep(50);
      expect(await back()).toBe(true);
    } finally {
      s.stop();
    }
  }, 30000);

  it('drops a send after a week and keeps nothing when the setting is off', async () => {
    const s = await setup(true);
    try {
      await write(path.join(s.src, 'a.txt'), 'A');
      s.svc.pending.add(req(s.src), 'PC1', 'PC1', Date.now() - PENDING_KEEP_MS - 1000);
      await s.svc.pending.tick();
      expect(s.svc.pending.list()).toEqual([]);
      await s.svc.saveSettings({ sendWhenOnline: false });
      await s.svc.executePlan((await s.svc.planSend(req(s.src), 'p3')).id, {});
      expect(s.svc.pending.list()).toEqual([]);
      // a dry run is never kept either
      await s.svc.saveSettings({ sendWhenOnline: true });
      await s.svc.executePlan((await s.svc.planSend(req(s.src), 'p4')).id, {}, { dryRun: true });
      expect(s.svc.pending.list()).toEqual([]);
      expect(await s.svc.cancelPendingSend('nope')).toBe(false);
    } finally {
      s.stop();
    }
  }, 30000);
});
