import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Service } from '../src/core/service';
import { LOCK_FILE } from '../src/shared/files';
import type { SendRequest } from '../src/shared/types';
import { tmpDir, write, pathNode, defaultOptions, read } from './helpers';

async function setup() {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const tgt = path.join(base, 't');
  const ud = path.join(base, 'ud');
  for (const d of [src, tgt, ud]) await fsp.mkdir(d, { recursive: true });
  await write(path.join(src, 'a.txt'), 'A');
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [{ ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] }, pathNode('T', tgt)] }));
  await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
  const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
  await svc.init();
  const req: SendRequest = { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'benimki' };
  return { svc, src, tgt, req };
}

describe('target lock', () => {
  it('warns about a fresh lock of another computer, writes its own while running and removes it after', async () => {
    const s = await setup();
    try {
      await fsp.writeFile(path.join(s.tgt, LOCK_FILE), JSON.stringify({ host: 'PC-AHMET', user: 'ahmet', label: 'Release 3.4', startedAt: Date.now() - 120_000, pid: 4242 }));
      const plan = await s.svc.planSend(s.req, 'l1');
      const tp = plan.targets[0];
      expect(tp.lock).toMatchObject({ host: 'PC-AHMET', user: 'ahmet', label: 'Release 3.4' });
      expect(plan.warnings.some((w) => w.includes('ahmet'))).toBe(true);
      // the lock file itself is never part of the plan
      expect(tp.ops.some((o) => o.rel.includes(LOCK_FILE))).toBe(false);
      const d = await s.svc.runPlan(plan, 'default', { notify: false }).done;
      expect(d.status).toBe('ok');
      expect(d.log.some((l) => l.level === 'warn' && l.message.includes('ahmet'))).toBe(true);
      expect(read(path.join(s.tgt, 'Data', 'a.txt'))).toBe('A');
      // ours replaced it and went away with the run
      expect(fs.existsSync(path.join(s.tgt, LOCK_FILE))).toBe(false);
    } finally {
      s.svc.automation?.stop();
    }
  });

  it('ignores a stale lock and leaves a newer lock of someone else alone', async () => {
    const s = await setup();
    try {
      await fsp.writeFile(path.join(s.tgt, LOCK_FILE), JSON.stringify({ host: 'PC-AHMET', user: 'ahmet', label: 'eski', startedAt: Date.now() - 3 * 3600_000, pid: 1 }));
      const plan = await s.svc.planSend(s.req, 'l2');
      expect(plan.targets[0].lock).toBeUndefined();
      expect(plan.warnings.some((w) => w.includes('ahmet'))).toBe(false);
    } finally {
      s.svc.automation?.stop();
    }
  });
});
