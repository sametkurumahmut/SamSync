import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Service, type HostAdapter } from '../src/core/service';
import { FsTransport } from '../src/core/transport';
import { agentChecks } from '../src/core/shares';
import { askAgent, answerAsks } from '../src/core/agentask';
import { driftOf } from '../src/core/drift';
import { makeFilter } from '../src/core/filter';
import { scanTree } from '../src/core/scan';
import { saveManifestSubtree } from '../src/core/manifest';
import { holdersUnder, closePrograms } from '../src/core/holders';
import { magicPacket, wake } from '../src/core/wol';
import { normalizeMac } from '../src/shared/machine';
import { compareVersions } from '../src/shared/version';
import { normalizeConfig } from '../src/core/config';
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

const smbNode = (networkRoot: string): NodeConfig => ({ id: 'A', name: 'A', address: 'host-a', localRoots: [], networkRoot, enabled: true });

describe('agent setup check', () => {
  const shares = new Map([['data', 'E:\\Data']]);
  it('finds a first local root that is not where the share leads, with the fix, on a relay or where senders wrote', () => {
    const c = agentChecks(smbNode('Data\\Release'), 'D:\\Data\\Release', false, shares, true);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ level: 'error', fixRoot: 'E:\\Data\\Release' });
    expect(agentChecks(smbNode('Data\\Release'), 'D:\\Data\\Release', true, shares, false, (dir) => dir === 'E:\\Data\\Release')[0].fixRoot).toBe('E:\\Data\\Release');
    // a machine that only sends: its roots are where its files come from, nobody writes through its share
    expect(agentChecks(smbNode('Data\\Release'), 'D:\\Data\\Release', true, shares)).toEqual([]);
  });
  it('is quiet when the root is the share folder (case and a trailing slash do not matter)', () => {
    expect(agentChecks(smbNode('Data\\Release'), 'e:\\data\\release\\', true, shares)).toEqual([]);
    expect(agentChecks(smbNode('D$\\Apps'), 'D:\\Apps', true, new Map())).toEqual([]);
  });
  it('says when the root is missing or the share is not there, and stays quiet where it cannot tell', () => {
    expect(agentChecks(smbNode('Data\\Release'), 'E:\\Data\\Release', false, shares)[0].level).toBe('error');
    // a missing share matters on a relay; a machine that only sends has none for itself
    expect(agentChecks(smbNode('Other\\X'), 'E:\\X', true, shares, true)[0].level).toBe('warn');
    expect(agentChecks(smbNode('Other\\X'), 'E:\\X', true, shares)).toEqual([]);
    expect(agentChecks(smbNode('Data\\Release'), 'D:\\Somewhere', true, null)).toEqual([]);
    expect(agentChecks(smbNode('Data'), undefined, false, shares)[0].level).toBe('error');
  });
});

describe('questions to SamSync on a target', () => {
  it('are answered through the share, errors come back, and nobody answering is told apart', async () => {
    const dir = await tmpDir();
    const tgt = new FsTransport(dir);
    const busy = new Set<string>();
    const timer = setInterval(() => void answerAsks(dir, async (a) => (a.kind === 'holders' ? { programs: [], canClose: false, asked: a.rels } : Promise.reject(new Error('olmaz'))), busy), 40);
    try {
      expect(await askAgent(tgt, { kind: 'holders', rels: ['x/y.dll'] })).toEqual({ programs: [], canClose: false, asked: ['x/y.dll'] });
      await expect(askAgent(tgt, { kind: 'drift' })).rejects.toThrow('olmaz');
    } finally {
      clearInterval(timer);
    }
    await expect(askAgent(tgt, { kind: 'drift' }, { pickupMs: 300 })).rejects.toMatchObject({ unanswered: true });
    // nothing is left behind
    expect(fs.readdirSync(path.join(dir, '_SamSyncRelay', 'asks'))).toEqual([]);
  });
});

