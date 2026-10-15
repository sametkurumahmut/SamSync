import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import { tmpDir, read, pathNode } from './helpers';

async function service() {
  const base = await tmpDir();
  const ud = path.join(base, 'ud');
  await fsp.mkdir(ud, { recursive: true });
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, menuTitle: 'Eski', nodes: [pathNode('A', path.join(base, 'a'))] }, null, 2));
  await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile }));
  const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
  await svc.init();
  return { svc, base, cfgFile };
}

describe('configuration as text', () => {
  it('saves edited text as written, after checking it, and reloads it', async () => {
    const { svc, base, cfgFile } = await service();
    try {
      const text = await svc.configText();
      expect(text).toContain('"menuTitle": "Eski"');
      const edited = text.replace('"nodes": [', `"nodes": [\n    ${JSON.stringify(pathNode('B', path.join(base, 'b')))},`);
      const boot = await svc.saveConfigText(edited);
      expect(boot.config.nodes.map((n) => n.id)).toEqual(['B', 'A']);
      expect(read(cfgFile)).toBe(edited.endsWith('\n') ? edited : `${edited}\n`);
    } finally {
      svc.automation?.stop();
    }
  });

  it('refuses broken JSON and an invalid configuration, leaving the file alone', async () => {
    const { svc, cfgFile } = await service();
    try {
      const before = read(cfgFile);
      await expect(svc.saveConfigText('{ "nodes": [ }')).rejects.toThrow(/JSON/);
      await expect(svc.saveConfigText(JSON.stringify({ nodes: [{ id: 'a b' }] }))).rejects.toThrow();
      expect(read(cfgFile)).toBe(before);
    } finally {
      svc.automation?.stop();
    }
  });

  it('exports a copy', async () => {
    const { svc, base, cfgFile } = await service();
    try {
      const dest = path.join(base, 'copy.json');
      await svc.exportConfig(dest);
      expect(read(dest)).toBe(read(cfgFile));
    } finally {
      svc.automation?.stop();
    }
  });
});
