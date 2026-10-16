import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Service } from '../src/core/service';
import { tmpDir, pathNode } from './helpers';

describe('diagnostics folder', () => {
  it('collects the logs, the configuration, the settings and a summary, never the secrets', async () => {
    const base = await tmpDir();
    const ud = path.join(base, 'ud');
    await fsp.mkdir(ud, { recursive: true });
    const cfgFile = path.join(base, 'config.json');
    await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [pathNode('Me', path.join(base, 'me'))] }));
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
    await fsp.writeFile(path.join(ud, 'secrets.json'), JSON.stringify({ T: 'gizli' }));
    const out = path.join(base, 'out');
    await fsp.mkdir(out, { recursive: true });
    let shown = '';
    const svc = new Service({
      isElectron: false,
      appVersion: 'test',
      userDataPath: ud,
      initialPaths: [],
      emit: () => undefined,
      pick: async () => [out],
      showInFolder: async (p) => {
        shown = p;
      },
    });
    await svc.init();
    try {
      const dir = await svc.exportDiagnostics();
      expect(dir).toBeTruthy();
      expect(shown).toBe(dir);
      const names = fs.readdirSync(dir!);
      expect(names).toContain('config.json');
      expect(names).toContain('settings.json');
      expect(names).toContain('about.json');
      expect(names.some((n) => n.endsWith('.log'))).toBe(true);
      expect(names).not.toContain('secrets.json');
      const about = JSON.parse(fs.readFileSync(path.join(dir!, 'about.json'), 'utf8'));
      expect(about.identity.node).toBe('Me');
      expect(about.relay.active).toBe(false);
      expect(JSON.stringify(about)).not.toContain('gizli');
      // no folder picked: nothing written
      (svc as unknown as { host: { pick: () => Promise<string[]> } }).host.pick = async () => [];
      expect(await svc.exportDiagnostics()).toBeNull();
    } finally {
      svc.automation?.stop();
    }
  });
});
