// Relay: the sender writes a job file into _SamSyncRelay/jobs on the relay's share once its own copy there
// is done; SamSync on the relay picks the job up, sends the files on from its local disk to the machines
// named in it and writes _SamSyncRelay/results/<id>.json; the sender waits for that and shows the outcome.
// Both sides see the same files: the sender through the share, the relay through its local root.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { NodeConfig, RunDetail, SendOptions, SendPlan, SendRequest, SourceSpec } from '../shared/types';
import { RELAY_FOLDER, type RelayJob, type RelayResult, type RelayTargetResult } from '../shared/relay';
import type { CoreContext } from './context';
import type { ExecGroup, ExecOp, RunHandle } from './executor';
import { FsTransport, type Transport } from './transport';
import { buildSendPlan } from './plan';
import { relJoin } from './paths';
import { CancelToken, errMessage, newId, sleep } from './util';
import { t } from '../shared/i18n';

const JOBS = relJoin(RELAY_FOLDER, 'jobs');
const RESULTS = relJoin(RELAY_FOLDER, 'results');
/** Results older than this are removed by the relay. */
const RESULT_KEEP_MS = 2 * 86400_000;

export class RelayError extends Error {
  constructor(
    message: string,
    /** The relay never acknowledged the job: SamSync is not running there. */
    readonly unanswered: boolean,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

async function writeJson(tgt: Transport, rel: string, value: unknown): Promise<void> {
  const tmp = `${rel}.${newId()}.tmp`;
  const { Readable } = await import('node:stream');
  await tgt.writeStream(tmp, Readable.from([Buffer.from(JSON.stringify(value, null, 1), 'utf8')]));
  await tgt.rename(tmp, rel);
}

async function readJson<T>(tgt: Transport, rel: string): Promise<T | null> {
  if (!(await tgt.stat(rel))) return null;
  const chunks: Buffer[] = [];
  for await (const c of await tgt.readStream(rel)) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null; // half written: the next look gets the whole file
  }
}

// ------------------------------------------------------------------ the sender's side

export interface RelayWait {
  cancel: CancelToken;
  /** How long the relay may take to pick the job up (SamSync must be running there). */
  ackMs: number;
  /** How long the whole fan-out may take. */
  doneMs: number;
  onAck?: () => void;
}

/** Puts the job on the relay's share. */
export async function submitRelayJob(tgt: Transport, job: RelayJob): Promise<void> {
  await tgt.mkdirp(JOBS);
  await writeJson(tgt, relJoin(JOBS, `${job.id}.json`), job);
}

/** Streams the pack of a job onto the relay's share; returns the bytes written. */
export async function submitRelayPack(tgt: Transport, id: string, data: NodeJS.ReadableStream, onProgress?: (n: number) => void): Promise<number> {
  await tgt.mkdirp(JOBS);
  const rel = relJoin(JOBS, `${id}.pack`);
  const tmp = `${rel}.tmp`;
  const n = await tgt.writeStream(tmp, data as import('node:stream').Readable, { onProgress });
  await tgt.rename(tmp, rel);
  return n;
}

/** Waits for the relay's result; a RelayError says whether the relay never answered or ran out of time. */
export async function waitRelayResult(tgt: Transport, id: string, w: RelayWait): Promise<RelayResult> {
  const started = Date.now();
  let acked = false;
  while (true) {
    w.cancel.throwIfCancelled();
    const result = await readJson<RelayResult>(tgt, relJoin(RESULTS, `${id}.json`));
    if (result?.id === id) return result;
    if (!acked && (await tgt.stat(relJoin(JOBS, `${id}.ack`)))) {
      acked = true;
      w.onAck?.();
    }
    const waited = Date.now() - started;
    if (!acked && waited > w.ackMs) {
      // nobody took it: take it back so a relay started later does not send stale files
      await tgt.remove(relJoin(JOBS, `${id}.json`), false).catch(() => undefined);
      throw new RelayError(t('Röle {ms} sn içinde işi almadı; oradaki SamSync çalışmıyor olabilir', { ms: Math.round(w.ackMs / 1000) }), true);
    }
    if (waited > w.doneMs) throw new RelayError(t('Röle {m} dakika içinde bitirmedi', { m: Math.round(w.doneMs / 60000) }), false);
    await sleep(Math.min(1500, 300 + waited / 10));
  }
}

// ------------------------------------------------------------------ the relay's side

export interface RelayHost {
  ctx(): CoreContext;
  /** Runs a plan with the planner's selection; null when there is nothing to do. */
  runPlan(plan: SendPlan, label: string): RunHandle | null;
  /** Runs ready-made groups (the pack applied to this machine's own disk), tracked like any run. */
  runGroups(groups: ExecGroup[], label: string, opts: { options: SendOptions; backup: boolean; verify: boolean }): RunHandle;
}

/**
 * Runs on the relay machine: watches the jobs folder below its local share root and sends each job on.
 * Started by the service when this machine's node is marked as a relay.
 */
export class RelayService {
  private timer: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private busy = new Set<string>();
  private lastPrune = 0;
  readonly jobsDir: string;
  readonly resultsDir: string;