describe('drift', () => {
  it('lists what changed, came or went after the manifest was written; a folder that went counts once', async () => {
    const root = await tmpDir();
    await write(path.join(root, 'Data', 'a.txt'), 'A');
    await write(path.join(root, 'Data', 'b.txt'), 'B');
    await write(path.join(root, 'Data', 'sub', 'c.txt'), 'C');
    const tgt = new FsTransport(root);
    const filter = makeFilter({ excludeFiles: ['samsync-*'], excludeDirs: [], alwaysExcludeDirs: ['_SamSyncRelay'] });
    const scan = await scanTree(tgt, 'Data', { filter, caseInsensitive: true });
    await saveManifestSubtree(tgt, 'Data', scan.entries, { host: 'h' }, 'Sürüm 1');
    const time = { toleranceMs: 2000, ignoreDstShift: true };
    expect((await driftOf(tgt, filter, time, '_Yedek')).subtrees[0].counts).toEqual({ changed: 0, added: 0, removed: 0 });

    await write(path.join(root, 'Data', 'a.txt'), 'AAAA');
    await fsp.rm(path.join(root, 'Data', 'b.txt'));
    await fsp.rm(path.join(root, 'Data', 'sub'), { recursive: true });
    await write(path.join(root, 'Data', 'd.txt'), 'D');
    await write(path.join(root, 'Data', 'yeni', 'e.txt'), 'E');
    const r = await driftOf(tgt, filter, time, '_Yedek');
    expect(r.manifest).toBe(true);
    const d = r.subtrees[0];
    expect(d.label).toBe('Sürüm 1');
    expect(d.changed).toEqual(['Data/a.txt']);
    expect(d.removed).toEqual(['Data/b.txt', 'Data/sub']);
    expect(d.added).toEqual(['Data/d.txt', 'Data/yeni']);
    expect((await driftOf(new FsTransport(await tmpDir()), filter, time, '_Yedek')).manifest).toBe(false);
  });
});

describe('wake-on-LAN', () => {
  it('reads MAC addresses written any common way and builds the magic packet', async () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-0F')).toBe('aa:bb:cc:dd:ee:0f');
    expect(normalizeMac('aabb.ccdd.ee0f')).toBe('aa:bb:cc:dd:ee:0f');
    expect(normalizeMac('00:00:00:00:00:00')).toBeNull();
    expect(normalizeMac('nope')).toBeNull();
    const p = magicPacket('aa:bb:cc:dd:ee:0f');
    expect(p.length).toBe(102);
    expect(p.subarray(0, 6).every((b) => b === 0xff)).toBe(true);
    expect(p.subarray(96).toString('hex')).toBe('aabbccddee0f');
    expect(await wake(['aa:bb:cc:dd:ee:0f'], ['127.0.0.1'], 1)).toBe(2);
    await expect(wake(['x'], ['127.0.0.1'], 1)).rejects.toThrow();
  });
  it('keeps a MAC address of the configuration, written the one way', () => {
    const cfg = normalizeConfig({ schema: 2, nodes: [{ ...pathNode('A', 'C:\\x'), mac: 'AA-BB-CC-DD-EE-0F' }] } as never);
    expect(cfg.nodes[0].mac).toBe('aa:bb:cc:dd:ee:0f');
  });
});

describe('versions', () => {
  it('compare by their numbers', () => {
    expect(compareVersions('2.4.10', '2.5.0')).toBeLessThan(0);
    expect(compareVersions('v2.5.0', '2.5.0')).toBe(0);
    expect(compareVersions('2.5.1', '2.5.0-beta')).toBeGreaterThan(0);
  });
});

describe.runIf(process.platform === 'win32')('programs holding files (Windows)', () => {
  it('finds the program that holds a file and closes it', async () => {
    const dir = await tmpDir();
    const f = path.join(dir, 'held.txt');
    fs.writeFileSync(f, 'x');
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `$s=[IO.File]::Open('${f}','Open','ReadWrite','None'); Start-Sleep 60`], { stdio: 'ignore' });
    try {
      // held once a look of our own is refused (and that look closes again at once, so it never holds the file itself)
      await until(() => {
        try {
          fs.closeSync(fs.openSync(f, 'r+'));
          return false;
        } catch {
          return true;
        }
      }, 30000);
      const h = await holdersUnder(dir, ['held.txt']);
      const mine = h.find((x) => x.pid === ps.pid);
      expect(mine).toBeTruthy();
      expect(mine!.rels).toEqual(['held.txt']);
      expect(mine!.closable).toBe(true);
      const r = await closePrograms([mine!]);
      expect(r.closed).toEqual([ps.pid]);
    } finally {
      ps.kill();
    }
  }, 60000);
});

