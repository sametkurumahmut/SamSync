import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { mapToRel, joinRoot, commonDir, relIsWithin } from '../src/core/paths';
import { makeFilter } from '../src/core/filter';
import { normalizeConfig, saveConfigFile, loadConfig, DEFAULT_COPY } from '../src/core/config';
import { detectIdentity } from '../src/core/identity';
import { smbRoot } from '../src/core/transport';
import { expandTargetIds } from '../src/core/context';
import { tmpDir } from './helpers';

const win = process.platform === 'win32';

describe('mapToRel', () => {
  it.runIf(win)('uses the longest matching root, case insensitively', () => {
    const roots = ['C:\\E\\repo\\proje', 'C:\\E\\repo\\proje\\trunk\\Deploy', 'D:\\data'];
    expect(mapToRel('c:\\e\\repo\\PROJE\\trunk\\Deploy\\Data\\x.entity', roots)).toMatchObject({ rel: 'Data/x.entity', outside: false });
    expect(mapToRel('C:\\E\\repo\\proje\\a\\b.txt', roots)).toMatchObject({ rel: 'a/b.txt', root: 'C:\\E\\repo\\proje' });
  });
  it.runIf(win)('keeps the drive (or UNC server) as a folder for items outside every root', () => {
    expect(mapToRel('C:\\Fraps\\README.HTM', ['D:\\x']).rel).toBe('C/Fraps/README.HTM');
    expect(mapToRel('\\\\srv\\share\\a\\b.txt', []).rel).toBe('UNC/srv/share/a/b.txt');
  });
  it.runIf(win)('does not match a sibling that merely shares a prefix', () => {
    expect(mapToRel('C:\\data2\\x.txt', ['C:\\data']).outside).toBe(true);
  });
  it('joins rel paths onto Windows and POSIX roots', () => {
    expect(joinRoot('\\\\10.0.0.1\\Sim\\ActiveRelease', 'Data/x.entity')).toBe('\\\\10.0.0.1\\Sim\\ActiveRelease\\Data\\x.entity');
    expect(joinRoot('/mnt/x/', 'a/b')).toBe('/mnt/x/a/b');
    expect(relIsWithin('Data/x', 'data', true)).toBe(true);
    expect(relIsWithin('Database/x', 'Data', true)).toBe(false);
  });
  it.runIf(win)('finds the common folder', () => {
    expect(commonDir(['C:\\a\\b\\c.txt', 'C:\\a\\b\\d\\e.txt'])).toBe('C:\\a\\b');
    expect(commonDir(['C:\\a\\x.txt', 'D:\\b.txt'])).toBe('');
  });
});

describe('filters', () => {
  it('matches names anywhere and paths from the root', () => {
    const f = makeFilter({ excludeFiles: ['*.pdb', 'desktop.ini'], excludeDirs: ['.git', 'Logs'], exclude: ['Data/Temp/'] });
    expect(f.file('bin/app.pdb')).toBe(false);
    expect(f.file('a/Desktop.INI')).toBe(!win ? true : false);
    expect(f.file('bin/app.exe')).toBe(true);
    expect(f.dir('src/.git')).toBe(false);
    expect(f.dir('Logs')).toBe(false);
    expect(f.dir('Data/Temp')).toBe(false);
    expect(f.dir('Other/Data/Temp')).toBe(true);
  });
  it('supports include lists, ** and size / age limits', () => {
    const f = makeFilter({ include: ['**/*.entity', 'readme.md'], minSize: 10, newerThan: 1000 });
    expect(f.file('a/b/c.entity', 20, 2000)).toBe(true);
    expect(f.file('c.entity', 20, 2000)).toBe(true);
    expect(f.file('a/b/c.txt', 20, 2000)).toBe(false);
    expect(f.file('x/readme.md', 20, 2000)).toBe(true);
    expect(f.file('a.entity', 5, 2000)).toBe(false);
    expect(f.file('a.entity', 50, 500)).toBe(false);
  });
});