  constructor(
    private host: RelayHost,
    /** The local folder the share points to (the relay node's first local root). */
    readonly localRoot: string,
    readonly node: NodeConfig,
    private pollMs = 2000,
  ) {
    this.jobsDir = path.join(localRoot, RELAY_FOLDER, 'jobs');
    this.resultsDir = path.join(localRoot, RELAY_FOLDER, 'results');
  }

  start(): void {
    this.stop();
    try {
      fs.mkdirSync(this.jobsDir, { recursive: true });
      fs.mkdirSync(this.resultsDir, { recursive: true });
      this.watcher = fs.watch(this.jobsDir, () => void this.poll());
      this.watcher.on('error', () => undefined);
    } catch (e) {
      this.host.ctx().log.warn(t('Röle'), t('Röle klasörü açılamadı: {error}', { error: errMessage(e) }));
    }
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.host.ctx().log.info(t('Röle'), t('Bu makine {group} grubuna röle: {dir} izleniyor', { group: this.node.group ?? '-', dir: this.jobsDir }));
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  /** Test hook and timer body: looks for jobs once. */
  async poll(): Promise<void> {
    let names: string[];
    try {
      names = (await fsp.readdir(this.jobsDir)).filter((n) => n.endsWith('.json'));
    } catch {
      return;
    }
    for (const name of names) {
      const id = name.slice(0, -5);
      if (this.busy.has(id)) continue;
      this.busy.add(id);
      void this.take(id).finally(() => this.busy.delete(id));
    }
    if (Date.now() - this.lastPrune > 3600_000) {
      this.lastPrune = Date.now();
      void this.prune();
    }
  }

  private async take(id: string): Promise<void> {
    const file = path.join(this.jobsDir, `${id}.json`);
    let job: RelayJob;
    try {
      job = JSON.parse(await fsp.readFile(file, 'utf8')) as RelayJob;
    } catch {
      return; // still being written, or not ours
    }
    if (job.id !== id) return;
    const ctx = this.host.ctx();
    const log = ctx.log;
    try {
      await fsp.writeFile(path.join(this.jobsDir, `${id}.ack`), JSON.stringify({ at: Date.now() }));
    } catch (e) {
      log.warn(t('Röle'), t('İş alınamadı: {error}', { error: errMessage(e) }));
      return;
    }
    log.info(t('Röle'), t('{from} gönderdi: {n} öğe → {targets}', { from: job.from ?? '?', n: job.sources.length, targets: job.targetIds.join(', ') || '-' }));
    const result: RelayResult = { id, finishedAt: 0, targets: [] };
    // first the pack: the sender's changes for this machine, applied to its own disk
    let ownOk = true;
    if (job.pack) {
      const own = await this.applyPack(id, job);
      result.targets.push(own);
      ownOk = own.status !== 'failed' && own.status !== 'cancelled';
    }
    try {
      if (!ownOk && job.targetIds.length) throw new Error(t('Paket bu makineye uygulanamadı; dağıtım yapılmadı'));
      if (!job.targetIds.length) throw null;
      const sources: SourceSpec[] = job.sources.map((s) => ({ kind: s.kind, path: path.join(this.localRoot, ...s.rel.split('/')) }));
      const req: SendRequest = { sources, targetIds: job.targetIds, options: { ...job.options, dryRun: false, notify: false }, origin: 'send', label: t('Röle: {label}', { label: job.label }), direct: true };
      const plan = await buildSendPlan(ctx, req);
      const handle = this.host.runPlan(plan, req.label!);
      const detail: RunDetail | null = handle ? await handle.done : null;
      for (const tp of plan.targets) {
        const got = detail?.targets.find((x) => x.key === tp.targetId);
        const r: RelayTargetResult = !tp.reachable
          ? { targetId: tp.targetId, status: 'failed', opsOk: 0, opsFailed: 0, bytes: 0, error: tp.error }
          : got
            ? { targetId: tp.targetId, status: got.status === 'queued' || got.status === 'running' ? 'failed' : got.status, opsOk: got.done - got.failed, opsFailed: got.failed, bytes: got.bytesDone, error: got.error }
            : { targetId: tp.targetId, status: 'ok', opsOk: 0, opsFailed: 0, bytes: 0 };
        result.targets.push(r);
      }
      for (const w of plan.warnings) log.warn(t('Röle'), w);
    } catch (e) {
      if (e !== null) {
        log.error(t('Röle'), t('İş çalıştırılamadı: {error}', { error: errMessage(e) }), e);
        result.targets.push(...job.targetIds.map((targetId): RelayTargetResult => ({ targetId, status: 'failed', opsOk: 0, opsFailed: 0, bytes: 0, error: errMessage(e) })));
      }
    }
    result.finishedAt = Date.now();
    try {
      const tmp = path.join(this.resultsDir, `${id}.${newId()}.tmp`);
      await fsp.writeFile(tmp, JSON.stringify(result, null, 1));
      await fsp.rename(tmp, path.join(this.resultsDir, `${id}.json`));
      await fsp.rm(file, { force: true });
      await fsp.rm(path.join(this.jobsDir, `${id}.ack`), { force: true });
    } catch (e) {
      log.error(t('Röle'), t('Sonuç yazılamadı: {error}', { error: errMessage(e) }), e);
    }
  }

  /** Applies the pack that came with a job to this machine's own disk, through the ordinary run machinery. */
  private async applyPack(id: string, job: RelayJob): Promise<RelayTargetResult> {
    const packFile = path.join(this.jobsDir, `${id}.pack`);
    const own: RelayTargetResult = { targetId: this.node.id, status: 'ok', opsOk: 0, opsFailed: 0, bytes: 0 };
    try {
      const ops: ExecOp[] = job.pack!.ops.map((o) =>
        o.kind === 'copy'
          ? { id: o.id, kind: 'copy', rel: o.rel, isDir: false, size: o.size, mtimeMs: o.mtimeMs, src: { kind: 'pack', file: packFile, offset: o.offset, length: o.length, method: o.method }, replaceType: o.replaceType, dstExists: o.dstExists }
          : o.kind === 'mkdir'
            ? { id: o.id, kind: 'mkdir', rel: o.rel, isDir: true, size: 0, replaceType: o.replaceType, dstExists: o.dstExists }
            : { id: o.id, kind: 'delete', rel: o.rel, isDir: o.isDir, size: 0 },
      );
      if (ops.length) {
        const group: ExecGroup = { key: this.node.id, title: this.node.name, rootLabel: this.localRoot, open: async () => new FsTransport(this.localRoot), node: this.node, ops, backup: job.pack!.backup };
        const h = this.host.runGroups([group], t('Paket: {label}', { label: job.label }), { options: job.options, backup: job.pack!.backup, verify: job.pack!.verify });
        const d = await h.done;
        const tg = d.targets[0];
        own.status = d.status === 'ok' ? 'ok' : d.status === 'partial' ? 'partial' : d.status === 'cancelled' ? 'cancelled' : 'failed';
        own.opsOk = d.opsOk;
        own.opsFailed = d.opsFailed;
        own.bytes = d.bytes;
        own.error = tg?.error;
        own.failedOps = d.results.filter((r) => !r.ok).map((r) => r.opId);
        own.backupPath = tg?.backupPath;
      }
    } catch (e) {
      own.status = 'failed';
      own.error = errMessage(e);
      own.opsFailed = job.pack!.ops.length;
      this.host.ctx().log.error(t('Röle'), t('Paket uygulanamadı: {error}', { error: errMessage(e) }), e);
    } finally {
      await fsp.rm(packFile, { force: true }).catch(() => undefined);
    }
    return own;
  }

  private async prune(): Promise<void> {
    try {
      const cutoff = Date.now() - RESULT_KEEP_MS;
      for (const n of await fsp.readdir(this.resultsDir)) {
        const p = path.join(this.resultsDir, n);
        const st = await fsp.stat(p).catch(() => null);
        if (st && st.mtimeMs < cutoff) await fsp.rm(p, { force: true });
      }
    } catch {
      /* nothing to prune */
    }
  }
}
