import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Service } from '../src/core/service';
import { MANIFEST_FILE } from '../src/shared/files';
import { applyOps, readManifest } from '../src/core/manifest';
import { FsTransport } from '../src/core/transport';
import type { SendRequest } from '../src/shared/types';
import { tmpDir, write, pathNode, defaultOptions, read } from './helpers';

async function setup() {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const tgt = path.join(base, 't');
  const ud = path.join(base, 'ud');
  for (const d of [src, tgt, ud]) await fsp.mkdir(d, { recursive: true });
  for (let i = 0; i < 40; i++) await write(path.join(src, i % 2 ? 'odd' : 'even', `f${i}.txt`), `v${i}`);
  await write(path.join(src, 'top.txt'), 'T');
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes: [{ ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] }, pathNode('T', tgt)] }));
  await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: 'Me' }));
  const svc = new Service({ isElectron: false, appVersion: 'test', userDataPath: ud, initialPaths: [], emit: () => undefined });
  await svc.init();
  const req: SendRequest = { sources: [{ kind: 'fs', path: src }], targetIds: ['T'], options: { ...defaultOptions, propagateDeletes: false }, origin: 'send', label: 'manifest' };
  const send = async (label: string) => {
    const plan = await svc.planSend({ ...req, label }, label);
    const d = plan.targets[0].ops.some((o) => o.selected) ? await svc.runPlan(plan, 'default', { notify: false }).done : null;
    return { plan, d };
  };
  return { svc, src, tgt, req, send };
}

describe('target manifest', () => {
  it('is written by a run, used by the next plan after a check, and dropped when the folder changed by hand', async () => {
    const s = await setup();
    try {
      const first = await s.send('ilk');
      expect(first.d?.status).toBe('ok');
      expect(first.plan.targets[0].fromManifest).toBeUndefined();
      const m = await readManifest(new FsTransport(s.tgt));
      expect(m?.subtrees['Data']).toBeTruthy();
      expect(m!.subtrees['Data'].entries.length).toBe(43); // 41 files + 2 folders
      expect(m!.subtrees['Data'].by?.version).toBe('test');

      // nothing changed: the plan trusts the manifest and finds the target up to date
      const second = await s.send('ikinci');
      expect(second.plan.targets[0].fromManifest).toBe(m!.subtrees['Data'].writtenAt);
      expect(second.plan.targets[0].ops).toEqual([]);
      expect(second.d).toBeNull();

      // a source change goes out, and the manifest follows
      await write(path.join(s.src, 'even', 'f0.txt'), 'changed');
      const third = await s.send('üçüncü');
      expect(third.plan.targets[0].fromManifest).toBeTruthy();
      expect(third.plan.targets[0].ops.map((o) => o.rel)).toEqual(['Data/even/f0.txt']);
      expect(third.d?.status).toBe('ok');
      expect(read(path.join(s.tgt, 'Data', 'even', 'f0.txt'))).toBe('changed');
      const m3 = await readManifest(new FsTransport(s.tgt));
      expect(m3!.subtrees['Data'].entries.find((e) => e[0] === 'even/f0.txt')![2]).toBe('changed'.length);

      // someone copied a different file over by hand: the check sees it, the plan walks the folder
      await write(path.join(s.tgt, 'Data', 'odd', 'f1.txt'), 'from a disk');
      const fourth = await s.send('dördüncü');
      expect(fourth.plan.targets[0].fromManifest).toBeUndefined();
      expect(fourth.plan.targets[0].ops.map((o) => o.rel)).toEqual(['Data/odd/f1.txt']);
      expect(fourth.d?.status).toBe('ok');
    } finally {
      s.svc.automation?.stop();
    }
  });

  it('is ignored when too old or when a direct look is asked for', async () => {
    const s = await setup();
    try {
      await s.send('ilk');
      const file = path.join(s.tgt, MANIFEST_FILE);
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      m.subtrees['Data'].writtenAt = Date.now() - 8 * 86400_000;
      fs.writeFileSync(file, JSON.stringify(m));
      const old = await s.svc.planSend({ ...s.req, label: 'eski' }, 'old');
      expect(old.targets[0].fromManifest).toBeUndefined();
      // fresh again, but a comparison must look for itself
      const again = await s.send('yenile');
      expect(again.plan.targets[0].fromManifest).toBeUndefined();
      const direct = await s.svc.planSend({ ...s.req, direct: true, label: 'doğrudan' }, 'direct');
      expect(direct.targets[0].fromManifest).toBeUndefined();
      // the manifest itself is never part of a plan
      expect(direct.targets[0].ops.some((o) => o.rel.includes(MANIFEST_FILE))).toBe(false);
    } finally {
      s.svc.automation?.stop();
    }
  });

  it('applies a run’s operations to the scanned entries', () => {
    const scanned = new Map([
      ['a.txt', { rel: 'a.txt', isDir: false, size: 1, mtimeMs: 1 }],
      ['old', { rel: 'old', isDir: true, size: 0, mtimeMs: 1 }],
      ['old/x.txt', { rel: 'old/x.txt', isDir: false, size: 1, mtimeMs: 1 }],
    ]);
    const out = applyOps(
      scanned,
      'Data',
      [
        { kind: 'copy', rel: 'Data/a.txt', isDir: false, size: 9, mtimeMs: 5 },
        { kind: 'mkdir', rel: 'Data/new', isDir: true, size: 0 },
        { kind: 'copy', rel: 'Data/new/b.txt', isDir: false, size: 2 },
        { kind: 'delete', rel: 'Data/old', isDir: true, size: 0 },
        { kind: 'copy', rel: 'Other/c.txt', isDir: false, size: 2 },
      ],
      100,
    );
    expect([...out.keys()].sort()).toEqual(['a.txt', 'new', 'new/b.txt']);
    expect(out.get('a.txt')).toMatchObject({ size: 9, mtimeMs: 5 });
    expect(out.get('new/b.txt')).toMatchObject({ size: 2, mtimeMs: 100 });
  });
});
