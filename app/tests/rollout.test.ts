import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Service } from '../src/core/service';
import { templateText, fillMachineVars, machineVars } from '../src/core/template';
import type { AgentSettings, NodeConfig, RunDetail, SendPlan, SendRequest } from '../src/shared/types';
import { tmpDir, write, read, pathNode, defaultOptions, sleep } from './helpers';

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

interface World {
  base: string;
  src: string;
  dir: Record<Exclude<Id, 'Me'>, string>;
  svc: Partial<Record<Id, Service>>;
  me: Service;
  stop: () => void;
}

/**
 * A sender ("Me") and a group G of three machines: T (a relay when marked) and PC1, PC2. The machines named in
 * \`running\` run SamSync of their own (an agent, or the relay), with the agent settings given; the others are folders.
 */
async function world(opts: { relayMarked?: boolean; running?: Exclude<Id, 'Me'>[]; copy?: Record<string, unknown>; agent?: Partial<Record<Id, Partial<AgentSettings>>> } = {}): Promise<World> {
  const base = await tmpDir();
  const src = path.join(base, 'me', 'Data');
  const dir = { T: path.join(base, 't'), PC1: path.join(base, 'pc1'), PC2: path.join(base, 'pc2') };
  for (const d of [src, ...Object.values(dir)]) await fsp.mkdir(d, { recursive: true });
  const running = new Set(opts.running ?? []);
  const nodes: NodeConfig[] = [
    { ...pathNode('Me', path.join(base, 'me')), localRoots: [path.join(base, 'me')] },
    { ...pathNode('T', dir.T, { group: 'G', relay: opts.relayMarked || undefined }), localRoots: running.has('T') || opts.relayMarked ? [dir.T] : [] },
    { ...pathNode('PC1', dir.PC1, { group: 'G' }), localRoots: running.has('PC1') ? [dir.PC1] : [] },
    { ...pathNode('PC2', dir.PC2, { group: 'G' }), localRoots: running.has('PC2') ? [dir.PC2] : [] },
  ];
  const cfgFile = path.join(base, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({ schema: 2, nodes, copy: { retryCount: 0, waitSeconds: 0, ...opts.copy } }));
  const side = async (id: Id) => {
    const ud = path.join(base, `ud-${id}`);
    await fsp.mkdir(ud, { recursive: true });
    await fsp.writeFile(path.join(ud, 'settings.json'), JSON.stringify({ configPath: cfgFile, localNodeId: id, agent: { receivePacks: true, notifyOnApply: false, ...opts.agent?.[id] } }));
    const svc = new Service({ isElectron: false, appVersion: '2.5.0', userDataPath: ud, initialPaths: [], emit: () => undefined });
    await svc.init();
    return svc;
  };
  const svc: World['svc'] = { Me: await side('Me') };
  for (const id of running) svc[id] = await side(id);
  for (const id of running) await until(() => fs.existsSync(path.join(dir[id], '_SamSyncRelay', 'alive.json')));
  const stop = () => {
    for (const s of Object.values(svc)) {
      s!.automation?.stop();
      s!.relay?.stop();
    }
  };
  return { base, src, dir, svc, me: svc.Me!, stop };
}

const req = (w: World, targetIds: string[], options: Partial<SendRequest['options']> = {}): SendRequest => ({ sources: [{ kind: 'fs', path: w.src }], targetIds, options: { ...defaultOptions, propagateDeletes: false, ...options }, origin: 'send', label: 'deneme' });

const selectedOf = (plan: SendPlan) => Object.fromEntries(plan.targets.map((tp) => [tp.targetId, tp.ops.filter((o) => o.selected).map((o) => o.id)]));

/** The run as the history keeps it, once it is written. */
const finished = (w: World, id: string): Promise<RunDetail> => until(async () => {
  const d = await w.me.run(id);
  return d?.finishedAt ? d : null;
});

async function send(w: World, r: SendRequest, stages?: { first: string[]; auto: boolean }) {
  const plan = await w.me.planSend(r, `p${Math.random()}`);
  const id = await w.me.executePlan(plan.id, selectedOf(plan), { remember: false, stages });
  return { plan, run: await finished(w, id) };
}

