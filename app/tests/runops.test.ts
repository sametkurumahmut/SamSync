import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import type { AppEvent, SendRequest } from '../src/shared/types';
import { tmpDir, write, pathNode, defaultOptions } from './helpers';

describe('a run tells which operations went through', () => {
  it('sends the finished operations with its progress and keeps the failed ones with why', async () => {
    const base = await tmpDir();
    const me = path.join(base, 'me');
    const src = path.join(me, 'Data');
    const tgt = path.join(base, 'T');
    await fsp.mkdir(tgt, { recursive: true });
    await write(path.join(src, 'kept.txt'), 'K');
    await write(path.join(src, 'gone.txt'), 'G');
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [{ ...pathNode('Me', me), localRoots: [me] }, pathNode('T', tgt)], copy: { retryCount: 0, waitSeconds: 0 } }));
    const ud = path.join(base, 'ud');
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const events: AppEvent[] = [];
    const svc = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: (e) => events.push(e) });
    await svc.init();
    try {
      const req: SendRequest = { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'ops' };
      const plan = await svc.planSend(req, 'ops1');
      // a source that goes away between the review and the send: its copy fails
      await fsp.rm(path.join(src, 'gone.txt'));
      const handle = svc.runPlan(plan, 'default', { notify: false });
      const d = await handle.done;
      const ops = events.flatMap((e) => (e.type === 'run-progress' && e.runId === d.id ? (e.ops ?? []) : []));
      const byRel = (rel: string) => plan.targets[0].ops.find((o) => o.rel.endsWith(rel))!.id;
      expect(ops).toContainEqual(['T', byRel('kept.txt'), 1]);
      expect(ops).toContainEqual(['T', byRel('gone.txt'), 0]);
      // what a relay tells its sender: the failed files and why
      const failed = handle.failures('T', 10);
      expect(failed.map((f) => f.rel)).toEqual([plan.targets[0].ops.find((o) => o.rel.endsWith('gone.txt'))!.rel]);
      expect(failed[0].error).toBeTruthy();
    } finally {
      svc.automation?.stop();
      svc.relay?.stop();
    }
  }, 30000);

  it('leaves out the machines taken out in the review, also when the send is set for later', async () => {
    const base = await tmpDir();
    const me = path.join(base, 'me');
    const src = path.join(me, 'Data');
    const [a, b] = [path.join(base, 'A'), path.join(base, 'B')];
    for (const d of [a, b]) await fsp.mkdir(d, { recursive: true });
    await write(path.join(src, 'x.txt'), 'X');
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [{ ...pathNode('Me', me), localRoots: [me] }, pathNode('A', a, { group: 'G' }), pathNode('B', b, { group: 'G' })], copy: { retryCount: 0, waitSeconds: 0 } }));
    const ud = path.join(base, 'ud');
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const svc = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    try {
      // the send names the group; B is taken out in the review
      const req: SendRequest = { sources: [{ kind: 'fs', path: src }], targetIds: ['group:G'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'out' };
      const plan = await svc.planSend(req, 'out1');
      expect(plan.targets.map((tp) => tp.targetId).sort()).toEqual(['A', 'B']);
      const d = await svc.runPlan(plan, 'default', { notify: false, exclude: ['B'] }).done;
      expect(d.targets.map((x) => x.key)).toEqual(['A']);
      expect(await fsp.readFile(path.join(a, 'Data', 'x.txt'), 'utf8')).toBe('X');
      await expect(fsp.stat(path.join(b, 'Data', 'x.txt'))).rejects.toThrow();
      // for later: the plan's machines by name, without B (the group would bring it back)
      const later = await svc.scheduleSend(plan.id, Date.now() + 3600_000, false, ['B']);
      expect(later.request.targetIds).toEqual(['A']);
      await svc.cancelScheduledSend(later.id);
    } finally {
      svc.automation?.stop();
      svc.relay?.stop();
    }
  }, 30000);
});