describe('config', () => {
  const legacy = {
    version: '1.3.2',
    menuTitle: 'Eski menü',
    notepadPlusPlusShortcuts: { 'wizard:last': 'Ctrl+Alt+W' },
    nodes: [
      { id: 'Root', name: 'Root', address: '10.0.0.5', localNames: ['MSI'], localRoots: ['C:\\E\\a', 'C:\\E\\b'], networkRoot: 'proje', enabled: true },
      { id: 'IG1', group: 'U1', name: 'IG1', address: '10.0.0.11', localRoot: 'C:\\Sim\\ActiveRelease', networkRoot: 'Sim\\ActiveRelease', enabled: true },
      { id: 'IG2', group: 'U1', name: 'IG2', address: '10.0.0.12', localRoot: 'C:\\Sim\\ActiveRelease', networkRoot: 'Sim\\ActiveRelease', enabled: false },
    ],
    copy: { retryCount: 2, waitSeconds: 1, backupKeep: 3 },
  };

  it('reads the PowerShell config format', () => {
    const c = normalizeConfig(legacy);
    expect(c.nodes).toHaveLength(3);
    expect(c.nodes[1].localRoots).toEqual(['C:\\Sim\\ActiveRelease']);
    expect(c.nodes[1].group).toBe('U1');
    expect(c.copy.backupKeep).toBe(3);
    expect(c.copy.parallelTargets).toBe(DEFAULT_COPY.parallelTargets);
  });

  it('rejects duplicate ids', () => {
    expect(() => normalizeConfig({ nodes: [legacy.nodes[0], { ...legacy.nodes[0], id: 'root' }] })).toThrow(/benzersiz/);
  });

  it('keeps keys it does not own when saving over a legacy file', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'config.json');
    await fsp.writeFile(file, '\ufeff' + JSON.stringify(legacy, null, 2));
    const c = await loadConfig(file);
    c.nodes[0].name = 'Renamed';
    await saveConfigFile(file, c);
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
    expect(raw.version).toBe('1.3.2');
    expect(raw.menuTitle).toBe('Eski menü');
    expect(raw.notepadPlusPlusShortcuts).toEqual({ 'wizard:last': 'Ctrl+Alt+W' });
    expect(raw.schema).toBe(2);
    expect(raw.nodes[0].name).toBe('Renamed');
    expect(raw.nodes[1].localRoot).toBeUndefined();
    expect(raw.nodes[1].localRoots).toEqual(['C:\\Sim\\ActiveRelease']);
    expect((await loadConfig(file)).nodes).toHaveLength(3);
  });

  it('expands groups, profiles and all, without the local node and disabled ones', () => {
    const c = normalizeConfig({ ...legacy, profiles: [{ name: 'p1', targetIds: ['IG1', 'Root'] }] });
    expect(expandTargetIds(c, ['all'], 'Root').map((n) => n.id)).toEqual(['IG1']);
    expect(expandTargetIds(c, ['group:u1']).map((n) => n.id)).toEqual(['IG1']);
    expect(expandTargetIds(c, ['profile:p1'], 'Root').map((n) => n.id)).toEqual(['IG1']);
  });

  it('builds SMB roots per platform', () => {
    const c = normalizeConfig(legacy);
    expect(smbRoot(c, c.nodes[1], 'win32')).toBe('\\\\10.0.0.11\\Sim\\ActiveRelease');
    expect(smbRoot(c, c.nodes[1], 'darwin')).toBe('/Volumes/Sim/ActiveRelease');
    expect(smbRoot(c, c.nodes[1], 'linux')).toBe('/mnt/10.0.0.11/Sim/ActiveRelease');
  });

  it('identifies this machine by override, env and name', () => {
    const c = normalizeConfig(legacy);
    expect(detectIdentity(c, 'IG1').node?.id).toBe('IG1');
    expect(detectIdentity(c, undefined, { SAMSYNC_NODE_ID: 'root' }).node?.id).toBe('Root');
  });

  it('rejects group names a command line could not carry, like the PowerShell tool', () => {
    expect(() => normalizeConfig({ nodes: [{ ...legacy.nodes[1], group: 'Unit 1' }] })).toThrow(/group/);
    expect(() => normalizeConfig({ nodes: [{ ...legacy.nodes[1], group: 'U1/IG' }] })).toThrow(/group/);
    expect(normalizeConfig({ nodes: [{ ...legacy.nodes[1], group: '  Unit-1.a_b  ' }] }).nodes[0].group).toBe('Unit-1.a_b');
    expect(normalizeConfig({ nodes: [{ ...legacy.nodes[1], group: '  ' }] }).nodes[0].group).toBeUndefined();
  });

  it('matches this machine by <name>.<USERDNSDOMAIN> on a domain', () => {
    const fqdn = `${os.hostname()}.corp.example`;
    const c = normalizeConfig({
      nodes: [
        { id: 'Here', name: 'Here', address: fqdn.toUpperCase(), localRoots: ['C:\\x'], networkRoot: 'x' },
        { id: 'Other', name: 'Other', address: '198.51.100.7', localNames: ['other.corp.example'], localRoots: ['C:\\x'], networkRoot: 'x' },
      ],
    });
    expect(detectIdentity(c, undefined, { USERDNSDOMAIN: 'CORP.EXAMPLE' })).toMatchObject({ method: 'name', node: { id: 'Here' } });
    expect(detectIdentity(c, undefined, {}).node).toBeNull();
    const byLocalName = normalizeConfig({ nodes: [{ id: 'N', name: 'N', address: '198.51.100.8', localNames: [fqdn], localRoots: ['C:\\x'], networkRoot: 'x' }] });
    expect(detectIdentity(byLocalName, undefined, { USERDNSDOMAIN: 'corp.example' }).node?.id).toBe('N');
  });
});