describe('health check of a machine', () => {
  it('comes back from the machine (after applying) and from here (post-copy), and fails the machine when asked to', async () => {
    const w = await world({ running: ['PC1'], agent: { PC1: { afterApply: 'exit 3', afterApplyFails: true } }, copy: { postCommand: 'exit 2', postCommandFails: true } });
    try {
      await write(path.join(w.src, 'a.txt'), 'A');
      const { run } = await send(w, req(w, ['PC1', 'PC2'], { runPostCommand: true }));
      const by = Object.fromEntries(run.targets.map((x) => [x.key, x]));
      expect(by.PC1.check).toMatchObject({ ok: false, code: 3, there: true });
      expect(by.PC1.status).toBe('failed');
      expect(by.PC2.check).toMatchObject({ ok: false, code: 2 });
      expect(by.PC2.status).toBe('failed');
      // without the setting the result only shows
      await w.svc.PC1!.saveSettings({ agent: { receivePacks: true, notifyOnApply: false, afterApply: 'exit 3' } });
      await write(path.join(w.src, 'b.txt'), 'B');
      const again = await send(w, req(w, ['PC1']));
      expect(again.run.targets[0]).toMatchObject({ status: 'ok', check: { ok: false, code: 3 } });
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('staged send', () => {
  it('sends to the first machines, then the rest at a go, by itself, or not at all when the first failed', async () => {
    const w = await world();
    try {
      await write(path.join(w.src, 'a.txt'), 'bir');
      const { run } = await send(w, req(w, ['PC1', 'PC2']), { first: ['PC1'], auto: false });
      expect(run.targets.map((x) => x.key)).toEqual(['PC1']);
      expect(read(path.join(w.dir.PC1, 'Data', 'a.txt'))).toBe('bir');
      expect(read(path.join(w.dir.PC2, 'Data', 'a.txt'))).toBeNull();
      // the stage is decided right after the run is in the history
      expect(await until(() => w.me.stagedSend(run.id))).toMatchObject({ status: 'waiting', firstOk: true, rest: [{ key: 'PC2' }] });
      const next = await w.me.continueStaged(run.id);
      await finished(w, next);
      expect(read(path.join(w.dir.PC2, 'Data', 'a.txt'))).toBe('bir');
      expect((await w.me.stagedSend(run.id))!.status).toBe('continued');
      await expect(w.me.continueStaged(run.id)).rejects.toThrow();

      // by itself once the first went through
      await write(path.join(w.src, 'a.txt'), 'iki!');
      const auto = await send(w, req(w, ['PC1', 'PC2']), { first: ['PC1'], auto: true });
      await until(() => read(path.join(w.dir.PC2, 'Data', 'a.txt')) === 'iki!');
      expect((await until(() => w.me.stagedSend(auto.run.id))).status).toBe('continued');
    } finally {
      w.stop();
    }
    // a first machine whose health check says no stops the send
    const f = await world({ copy: { postCommand: 'exit 1', postCommandFails: true } });
    try {
      await write(path.join(f.src, 'a.txt'), 'x');
      const { run } = await send(f, req(f, ['PC1', 'PC2'], { runPostCommand: true }), { first: ['PC1'], auto: true });
      expect(await until(() => f.me.stagedSend(run.id))).toMatchObject({ status: 'stopped', firstOk: false });
      expect(read(path.join(f.dir.PC2, 'Data', 'a.txt'))).toBeNull();
    } finally {
      f.stop();
    }
  }, 60000);
});

describe('relay takeover', () => {
  it('makes a machine of the group that runs SamSync the relay when the relay does not', async () => {
    const w = await world({ relayMarked: true, running: ['PC1'], copy: { relayTakeover: true } });
    try {
      // T is marked as relay but runs nothing
      fs.rmSync(path.join(w.dir.T, '_SamSyncRelay'), { recursive: true, force: true });
      await write(path.join(w.src, 'a.txt'), 'A');
      const plan = await w.me.planSend(req(w, ['T', 'PC1', 'PC2']), 'p');
      expect(plan.targets.map((tp) => [tp.targetId, tp.via ?? '-'])).toEqual([
        ['T', '-'],
        ['PC1', '-'],
        ['PC2', 'PC1'],
      ]);
      expect(plan.warnings.some((x) => x.includes('PC1'))).toBe(true);
      const id = await w.me.executePlan(plan.id, selectedOf(plan), { remember: false });
      const run = await finished(w, id);
      expect(run.status).toBe('ok');
      for (const d of Object.values(w.dir)) expect(read(path.join(d, 'Data', 'a.txt'))).toBe('A');
      expect(run.targets.find((x) => x.key === 'PC2')!.via).toBe('PC1');
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('stage and switch at once', () => {
  it('puts every file in place together, and none when one did not come', async () => {
    const w = await world();
    try {
      await write(path.join(w.dir.PC2, 'Data', 'a.txt'), 'eski', new Date('2026-01-01T00:00:00Z'));
      await write(path.join(w.src, 'a.txt'), 'yeni', new Date('2026-02-01T00:00:00Z'));
      await write(path.join(w.src, 'b.txt'), 'B');
      const plan = await w.me.planSend(req(w, ['PC2'], { stageSwitch: true }), 'p');
      // one of the files is gone by the time the run starts
      await fsp.rm(path.join(w.src, 'b.txt'));
      const run = await finished(w, await w.me.executePlan(plan.id, selectedOf(plan), { remember: false }));
      expect(run.status).toBe('failed');
      expect(read(path.join(w.dir.PC2, 'Data', 'a.txt'))).toBe('eski');
      expect(fs.readdirSync(path.join(w.dir.PC2, 'Data')).filter((n) => n.endsWith('.samsync-tmp'))).toEqual([]);
      await write(path.join(w.src, 'b.txt'), 'B');
      const ok = await send(w, req(w, ['PC2'], { stageSwitch: true }));
      expect(ok.run.status).toBe('ok');
      expect(read(path.join(w.dir.PC2, 'Data', 'a.txt'))).toBe('yeni');
      expect(read(path.join(w.dir.PC2, 'Data', 'b.txt'))).toBe('B');
      expect(ok.run.log.some((l) => /yerine konuyor|in place at once/.test(l.message))).toBe(true);
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('live drift', () => {
  it('shows on the card soon after a file is changed by hand on a machine that watches its sent folders', async () => {
    const w = await world({ running: ['PC1'], agent: { PC1: { watchDrift: true } } });
    try {
      await write(path.join(w.src, 'a.txt'), 'A');
      await send(w, req(w, ['PC1']));
      await sleep(4000);
      expect((await w.svc.PC1!.relayState()).drift?.changed ?? 0).toBe(0);
      await write(path.join(w.dir.PC1, 'Data', 'a.txt'), 'elle değişti');
      const drift = await until(async () => {
        const d = (await w.svc.PC1!.relayState()).drift;
        return d && d.changed === 1 ? d : null;
      });
      expect(drift.sample[0]).toContain('Data/a.txt');
      const [p] = await w.me.probe(['PC1']);
      expect(p.agent?.drift?.changed).toBe(1);
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('release diff', () => {
  it('lists what the sends after a point changed on its machines, by the net change, and writes a report', async () => {
    const w = await world();
    try {
      await write(path.join(w.src, 'a.txt'), 'A');
      await write(path.join(w.src, 'b.txt'), 'B');
      const first = await send(w, req(w, ['PC2']));
      await write(path.join(w.src, 'a.txt'), 'AAAA');
      await fsp.rm(path.join(w.src, 'b.txt'));
      await write(path.join(w.src, 'c.txt'), 'C');
      await send(w, req(w, ['PC2'], { mode: 'mirror' }));
      const d = await w.me.releaseDiff(first.run.id, null);
      expect(d.runs).toBe(1);
      expect(d.files.map((f) => [f.rel, f.change])).toEqual([
        ['Data/a.txt', 'changed'],
        ['Data/b.txt', 'removed'],
        ['Data/c.txt', 'added'],
      ]);
      expect(d.counts).toEqual({ added: 1, changed: 1, removed: 1 });
      for (const fmt of ['csv', 'html'] as const) expect(fs.readFileSync(await w.me.exportReleaseDiff(first.run.id, null, fmt), 'utf8')).toContain('Data/c.txt');
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('machine variables', () => {
  it('are filled in only in UTF-8 text that has them', () => {
    const vars = machineVars(pathNode('PC-1', 'x', { name: 'PC-1 - 10.0.0.5', address: '10.0.0.5', group: 'Lab' }));
    const text = templateText(Buffer.from('id={{machine.id}} t={{ machine.title }} a={{machine.address}} g={{machine.group}}'));
    expect(fillMachineVars(text!, vars).toString()).toBe('id=PC-1 t=PC-1 a=10.0.0.5 g=Lab');
    expect(templateText(Buffer.from('nothing here'))).toBeNull();
    expect(templateText(Buffer.from([0x69, 0x64, 0x3d, 0xfe, 0x7b, 0x7b, 0x6d]))).toBeNull();
  });

  it('go filled in per machine, directly and through a relay, with the machine folder too', async () => {
    const w = await world({ relayMarked: true, running: ['T'], copy: { templateFiles: ['*.ini'], machineFolder: '_machines' } });
    try {
      await write(path.join(w.src, 'app.ini'), 'id={{machine.id}}\n');
      await write(path.join(w.src, 'common.txt'), 'ortak');
      await write(path.join(w.src, '_machines', 'PC1', 'only.txt'), 'yalnız pc1');
      await write(path.join(w.src, '_machines', 'T', 'common.txt'), 'rölenin');
      await write(path.join(w.src, '_machines', 'T', 'relay.cfg'), 'yalnız röle');
      const { plan, run } = await send(w, req(w, ['T', 'PC1', 'PC2']));
      expect(plan.targets.map((tp) => [tp.targetId, tp.via ?? '-'])).toEqual([
        ['T', '-'],
        ['PC1', 'T'],
        ['PC2', 'T'],
      ]);
      expect(run.status).toBe('ok');
      expect(read(path.join(w.dir.T, 'Data', 'app.ini'))).toBe('id=T\n');
      expect(read(path.join(w.dir.T, 'Data', 'common.txt'))).toBe('rölenin');
      expect(read(path.join(w.dir.T, 'Data', 'relay.cfg'))).toBe('yalnız röle');
      expect(read(path.join(w.dir.PC1, 'Data', 'app.ini'))).toBe('id=PC1\n');
      expect(read(path.join(w.dir.PC1, 'Data', 'common.txt'))).toBe('ortak');
      expect(read(path.join(w.dir.PC1, 'Data', 'only.txt'))).toBe('yalnız pc1');
      expect(fs.existsSync(path.join(w.dir.PC1, 'Data', 'relay.cfg'))).toBe(false);
      expect(read(path.join(w.dir.PC2, 'Data', 'app.ini'))).toBe('id=PC2\n');
      expect(read(path.join(w.dir.PC2, 'Data', 'common.txt'))).toBe('ortak');
      expect(fs.existsSync(path.join(w.dir.PC2, 'Data', 'only.txt'))).toBe(false);
      // the relay's stash is gone again
      expect(fs.existsSync(path.join(w.dir.T, '_SamSyncRelay', 'stash', plan.id))).toBe(false);
      expect(fs.readdirSync(path.join(w.dir.T, '_SamSyncRelay', 'stash'))).toEqual([]);
      // nothing differs any more
      const again = await w.me.planSend(req(w, ['T']), 'p2');
      expect(again.targets[0].ops.filter((o) => o.selected).map((o) => o.rel)).toEqual([]);
    } finally {
      w.stop();
    }
  }, 60000);
});

describe('a pack file to a machine running SamSync', () => {
  it('goes into the machine’s own pack and is applied there', async () => {
    const w = await world({ running: ['PC1'] });
    try {
      await write(path.join(w.src, 'a.txt'), 'paketten');
      const packDir = await tmpDir();
      const r = await w.me.writePack(req(w, ['PC1']), packDir, 'w');
      const { plan, run } = await send(w, { ...req(w, ['PC1']), sources: [{ kind: 'fs', path: r.file }] });
      expect(plan.targets[0].agent).toBe(true);
      expect(run.status).toBe('ok');
      expect(read(path.join(w.dir.PC1, 'Data', 'a.txt'))).toBe('paketten');
    } finally {
      w.stop();
    }
  }, 60000);
});