// ---------------------------------------------------------------- with SamSync on both sides

interface Sides {
  base: string;
  src: string;
  me: Service;
  agent: Service;
  pc1: string;
  pc2: string;
  installed: string[];
  stop: () => void;
}

/** A sender ("Me"), an agent ("PC1", SamSync running there) and a plain folder ("PC2"), sharing one configuration. */
async function sides(opts: { machineFolder?: string; acceptUpdates?: boolean } = {}): Promise<Sides> {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const pc1 = path.join(base, 'pc1');
  const pc2 = path.join(base, 'pc2');
  for (const d of [src, pc1, pc2]) await fsp.mkdir(d, { recursive: true });
  const nodes: NodeConfig[] = [
    { ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] },
    { ...pathNode('PC1', pc1, { group: 'G' }), localRoots: [pc1] },
    pathNode('PC2', pc2, { group: 'H' }),
  ];
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0, machineFolder: opts.machineFolder } }));
  const installed: string[] = [];
  const side = async (id: string, host: Partial<HostAdapter> = {}, agent?: object) => {
    const ud = path.join(base, `ud-${id}`);
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: id, agent }));
    const svc = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: () => undefined, ...host });
    await svc.init();
    return svc;
  };
  const me = await side('Me');
  const agent = await side(
    'PC1',
    {
      canInstallUpdates: () => true,
      installUpdate: (file) => {
        installed.push(fs.readFileSync(file, 'utf8'));
        return true;
      },
    },
    { receivePacks: true, notifyOnApply: false, acceptUpdates: opts.acceptUpdates },
  );
  await until(() => fs.existsSync(path.join(pc1, '_SamSyncRelay', 'alive.json')));
  const stop = () => {
    for (const s of [me, agent]) {
      s.automation?.stop();
      s.relay?.stop();
    }
  };
  return { base, src, me, agent, pc1, pc2, installed, stop };
}

