import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Service } from '../src/core/service';
import { tmpDir, pathNode } from './helpers';

describe('speed test', () => {
  it('writes a few MB to a machine, reads them back, removes them and reports the pace', async () => {
    const base = await tmpDir();
    const tgt = path.join(base, 't');
    const ud = path.join(base, 'ud');
    await fsp.mkdir(tgt, { recursive: true });
    await fsp.mkdir(ud, { recursive: true });
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [pathNode('Me', path.join(base, 'me')), pathNode('T', tgt)] }));
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    try {
      const r = await svc.speedTest('T');
      expect(r.nodeId).toBe('T');
      expect(r.bytes).toBe(3 * 1024 * 1024);
      expect(r.writeMBps).toBeGreaterThan(0);
      expect(r.readMBps).toBeGreaterThan(0);
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(fs.readdirSync(tgt)).toEqual([]);
      await expect(svc.speedTest('nope')).rejects.toThrow();
    } finally {
      svc.automation?.stop();
    }
  });
});