const req = (src: string, extra: Partial<SendRequest> = {}): SendRequest => ({ sources: [{ kind: 'fs', path: src }], targetIds: ['PC1', 'PC2'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'deneme', ...extra });

async function send(s: Sides, r: SendRequest) {
  const plan = await s.me.planSend(r, `p${Math.random()}`);
  const run = await s.me.runPlan(plan, 'default', { notify: false }).done;
  // the history is written right after the run ends
  await until(async () => !!(await s.me.run(run.id)));
  return { plan, run };
}

describe('agents', () => {
  it('say who they are in the heartbeat: version, role, root, network cards', async () => {
    const s = await sides();
    try {
      const [p] = await s.me.probe(['PC1']);
      expect(p.agent).toMatchObject({ version: '2.5.0', role: 'agent', alive: true, root: s.pc1, updates: false });
      expect(p.agent!.asks).toEqual(expect.arrayContaining(['holders', 'close', 'drift']));
      expect(Array.isArray(p.agent!.macs)).toBe(true);
    } finally {
      s.stop();
    }
  }, 30000);

  it('install a newer setup put on their share once they accept updates, and refuse it otherwise', async () => {
    const setup = path.join(await tmpDir(), 'SamSync-Setup-9.9.9.exe');
    fs.writeFileSync(setup, 'kurulum');
    const off = await sides();
    try {
      const r = await off.me.updateAgents(['PC1'], 'u0', setup);
      expect(r).toEqual([{ nodeId: 'PC1', ok: true }]);
      await until(() => fs.existsSync(path.join(off.pc1, '_SamSyncRelay', 'update', 'result.json')));
      const res = JSON.parse(fs.readFileSync(path.join(off.pc1, '_SamSyncRelay', 'update', 'result.json'), 'utf8'));
      expect(res.ok).toBe(false);
      expect(off.installed).toEqual([]);
      expect((await off.agent.relayState()).lastError?.text).toBeTruthy();
    } finally {
      off.stop();
    }
    const on = await sides({ acceptUpdates: true });
    try {
      const [p] = await on.me.probe(['PC1']);
      expect(p.agent!.updates).toBe(true);
      await on.me.updateAgents(['PC1'], 'u1', setup);
      await until(() => on.installed.length > 0);
      expect(on.installed).toEqual(['kurulum']);
      const dir = path.join(on.pc1, '_SamSyncRelay', 'update');
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'))).toMatchObject({ ok: true, installing: true, version: '9.9.9' });
      // the order and the setup are gone, so the new version does not install it again
      expect(fs.readdirSync(dir).sort()).toEqual(['result.json']);
      // the same version or an older one is not installed
      fs.renameSync(setup, path.join(path.dirname(setup), 'SamSync-Setup-2.4.0.exe'));
      await on.me.updateAgents(['PC1'], 'u2', path.join(path.dirname(setup), 'SamSync-Setup-2.4.0.exe'));
      await until(() => !fs.existsSync(path.join(dir, 'order.json')));
      await sleep(300);
      expect(on.installed).toHaveLength(1);
    } finally {
      on.stop();
    }
  }, 60000);

  it('check drift on their own disk; plain folders are walked over the share', async () => {
    const s = await sides();
    try {
      await write(path.join(s.src, 'a.txt'), 'A');
      await write(path.join(s.src, 'b.txt'), 'B');
      const { run } = await send(s, req(s.src));
      expect(run.status).toBe('ok');
      let reports = await s.me.driftCheck(['PC1', 'PC2'], 'd1');
      expect(reports.map((r) => [r.nodeId, r.manifest, r.changed + r.added + r.removed])).toEqual([
        ['PC1', true, 0],
        ['PC2', true, 0],
      ]);
      await write(path.join(s.pc1, 'Data', 'a.txt'), 'elle değişti');
      await write(path.join(s.pc2, 'Data', 'extra.txt'), 'X');
      reports = await s.me.driftCheck(['PC1', 'PC2'], 'd2');
      const by = Object.fromEntries(reports.map((r) => [r.nodeId, r]));
      expect(by.PC1).toMatchObject({ byAgent: true, changed: 1, added: 0, removed: 0 });
      expect(by.PC2.byAgent).toBeUndefined();
      expect(by.PC2).toMatchObject({ changed: 0, added: 1, removed: 0 });
      expect(await s.me.lastDrift()).toEqual(reports);
    } finally {
      s.stop();
    }
  }, 30000);

  it('restore the files a pack replaced when the send is undone (not remove them)', async () => {
    const s = await sides();
    try {
      await write(path.join(s.pc1, 'Data', 'a.txt'), 'eski', new Date('2026-01-01T00:00:00Z'));
      await write(path.join(s.src, 'a.txt'), 'yeni', new Date('2026-02-01T00:00:00Z'));
      await write(path.join(s.src, 'b.txt'), 'B');
      const { plan, run } = await send(s, req(s.src, { targetIds: ['PC1'], options: { ...defaultOptions, backup: true } }));
      expect(plan.targets[0].agent).toBe(true);
      expect(run.status).toBe('ok');
      expect(read(path.join(s.pc1, 'Data', 'a.txt'))).toBe('yeni');
      expect(run.results.find((r) => r.rel === 'Data/a.txt')?.backedUp).toBe(true);
      const undo = await s.me.restoreRun(run.id, false);
      await until(async () => (await s.me.runs()).some((r) => r.id === undo && r.finishedAt));
      expect(read(path.join(s.pc1, 'Data', 'a.txt'))).toBe('eski');
      expect(fs.existsSync(path.join(s.pc1, 'Data', 'b.txt'))).toBe(false);
    } finally {
      s.stop();
    }
  }, 30000);

  it('go back to a release point only on that point’s machines', async () => {
    const s = await sides();
    try {
      await write(path.join(s.src, 'a.txt'), 'v1', new Date('2026-01-01T00:00:00Z'));
      const point = await send(s, req(s.src, { targetIds: ['PC1'], options: { ...defaultOptions, backup: true } }));
      expect(point.run.status).toBe('ok');
      await write(path.join(s.src, 'a.txt'), 'v2 sonra', new Date('2026-02-01T00:00:00Z'));
      const later = await send(s, req(s.src, { options: { ...defaultOptions, backup: true } }));
      expect(later.run.status).toBe('ok');
      expect(read(path.join(s.pc2, 'Data', 'a.txt'))).toBe('v2 sonra');
      const r = await s.me.restoreToTag(point.run.id, false);
      expect(r).toEqual({ restored: 1, skipped: [] });
      expect(read(path.join(s.pc1, 'Data', 'a.txt'))).toBe('v1');
      // PC2 was not in the release point: the later send stays there
      expect(read(path.join(s.pc2, 'Data', 'a.txt'))).toBe('v2 sonra');
    } finally {
      s.stop();
    }
  }, 30000);
});

describe('machine folder', () => {
  it('lays each machine’s and group’s files over the common ones, for them only, and never sends the folder itself', async () => {
    const s = await sides({ machineFolder: '_machines' });
    try {
      await write(path.join(s.src, 'common.txt'), 'ortak');
      await write(path.join(s.src, 'app.ini'), 'genel');
      await write(path.join(s.src, '_machines', 'PC1', 'app.ini'), 'pc1 için');
      await write(path.join(s.src, '_machines', 'PC1', 'only', 'pc1.txt'), 'yalnız pc1');
      await write(path.join(s.src, '_machines', 'H', 'group.txt'), 'H grubu');
      const { plan, run } = await send(s, req(s.src));
      const ops = Object.fromEntries(plan.targets.map((tp) => [tp.targetId, tp.ops.filter((o) => o.kind === 'copy').map((o) => o.rel).sort()]));
      expect(ops.PC1).toEqual(['Data/app.ini', 'Data/common.txt', 'Data/only/pc1.txt']);
      expect(ops.PC2).toEqual(['Data/app.ini', 'Data/common.txt', 'Data/group.txt']);
      expect(plan.targets.flatMap((tp) => tp.ops).some((o) => o.rel.includes('_machines'))).toBe(false);
      expect(plan.targets[0].ops.find((o) => o.rel === 'Data/app.ini')?.note).toBeTruthy();
      expect(run.status).toBe('ok');
      expect(read(path.join(s.pc1, 'Data', 'app.ini'))).toBe('pc1 için');
      expect(read(path.join(s.pc2, 'Data', 'app.ini'))).toBe('genel');
      expect(read(path.join(s.pc2, 'Data', 'group.txt'))).toBe('H grubu');
      expect(fs.existsSync(path.join(s.pc1, 'Data', '_machines'))).toBe(false);
      // a mirror keeps a machine's own files: they are part of what it gets
      const again = await s.me.planSend(req(s.src, { options: { ...defaultOptions, mode: 'mirror' } }), 'p2');
      expect(again.targets.flatMap((tp) => tp.ops).filter((o) => o.selected).map((o) => `${o.kind}:${o.rel}`)).toEqual([]);
    } finally {
      s.stop();
    }
  }, 30000);
});

describe('all or nothing', () => {
  it('puts a machine back as it was when its send fails partway', async () => {
    const s = await sides();
    try {
      await write(path.join(s.pc2, 'Data', 'a.txt'), 'eski', new Date('2026-01-01T00:00:00Z'));
      await write(path.join(s.src, 'a.txt'), 'yeni', new Date('2026-02-01T00:00:00Z'));
      await write(path.join(s.src, 'b.txt'), 'B');
      const r = req(s.src, { targetIds: ['PC2'], options: { ...defaultOptions, rollbackOnFailure: true } });
      const plan = await s.me.planSend(r, 'p');
      // the second file goes missing between the review and the run: the send fails halfway
      await fsp.rm(path.join(s.src, 'b.txt'));
      const run = await s.me.runPlan(plan, 'default', { notify: false }).done;
      expect(run.status).toBe('partial');
      await until(() => read(path.join(s.pc2, 'Data', 'a.txt')) === 'eski');
      await until(async () => (await s.me.runs()).some((x) => x.origin === 'restore' && !!x.finishedAt));
    } finally {
      s.stop();
    }
  }, 30000);
});
