// Relay: the sender writes a job file into _SamSyncRelay/jobs on the relay's share once its own copy there
// is done; SamSync on the relay picks the job up, sends the files on from its local disk to the machines
// named in it and writes _SamSyncRelay/results/<id>.json; the sender waits for that and shows the outcome.
// Both sides see the same files: the sender through the share, the relay through its local root.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AgentCheck, AgentSettings, BusyProgram, DriftSummary, RelayStash, NodeConfig, RelayPending, RelayState, RunDetail, SendOptions, SendPlan, SendRequest, SourceSpec } from '../shared/types';
import { RELAY_FOLDER, type RelayJob, type RelayResult, type RelaySource, type RelayTargetResult } from '../shared/relay';
import type { CoreContext } from './context';
import type { ExecGroup, ExecOp, RunHandle } from './executor';
import { FsTransport, transportForNode, type Transport } from './transport';
import { buildSendPlan, sendFilter } from './plan';
import { scanTree } from './scan';
import { saveManifestSubtree } from './manifest';
import { probeNode } from './probe';
import os from 'node:os';
import { relJoin } from './paths';
import { HASH_DIR, answerHashRequests, pruneHashRequests } from './agenthash';
import { ASK_DIR, ASK_KINDS, answerAsks, pruneAsks, type AgentAsk } from './agentask';
import { agentChecks, localShares } from './shares';
import { UPDATE_DIR, finishOrder, putUpdate, readOrder, sha512Of, type UpdateOrder, type UpdateOutcome } from './agentupdate';
import { compareVersions } from '../shared/version';
import { busyPrograms, listProcesses } from './processes';
import { LOCK_FILE, MANIFEST_FILE } from '../shared/files';
import { CancelToken, CancelledError, errMessage, newId, sleep } from './util';
import { t } from '../shared/i18n';

const JOBS = relJoin(RELAY_FOLDER, 'jobs');
const RESULTS = relJoin(RELAY_FOLDER, 'results');
/** The relay writes this every half minute while it runs; senders read it to know it is alive. */
export const ALIVE_FILE = relJoin(RELAY_FOLDER, 'alive.json');
export const HEARTBEAT_MS = 30_000;
/** A heartbeat older than this means no SamSync runs on the relay. */
export const ALIVE_STALE_MS = 90_000;
/** Results older than this are removed by the relay. */
const RESULT_KEEP_MS = 2 * 86400_000;

/** A job waiting on the relay for a machine that was off when it came. */
interface PendingJob {
  id: string;
  label: string;
  from?: string;
  sources: RelaySource[];
  options: SendOptions;
  createdAt: number;
  /** the machine-specific files, still in _SamSyncRelay/stash/<id> */
  stash?: RelayStash;
}
/** The relay's delivery queue for one machine: _SamSyncRelay/pending/<id>.json. */
interface PendingFile {
  targetId: string;
  since: number;
  attempts: number;
  lastTry?: number;
  lastError?: string;
  jobs: PendingJob[];
}
const PENDING_MAX_JOBS = 50;

export interface Heartbeat {
  at: number;
  node: string;
  version?: string;
  /** answers hash requests for content comparisons (see agenthash.ts) */
  hashes?: boolean;
  /** answers block lists and applies packs with block deltas (see delta.ts) */
  blocks?: boolean;
  /** the machine as it sees itself, for the sender's card */
  role?: 'relay' | 'agent';
  host?: string;
  root?: string;
  /** jobs being worked on now, and machines waiting in the delivery queue */
  busy?: number;
  pending?: number;
  lastJob?: { at: number; ok: boolean; label?: string };
  lastError?: { at: number; text: string };
  /** the questions it answers in _SamSyncRelay/asks (see agentask.ts) */
  asks?: string[];
  /** installs a newer SamSync put on its share, and passes one on to its group */
  updates?: boolean;
  forwardUpdates?: boolean;
  /** its network cards, for waking it up */
  macs?: string[];
  /** live drift of its sent folders, when it watches them */
  drift?: DriftSummary;
  /** programs keeping its target folder busy, and whether senders are to wait while they run */
  busyBy?: BusyProgram[];
  holdWhileBusy?: boolean;
  /** it may be restarted or shut down by senders */
  power?: boolean;
}

/** The MAC addresses of this computer's network cards (lower case, colons). */
export function macAddresses(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (!i.internal && i.family === 'IPv4' && i.mac && i.mac !== '00:00:00:00:00:00') out.add(i.mac.toLowerCase());
  return [...out];
}

/** Reads the relay's heartbeat through a transport; null when there is none or it cannot be read. */
export async function readHeartbeat(tgt: Transport): Promise<Heartbeat | null> {
  try {
    const h = await readJson<Heartbeat>(tgt, ALIVE_FILE);
    return h && typeof h.at === 'number' ? h : null;
  } catch {
    return null;
  }
}

export function heartbeatFresh(h: Heartbeat | null, now = Date.now()): boolean {
  return !!h && now - h.at < ALIVE_STALE_MS;
}

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
  /** After a cancel, how long to wait for the relay to say what it had done by then (default 30 s). */
  cancelGraceMs?: number;
  /** The relay was told of the cancel; its answer is awaited. */
  onCancelSent?: () => void;
  /** The run is paused: the time it stays so does not count against `ackMs` and `doneMs`. */
  paused?: () => boolean;
}

/** A sender's word on a job the relay runs, as a file next to it: "pause" holds it while present, "cancel" stops it. */
export type RelaySignal = 'pause' | 'cancel';

export async function signalRelayJob(tgt: Transport, id: string, kind: RelaySignal, on = true): Promise<void> {
  const rel = relJoin(JOBS, `${id}.${kind}`);
  if (on) await writeJson(tgt, rel, { at: Date.now() });
  else await tgt.remove(rel, false).catch(() => undefined);
}

/** Puts the job on the relay's share. */
export async function submitRelayJob(tgt: Transport, job: RelayJob): Promise<void> {
  await tgt.mkdirp(JOBS);
  await writeJson(tgt, relJoin(JOBS, `${job.id}.json`), job);
}

/** Streams the pack of a job onto the relay's share; returns the bytes written. */
export async function submitRelayPack(tgt: Transport, id: string, data: NodeJS.ReadableStream, onProgress?: (n: number) => void, signal?: AbortSignal): Promise<number> {
  await tgt.mkdirp(JOBS);
  const rel = relJoin(JOBS, `${id}.pack`);
  const tmp = `${rel}.tmp`;
  try {
    const n = await tgt.writeStream(tmp, data as import('node:stream').Readable, { onProgress, signal });
    await tgt.rename(tmp, rel);
    return n;
  } catch (e) {
    // a cancelled or broken upload leaves nothing behind
    await tgt.remove(tmp, false).catch(() => undefined);
    throw e;
  }
}

/** Waits for the relay's result; a RelayError says whether the relay never answered or ran out of time. */
export async function waitRelayResult(tgt: Transport, id: string, w: RelayWait): Promise<RelayResult> {
  const started = Date.now();
  let acked = false;
  let stopBy = 0;
  let held = 0;
  let last = started;
  while (true) {
    const now = Date.now();
    if (w.paused?.()) held += now - last;
    last = now;
    if (w.cancel.cancelled && !stopBy) {
      stopBy = Date.now() + (w.cancelGraceMs ?? 30_000);
      // the file stays: a relay that takes the job just now still sees it and stops
      await signalRelayJob(tgt, id, 'cancel').catch(() => undefined);
      if (!acked && !(await tgt.stat(relJoin(JOBS, `${id}.ack`)).catch(() => null))) {
        // nobody took it yet: take it back, nothing was done there
        await tgt.remove(relJoin(JOBS, `${id}.json`), false).catch(() => undefined);
        await tgt.remove(relJoin(JOBS, `${id}.pack`), false).catch(() => undefined);
        throw new CancelledError();
      }
      w.onCancelSent?.();
    }
    if (stopBy && Date.now() > stopBy) throw new CancelledError();
    const result = await readJson<RelayResult>(tgt, relJoin(RESULTS, `${id}.json`));
    if (result?.id === id) return result;
    if (!acked && (await tgt.stat(relJoin(JOBS, `${id}.ack`)))) {
      acked = true;
      w.onAck?.();
    }
    const waited = Date.now() - started - held;
    if (stopBy) {
      await sleep(500);
      continue;
    }
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
  /** `report`: tell the team's channel when it ends (a delivery from the queue, which no sender is waiting for). */
  runPlan(plan: SendPlan, label: string, report?: boolean): RunHandle | null;
  /** Runs ready-made groups (the pack applied to this machine's own disk), tracked like any run. */
  runGroups(groups: ExecGroup[], label: string, opts: { options: SendOptions; backup: boolean; verify: boolean }): RunHandle;
  /** This machine's settings as a receiver: commands around the apply, the notification. */
  agent?(): AgentSettings | undefined;
  /** Runs one of those commands here; true when it exited with 0. */
  runHook?(label: string, cmd: string): Promise<{ ok: boolean; code: number | null; output: string }>;
  notify?(title: string, body: string): void;
  /** Answers a sender's question about this machine (see agentask.ts). */
  answer?(ask: AgentAsk): Promise<unknown>;
  /** Whether this machine installs a newer SamSync put on its share (Settings › Agent, and an installed app). */
  acceptsUpdates?(): boolean;
  /** No run is going on here (an update waits for that). */
  idle?(): boolean;
  /** Starts a SamSync Setup silently and quits; false when this copy cannot be updated so. */
  installUpdate?(file: string): boolean;
}

/**
 * Runs on the relay machine: watches the jobs folder below its local share root and sends each job on.
 * Started by the service when this machine's node is marked as a relay.
 */
/** What the sender said about a job this relay runs, and the runs it started for it. */
interface JobControl {
  label: string;
  cancelled: boolean;
  paused: boolean;
  handles: Set<RunHandle>;
}

export class RelayService {
  private timer: NodeJS.Timeout | null = null;
  private beat: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private busy = new Set<string>();
  private hashBusy = new Set<string>();
  private hashWatcher: fs.FSWatcher | null = null;
  private askBusy = new Set<string>();
  private askWatcher: fs.FSWatcher | null = null;
  private lastError?: { at: number; text: string };
  private updating = false;
  private driftWatcher: fs.FSWatcher | null = null;
  private driftTimer: NodeJS.Timeout | null = null;
  private drift?: DriftSummary;
  private busyBy: BusyProgram[] = [];
  private busyTimer: NodeJS.Timeout | null = null;
  private lastPrune = 0;
  private stats: RelayState = { active: false, jobs: 0 };
  readonly jobsDir: string;
  readonly resultsDir: string;
  /** The delivery queue: one file per machine that was off. */
  readonly pendingDir: string;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastRetry = 0;
  private delivering = false;

  /** What this relay has done since it started (for this machine's card). */
  state(): RelayState {
    return { ...this.stats };
  }

  private tell(): void {
    this.host.ctx().emit({ type: 'relay', state: this.state() });
  }

  constructor(
    private host: RelayHost,
    /** The local folder the share points to (the relay node's first local root). */
    readonly localRoot: string,
    readonly node: NodeConfig,
    private pollMs = 2000,
    private version?: string,
    /** relay: passes jobs on to the group; agent: only applies what is sent to this machine. */
    readonly role: 'relay' | 'agent' = 'relay',
  ) {
    this.jobsDir = path.join(localRoot, RELAY_FOLDER, 'jobs');
    this.resultsDir = path.join(localRoot, RELAY_FOLDER, 'results');
    this.pendingDir = path.join(localRoot, RELAY_FOLDER, 'pending');
  }

  start(): void {
    this.stop();
    // before the folders below are made: a missing root is what keeps senders from seeing this machine
    const rootExisted = fs.existsSync(this.localRoot);
    try {
      fs.mkdirSync(this.jobsDir, { recursive: true });
      fs.mkdirSync(this.resultsDir, { recursive: true });
      fs.mkdirSync(this.pendingDir, { recursive: true });
      // every machine running SamSync has this folder in its first local root: hidden, as the app's own
      if (process.platform === 'win32') execFile('attrib', ['+h', path.join(this.localRoot, RELAY_FOLDER)], { windowsHide: true }, () => undefined);
      this.watcher = fs.watch(this.jobsDir, () => void this.poll());
      this.watcher.on('error', () => undefined);
      // senders comparing contents ask for hashes here; answered from this disk at once
      const hashDir = path.join(this.localRoot, ...HASH_DIR.split('/'));
      fs.mkdirSync(hashDir, { recursive: true });
      this.hashWatcher = fs.watch(hashDir, () => void this.answerHashes());
      this.hashWatcher.on('error', () => undefined);
      // and the other questions: who holds a file, closing programs, drift checks
      const askDir = path.join(this.localRoot, ...ASK_DIR.split('/'));
      fs.mkdirSync(askDir, { recursive: true });
      this.askWatcher = fs.watch(askDir, () => void this.answerAsks());
      this.askWatcher.on('error', () => undefined);
    } catch (e) {
      this.problem(t('Röle klasörü açılamadı: {error}', { error: errMessage(e) }));
    }
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.beat = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    // the queue: every minute a look at whether it is time to try the machines that were off
    this.tickTimer = setInterval(() => void this.tick(), 60_000);
    if (this.role === 'relay') this.host.ctx().log.info(t('Röle'), t('Bu makine {group} grubuna röle: {dir} izleniyor', { group: this.node.group ?? '-', dir: this.jobsDir }));
    else this.host.ctx().log.info(t('Ajan'), t('Bu makine gelen paketleri uygular: {dir} izleniyor', { dir: this.jobsDir }));
    this.stats = { ...this.stats, active: true, role: this.role, group: this.node.group, dir: this.jobsDir };
    this.tell();
    void this.heartbeat();
    void this.poll();
    void this.refreshPending();
    void this.selfCheck(rootExisted);
    this.refreshDriftWatch();
    // the programs keeping the target folder busy: one process list a minute
    this.busyTimer = setInterval(() => void this.checkBusy(), 60_000);
    void this.checkBusy();
  }

  /** Looks for the programs that keep the target folder busy; senders see them through the heartbeat. */
  async checkBusy(): Promise<BusyProgram[]> {
    const agent = this.host.agent?.();
    let found: BusyProgram[] = [];
    if (agent?.reportBusy !== false) {
      const procs = await listProcesses().catch(() => null);
      if (!procs) return this.busyBy;
      found = busyPrograms(procs, this.localRoot, agent?.busyPrograms).map((p) => ({ name: p.name, pid: p.pid }));
    }
    if (JSON.stringify(found) !== JSON.stringify(this.busyBy)) {
      this.busyBy = found;
      this.stats = { ...this.stats, busyBy: found.length ? found : undefined };
      this.tell();
      void this.heartbeat();
    }
    return found;
  }

  // ------------------------------------------------------------------ live drift

  /** Starts or stops watching the sent folders, as Settings › Agent says. */
  refreshDriftWatch(): void {
    const on = this.host.agent?.()?.watchDrift === true && !!this.host.answer;
    if (on && !this.driftWatcher) {
      try {
        this.driftWatcher = fs.watch(this.localRoot, { recursive: true }, (_ev, name) => this.driftChanged(String(name ?? '')));
        this.driftWatcher.on('error', () => undefined);
        this.scheduleDrift(1000);
      } catch (e) {
        this.problem(t('Gönderilen klasörler izlenemiyor: {error}', { error: errMessage(e) }));
      }
    } else if (!on && this.driftWatcher) {
      this.driftWatcher.close();
      this.driftWatcher = null;
      if (this.driftTimer) clearTimeout(this.driftTimer);
      this.driftTimer = null;
      this.drift = undefined;
      this.stats = { ...this.stats, drift: undefined };
      this.tell();
    }
  }

  /** A change below the root: SamSync's own files and folders do not count. */
  private driftChanged(name: string): void {
    const rel = name.replace(/\\/g, '/');
    const top = rel.split('/')[0].toLowerCase();
    if (!rel || top === RELAY_FOLDER.toLowerCase() || top === this.host.ctx().config.copy.backupFolderName.toLowerCase()) return;
    if (/(^|\/)samsync-[^/]*\.json$|\.samsync-tmp$/i.test(rel)) return;
    this.scheduleDrift(5000);
  }

  private scheduleDrift(ms: number): void {
    if (this.driftTimer) clearTimeout(this.driftTimer);
    this.driftTimer = setTimeout(() => void this.countDrift(), ms);
  }

  /** Counts the drift against the manifest, once nothing writes here (a send in progress is not drift). */
  private async countDrift(): Promise<void> {
    this.driftTimer = null;
    if (!this.driftWatcher || !this.host.answer) return;
    if (this.busy.size || !(this.host.idle?.() ?? true) || fs.existsSync(path.join(this.localRoot, LOCK_FILE))) {
      this.scheduleDrift(15_000);
      return;
    }
    try {
      const r = (await this.host.answer({ kind: 'drift' })) as { manifest: boolean; subtrees: { changed: string[]; added: string[]; removed: string[]; counts: { changed: number; added: number; removed: number } }[] };
      const sum = (k: 'changed' | 'added' | 'removed') => r.subtrees.reduce((n, s) => n + s.counts[k], 0);
      const sample = r.subtrees.flatMap((s) => [...s.changed.map((x) => `~ ${x}`), ...s.added.map((x) => `+ ${x}`), ...s.removed.map((x) => `− ${x}`)]).slice(0, 10);
      this.drift = r.manifest ? { at: Date.now(), changed: sum('changed'), added: sum('added'), removed: sum('removed'), sample } : undefined;
      this.stats = { ...this.stats, drift: this.drift };
      this.tell();
      void this.heartbeat();
    } catch (e) {
      this.host.ctx().log.warn(t('Ajan'), t('Sapma sayılamadı: {error}', { error: errMessage(e) }));
    }
  }

  /** Records what went wrong last: this machine's card and the senders' cards (through the heartbeat) show it. */
  private problem(text: string): void {
    this.lastError = { at: Date.now(), text };
    this.host.ctx().log.warn(this.role === 'relay' ? t('Röle') : t('Ajan'), text);
    this.stats = { ...this.stats, lastError: this.lastError };
    this.tell();
  }

  /** Whether senders can find SamSync here: the first local root exists and is the folder the share leads to. */
  async selfCheck(rootExists = fs.existsSync(this.localRoot)): Promise<AgentCheck[]> {
    // senders wrote through the share when SamSync's own files are there (a manifest, or jobs nobody picked up)
    const sentTo = (dir: string) => fs.existsSync(path.join(dir, MANIFEST_FILE)) || fs.existsSync(path.join(dir, RELAY_FOLDER));
    const checks = agentChecks(this.node, this.localRoot, rootExists, await localShares(), this.role === 'relay', sentTo);
    for (const c of checks) this.host.ctx().log.warn(this.role === 'relay' ? t('Röle') : t('Ajan'), c.text);
    this.stats = { ...this.stats, checks: checks.length ? checks : undefined };
    this.tell();
    return checks;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.watcher?.close();
    this.watcher = null;
    this.hashWatcher?.close();
    this.hashWatcher = null;
    this.askWatcher?.close();
    this.askWatcher = null;
    this.driftWatcher?.close();
    this.driftWatcher = null;
    if (this.driftTimer) clearTimeout(this.driftTimer);
    this.driftTimer = null;
    if (this.busyTimer) clearInterval(this.busyTimer);
    this.busyTimer = null;
    // a stopped relay says so at once, so senders do not wait for a stale heartbeat to age
    fs.rmSync(path.join(this.localRoot, ALIVE_FILE), { force: true });
    if (this.stats.active) {
      this.stats = { ...this.stats, active: false };
      this.tell();
    }
  }

  /** An agent turned off leaves nothing behind: the folder goes when no job waits in it (results and hashes go with it). */
  removeIfIdle(): void {
    try {
      const waiting = fs.readdirSync(this.jobsDir).length > 0 || fs.readdirSync(this.pendingDir).length > 0;
      if (!waiting) fs.rmSync(path.join(this.localRoot, RELAY_FOLDER), { recursive: true, force: true });
    } catch {
      /* gone already, or in use for a moment */
    }
  }

  /** Tells senders this machine is here (they read the file through the share). */
  async heartbeat(): Promise<void> {
    const file = path.join(this.localRoot, ALIVE_FILE);
    const s = this.stats;
    const updates = this.host.acceptsUpdates?.() ?? false;
    const h: Heartbeat = {
      at: Date.now(),
      node: this.node.id,
      version: this.version,
      hashes: true,
      blocks: true,
      role: this.role,
      host: os.hostname(),
      root: this.localRoot,
      busy: this.busy.size,
      pending: s.pending?.length ?? 0,
      lastJob: s.lastJobAt ? { at: s.lastJobAt, ok: s.lastOk !== false, label: s.lastLabel } : undefined,
      lastError: this.lastError,
      asks: [...ASK_KINDS],
      updates,
      forwardUpdates: updates && this.role === 'relay',
      macs: macAddresses(),
      drift: this.drift,
      busyBy: this.busyBy.length ? this.busyBy : undefined,
      holdWhileBusy: this.host.agent?.()?.holdWhileBusy === true || undefined,
      power: this.host.agent?.()?.allowPower === true || undefined,
    };
    try {
      await fsp.writeFile(`${file}.tmp`, JSON.stringify(h));
      await fsp.rename(`${file}.tmp`, file);
    } catch {
      /* the share folder may be read-only for a moment */
    }
  }

  /** Answers the other questions of senders (see agentask.ts). */
  answerAsks(): Promise<void> {
    return answerAsks(this.localRoot, (ask) => (this.host.answer ? this.host.answer(ask) : Promise.reject(new Error(t('Bu soru burada yanıtlanmıyor')))), this.askBusy);
  }

  /** Answers the hash requests waiting in the relay folder (content comparisons of senders). */
  answerHashes(): Promise<void> {
    return answerHashRequests(this.localRoot, this.host.ctx().hashCache, this.hashBusy);
  }

  /** Test hook and timer body: looks for jobs once. */
  async poll(): Promise<void> {
    void this.answerHashes();
    void this.answerAsks();
    void this.checkUpdate();
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
      void pruneHashRequests(this.localRoot);
      void pruneAsks(this.localRoot);
    }
  }

  /** A job running here: the sender pauses or cancels it with a file next to it (see signalRelayJob). */
  private async watchJob(id: string, ctl: JobControl): Promise<void> {
    const has = (k: RelaySignal) => fsp.access(path.join(this.jobsDir, `${id}.${k}`)).then(
      () => true,
      () => false,
    );
    if (!ctl.cancelled && (await has('cancel'))) {
      ctl.cancelled = true;
      this.host.ctx().log.warn(t('Röle'), t('Gönderen işi iptal etti: {label}', { label: ctl.label }));
      for (const h of ctl.handles) h.cancel.cancel();
      return;
    }
    const paused = await has('pause');
    if (paused !== ctl.paused && !ctl.cancelled) {
      ctl.paused = paused;
      for (const h of ctl.handles) h.pause(paused);
    }
  }

  /** A run started for a job follows the sender's pause and cancel. */
  private track(ctl: JobControl, h: RunHandle): void {
    ctl.handles.add(h);
    if (ctl.cancelled) h.cancel.cancel();
    else if (ctl.paused) h.pause(true);
    void h.done.finally(() => ctl.handles.delete(h));
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
    const ctl: JobControl = { label: job.label, cancelled: false, paused: false, handles: new Set() };
    await this.watchJob(id, ctl);
    const watch = setInterval(() => void this.watchJob(id, ctl), 1000);
    const cancelled = (targetId: string): RelayTargetResult => ({ targetId, status: 'cancelled', opsOk: 0, opsFailed: 0, bytes: 0, error: t('Gönderen iptal etti') });
    // first the pack: the sender's changes for this machine, applied to its own disk
    let ownOk = true;
    if (job.pack) {
      let own: RelayTargetResult;
      if (ctl.cancelled) {
        // cancelled before anything happened here: the commands around the apply do not run either
        own = { ...cancelled(this.node.id), opsFailed: job.pack.ops.length, failedOps: job.pack.ops.map((o) => o.id) };
        await fsp.rm(path.join(this.jobsDir, `${id}.pack`), { force: true }).catch(() => undefined);
      } else own = await this.applyPack(id, job, ctl);
      result.targets.push(own);
      ownOk = own.status !== 'failed' && own.status !== 'cancelled';
    }
    try {
      if (!job.targetIds.length) throw null;
      if (ctl.cancelled) {
        result.targets.push(...job.targetIds.map(cancelled));
        throw null;
      }
      if (!ownOk) throw new Error(t('Paket bu makineye uygulanamadı; dağıtım yapılmadı'));
      const sources: SourceSpec[] = job.sources.map((s) => ({ kind: s.kind, path: path.join(this.localRoot, ...s.rel.split('/')) }));
      const req: SendRequest = { sources, targetIds: job.targetIds, options: { ...job.options, dryRun: false, notify: false }, origin: 'send', label: t('Röle: {label}', { label: job.label }), direct: true };
      const plan = await buildSendPlan(ctx, req, job.stash ? { stash: { ...job.stash, dir: this.stashDir(id) } } : {});
      // cancelled while the machines were compared: nothing goes out
      const handle = ctl.cancelled ? null : this.host.runPlan(plan, req.label!);
      if (handle) this.track(ctl, handle);
      const detail: RunDetail | null = handle ? await handle.done : null;
      for (const tp of plan.targets) {
        const got = detail?.targets.find((x) => x.key === tp.targetId);
        // a cancelled job queues nothing for the machines that were off
        if (ctl.cancelled && !got) {
          result.targets.push(cancelled(tp.targetId));
          continue;
        }
        const r: RelayTargetResult = !tp.reachable
          ? await this.deferOrFail(job, tp.targetId, tp.error)
          : got
            ? { targetId: tp.targetId, status: got.status === 'queued' || got.status === 'running' ? 'failed' : got.status, opsOk: got.done - got.failed, opsFailed: got.failed, bytes: got.bytesDone, error: got.error, check: got.check }
            : { targetId: tp.targetId, status: 'ok', opsOk: 0, opsFailed: 0, bytes: 0 };
        result.targets.push(r);
      }
      for (const w of plan.warnings) log.warn(t('Röle'), w);
    } catch (e) {
      if (e !== null) {
        log.error(t('Röle'), t('İş çalıştırılamadı: {error}', { error: errMessage(e) }), e);
        this.lastError = { at: Date.now(), text: t('İş çalıştırılamadı: {error}', { error: errMessage(e) }) };
        result.targets.push(...job.targetIds.map((targetId): RelayTargetResult => ({ targetId, status: 'failed', opsOk: 0, opsFailed: 0, bytes: 0, error: errMessage(e) })));
      }
    }
    clearInterval(watch);
    result.finishedAt = Date.now();
    // the stash goes once nobody waits for it (a machine that was off gets it later from the queue)
    if (job.stash && !result.targets.some((x) => x.status === 'deferred')) await fsp.rm(this.stashDir(id), { recursive: true, force: true }).catch(() => undefined);
    // what just arrived is no drift: count again once the manifest is written
    if (this.driftWatcher) this.scheduleDrift(3000);
    this.stats = { ...this.stats, jobs: this.stats.jobs + 1, lastJobAt: result.finishedAt, lastOk: result.targets.every((x) => x.status === 'ok'), lastLabel: job.label, lastError: this.lastError };
    this.tell();
    try {
      const tmp = path.join(this.resultsDir, `${id}.${newId()}.tmp`);
      await fsp.writeFile(tmp, JSON.stringify(result, null, 1));
      await fsp.rename(tmp, path.join(this.resultsDir, `${id}.json`));
      await fsp.rm(file, { force: true });
      for (const k of ['ack', 'cancel', 'pause']) await fsp.rm(path.join(this.jobsDir, `${id}.${k}`), { force: true });
    } catch (e) {
      log.error(t('Röle'), t('Sonuç yazılamadı: {error}', { error: errMessage(e) }), e);
      this.lastError = { at: Date.now(), text: t('Sonuç yazılamadı: {error}', { error: errMessage(e) }) };
    }
  }

  // ------------------------------------------------------------------ updates sent over the network

  /** An update order in the relay folder (see agentupdate.ts): checked, passed on, installed when idle. */
  async checkUpdate(): Promise<void> {
    if (this.updating) return;
    const order = await readOrder(this.localRoot);
    if (!order) return;
    this.updating = true;
    try {
      await this.applyUpdate(order);
    } catch (e) {
      this.problem(t('Güncelleme uygulanamadı: {error}', { error: errMessage(e) }));
      await finishOrder(this.localRoot, order, { id: order.id, at: Date.now(), ok: false, version: order.version, error: errMessage(e) });
    } finally {
      this.updating = false;
    }
  }

  private async applyUpdate(order: UpdateOrder): Promise<void> {
    const ctx = this.host.ctx();
    const out: UpdateOutcome = { id: order.id, at: Date.now(), ok: false, version: order.version };
    const fail = async (error: string) => {
      this.problem(error);
      await finishOrder(this.localRoot, order, { ...out, error });
    };
    if (!this.host.acceptsUpdates?.()) return fail(t('Bu makine ağdan güncelleme kabul etmiyor (Ayarlar › Ajan)'));
    const file = path.join(this.localRoot, ...UPDATE_DIR.split('/'), path.basename(order.file));
    if (!fs.existsSync(file) || (await sha512Of(file)) !== order.sha512) return fail(t('Gelen kurulum dosyası eksik ya da bozuk; güncelleme yapılmadı'));
    const sender = order.from ? (ctx.config.nodes.find((n) => n.id === order.from)?.name ?? order.from) : '?';
    // the machines of the group get it from here, over their own network
    if (order.forward?.length) {
      out.forwarded = {};
      for (const id of order.forward) {
        const node = ctx.config.nodes.find((n) => n.id === id);
        if (!node) {
          out.forwarded[id] = t('yapılandırmada yok');
          continue;
        }
        try {
          const tgt = await transportForNode(ctx, node);
          try {
            await putUpdate(tgt, { file, version: order.version, sha512: order.sha512 }, { install: true, from: order.from });
          } finally {
            await tgt.close().catch(() => undefined);
          }
          out.forwarded[id] = 'ok';
          ctx.log.info(t('Röle'), t('{name}: SamSync {version} kurulumu iletildi', { name: node.name, version: order.version }));
        } catch (e) {
          out.forwarded[id] = errMessage(e);
          ctx.log.warn(t('Röle'), t('{name}: SamSync {version} kurulumu iletilemedi: {error}', { name: node.name, version: order.version, error: errMessage(e) }));
        }
      }
    }
    if (!order.install || compareVersions(order.version, this.version ?? '0') <= 0) {
      await finishOrder(this.localRoot, order, { ...out, ok: true });
      return;
    }
    // nothing may be half done when SamSync quits for the installer: wait for the jobs and runs here to end
    const until = Date.now() + 3600_000;
    while (this.busy.size || !(this.host.idle?.() ?? true)) {
      if (Date.now() > until) return fail(t('Makine bir saat boyunca boşa çıkmadı; SamSync {version} kurulmadı', { version: order.version }));
      await sleep(5000);
    }
    const copy = path.join(os.tmpdir(), `samsync-update-${order.version}-${newId()}.exe`);
    await fsp.copyFile(file, copy);
    // the order goes first, so the new version does not take it again
    await finishOrder(this.localRoot, order, { ...out, ok: true, installing: true });
    ctx.log.info(t('Ajan'), t('SamSync {version} kuruluyor ({from} gönderdi)', { version: order.version, from: sender }));
    if (!this.host.installUpdate?.(copy)) {
      await fsp.rm(copy, { force: true }).catch(() => undefined);
      this.problem(t('Bu kopya kendini güncelleyemez (taşınabilir ya da geliştirme sürümü)'));
    }
  }

  /** Where the machine-specific files of a job wait (see RelayStash). */
  private stashDir(jobId: string): string {
    return path.join(this.localRoot, RELAY_FOLDER, 'stash', jobId);
  }

  // ------------------------------------------------------------------ the delivery queue

  private queueOn(): boolean {
    return (this.host.ctx().config.copy.relayQueueMinutes ?? 5) > 0;
  }

  private pendingFile(targetId: string): string {
    return path.join(this.pendingDir, `${targetId.replace(/[^\w.-]/g, '_')}.json`);
  }

  private async readPending(): Promise<PendingFile[]> {
    let names: string[];
    try {
      names = (await fsp.readdir(this.pendingDir)).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    const out: PendingFile[] = [];
    for (const n of names) {
      try {
        const p = JSON.parse(await fsp.readFile(path.join(this.pendingDir, n), 'utf8')) as PendingFile;
        if (p && Array.isArray(p.jobs)) out.push(p);
      } catch {
        /* half written or foreign */
      }
    }
    return out.sort((a, b) => a.since - b.since);
  }

  private async writePending(p: PendingFile): Promise<void> {
    const file = this.pendingFile(p.targetId);
    await fsp.mkdir(this.pendingDir, { recursive: true });
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(p, null, 1));
    await fsp.rename(`${file}.tmp`, file);
  }

  private async removePending(targetId: string): Promise<void> {
    await fsp.rm(this.pendingFile(targetId), { force: true }).catch(() => undefined);
  }

  /** The queue as the cards show it. */
  async refreshPending(): Promise<RelayPending[]> {
    const nodes = this.host.ctx().config.nodes;
    const pending = (await this.readPending()).map((p) => ({ targetId: p.targetId, name: nodes.find((n) => n.id === p.targetId)?.name ?? p.targetId, jobs: p.jobs.length, since: p.since, attempts: p.attempts, lastTry: p.lastTry, lastError: p.lastError }));
    this.stats = { ...this.stats, pending };
    this.tell();
    return pending;
  }

  /** A machine that did not answer: its job goes to the queue (when the queue is on), else it fails as before. */
  private async deferOrFail(job: RelayJob, targetId: string, why?: string): Promise<RelayTargetResult> {
    if (!this.queueOn()) return { targetId, status: 'failed', opsOk: 0, opsFailed: 0, bytes: 0, error: why };
    const log = this.host.ctx().log;
    try {
      const list = await this.readPending();
      const p: PendingFile = list.find((x) => x.targetId === targetId) ?? { targetId, since: Date.now(), attempts: 0, jobs: [] };
      if (!p.jobs.some((j) => j.id === job.id)) p.jobs.push({ id: job.id, label: job.label, from: job.from, sources: job.sources, options: job.options, createdAt: job.createdAt, stash: job.stash });
      if (p.jobs.length > PENDING_MAX_JOBS) p.jobs.splice(0, p.jobs.length - PENDING_MAX_JOBS);
      p.lastError = why;
      await this.writePending(p);
      log.info(t('Röle'), t('{name} erişilemedi; iş kuyruğa alındı ({n} iş bekliyor)', { name: targetId, n: p.jobs.length }));
      void this.refreshPending();
      return { targetId, status: 'deferred', opsOk: 0, opsFailed: 0, bytes: 0, error: t('Makine kapalı; röle açılınca teslim edecek') };
    } catch (e) {
      log.warn(t('Röle'), t('Kuyruğa yazılamadı: {error}', { error: errMessage(e) }));
      return { targetId, status: 'failed', opsOk: 0, opsFailed: 0, bytes: 0, error: why };
    }
  }

  private async tick(): Promise<void> {
    if (!this.queueOn() || !this.stats.pending?.length) return;
    const every = (this.host.ctx().config.copy.relayQueueMinutes ?? 5) * 60_000;
    if (Date.now() - this.lastRetry < every) return;
    await this.deliverPending();
  }

  /**
   * One pass over the queue: each machine that answers now gets its jobs, oldest first (the plan compares, so a
   * job whose files arrived another way costs nothing); the first failure leaves the rest for the next pass.
   * Machines quiet for longer than the configured days are dropped.
   */
  async deliverPending(): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    this.lastRetry = Date.now();
    const ctx = this.host.ctx();
    const log = ctx.log;
    try {
      const list = await this.readPending();
      if (!list.length) return;
      const maxAge = (ctx.config.copy.relayQueueDays ?? 7) * 86400_000;
      for (const p of list) {
        const node = ctx.config.nodes.find((n) => n.id === p.targetId);
        if (!node) {
          await this.removePending(p.targetId);
          continue;
        }
        if (Date.now() - p.since > maxAge) {
          log.warn(t('Röle'), t('{name} {d} gündür erişilemedi; kuyruktaki {n} iş düşürüldü', { name: node.name, d: Math.round(maxAge / 86400_000), n: p.jobs.length }));
          await this.removePending(p.targetId);
          continue;
        }
        p.lastTry = Date.now();
        p.attempts++;
        const pr = await probeNode(ctx.config, node, 1500, false).catch(() => null);
        if (!pr?.ok) {
          p.lastError = pr?.detail;
          await this.writePending(p);
          continue;
        }
        while (p.jobs.length) {
          const j = p.jobs[0];
          const sources: SourceSpec[] = j.sources.map((s) => ({ kind: s.kind, path: path.join(this.localRoot, ...s.rel.split('/')) }));
          const req: SendRequest = { sources, targetIds: [p.targetId], options: { ...j.options, dryRun: false, notify: false }, origin: 'send', label: t('Röle (kuyruktan): {label}', { label: j.label }), direct: true };
          try {
            const plan = await buildSendPlan(ctx, req, j.stash ? { stash: { ...j.stash, dir: this.stashDir(j.id) } } : {});
            const tp = plan.targets.find((x) => x.targetId === p.targetId);
            if (tp && !tp.reachable) throw new Error(tp.error ?? t('erişilemedi'));
            const h = this.host.runPlan(plan, req.label!, true);
            const d = h ? await h.done : null;
            if (d && (d.status === 'failed' || d.status === 'cancelled')) throw new Error(d.targets[0]?.error ?? d.status);
            p.jobs.shift();
            p.lastError = undefined;
            log.info(t('Röle'), t('{name}: kuyruktaki iş teslim edildi: {label}', { name: node.name, label: j.label }));
            this.stats = { ...this.stats, jobs: this.stats.jobs + 1, lastJobAt: Date.now(), lastOk: true, lastLabel: j.label };
          } catch (e) {
            p.lastError = errMessage(e);
            log.warn(t('Röle'), t('{name}: kuyruktaki iş teslim edilemedi: {error}', { name: node.name, error: p.lastError }));
            break;
          }
        }
        if (p.jobs.length) await this.writePending(p);
        else await this.removePending(p.targetId);
      }
    } finally {
      this.delivering = false;
      await this.refreshPending();
    }
  }

  /** Applies the pack that came with a job to this machine's own disk, through the ordinary run machinery. */
  private async applyPack(id: string, job: RelayJob, ctl?: JobControl): Promise<RelayTargetResult> {
    const packFile = path.join(this.jobsDir, `${id}.pack`);
    const own: RelayTargetResult = { targetId: this.node.id, status: 'ok', opsOk: 0, opsFailed: 0, bytes: 0 };
    const agent = this.host.agent?.();
    const log = this.host.ctx().log;
    // this machine's own command first (stop the program that holds the files); when it fails, nothing is applied
    if (agent?.beforeApply && this.host.runHook && job.pack!.ops.length) {
      const { ok } = await this.host.runHook(t('Uygulama öncesi komut'), agent.beforeApply);
      if (!ok) {
        own.status = 'failed';
        own.error = t('Uygulama öncesi komut başarısız; paket uygulanmadı');
        own.opsFailed = job.pack!.ops.length;
        own.failedOps = job.pack!.ops.map((o) => o.id);
        await fsp.rm(packFile, { force: true }).catch(() => undefined);
        log.error(t('Ajan'), own.error);
        return own;
      }
    }
    try {
      const ops: ExecOp[] = job.pack!.ops.map((o) =>
        o.kind === 'copy'
          ? { id: o.id, kind: 'copy', rel: o.rel, isDir: false, size: o.size, mtimeMs: o.mtimeMs, src: o.delta ? { kind: 'patch', file: packFile, offset: o.offset, length: o.length, method: o.method, base: path.join(this.localRoot, ...o.rel.split('/')), size: o.size, ...o.delta } : { kind: 'pack', file: packFile, offset: o.offset, length: o.length, method: o.method }, replaceType: o.replaceType, dstExists: o.dstExists }
          : o.kind === 'mkdir'
            ? { id: o.id, kind: 'mkdir', rel: o.rel, isDir: true, size: 0, replaceType: o.replaceType, dstExists: o.dstExists }
            : { id: o.id, kind: 'delete', rel: o.rel, isDir: o.isDir, size: 0, onlyIfEmpty: o.onlyIfEmpty },
      );
      if (ops.length) {
        const group: ExecGroup = { key: this.node.id, title: this.node.name, rootLabel: this.localRoot, open: async () => new FsTransport(this.localRoot), node: this.node, ops, backup: job.pack!.backup };
        const h = this.host.runGroups([group], t('Paket: {label}', { label: job.label }), { options: job.options, backup: job.pack!.backup, verify: job.pack!.verify });
        if (ctl) this.track(ctl, h);
        const d = await h.done;
        const tg = d.targets[0];
        // the manifest of this machine, from its own disk: the sender's next plan starts from it
        if (d.status !== 'failed' && job.pack!.subtrees?.length) await this.writeOwnManifest(job).catch((e) => this.host.ctx().log.warn(t('Röle'), t('Manifest yazılamadı ({path}): {error}', { path: this.localRoot, error: errMessage(e) })));
        own.status = d.status === 'ok' ? 'ok' : d.status === 'partial' ? 'partial' : d.status === 'cancelled' ? 'cancelled' : 'failed';
        own.opsOk = d.opsOk;
        own.opsFailed = d.opsFailed;
        own.bytes = d.bytes;
        own.error = tg?.error;
        own.failedOps = d.results.filter((r) => !r.ok).map((r) => r.opId);
        const held = d.results.filter((r) => !r.ok && r.inUse).map((r) => r.opId);
        if (held.length) own.inUseOps = held;
        own.backedUpOps = d.results.filter((r) => r.ok && r.backedUp).map((r) => r.opId);
        own.backupPath = tg?.backupPath;
      }
    } catch (e) {
      own.status = 'failed';
      own.error = errMessage(e);
      own.opsFailed = job.pack!.ops.length;
      this.host.ctx().log.error(t('Röle'), t('Paket uygulanamadı: {error}', { error: errMessage(e) }), e);
      this.lastError = { at: Date.now(), text: t('Paket uygulanamadı: {error}', { error: errMessage(e) }) };
    } finally {
      await fsp.rm(packFile, { force: true }).catch(() => undefined);
    }
    // the program comes back whatever happened, and the machine says what arrived
    if (agent?.afterApply && this.host.runHook && job.pack!.ops.length) {
      const r = await this.host.runHook(t('Uygulama sonrası komut'), agent.afterApply);
      // the sender sees how it ended; with the setting on, a failing command fails the send to this machine
      own.check = { label: t('Uygulama sonrası komut'), ok: r.ok, code: r.code, output: r.output, there: true };
      if (!r.ok && agent.afterApplyFails && own.status === 'ok') {
        own.status = 'failed';
        own.error = t('Uygulama sonrası komut başarısız (kod {code})', { code: String(r.code) });
      }
    }
    if (agent?.notifyOnApply !== false && job.pack!.ops.length) {
      const sender = job.from ? (this.host.ctx().config.nodes.find((n) => n.id === job.from)?.name ?? job.from) : undefined;
      const who = sender ? t('{from} gönderdi', { from: sender }) : t('paket');
      this.host.notify?.(own.status === 'ok' ? t('✓ Paket uygulandı: {label}', { label: job.label }) : t('✕ Paket uygulanamadı: {label}', { label: job.label }), `${who} • ${t('{ok} başarılı, {failed} hatalı', { ok: own.opsOk, failed: own.opsFailed })}`);
    }
    return own;
  }

  /** Walks the sent folders on this machine's own disk (fast there) and writes the manifest for them. */
  private async writeOwnManifest(job: RelayJob): Promise<void> {
    const ctx = this.host.ctx();
    const local = new FsTransport(this.localRoot);
    const filter = sendFilter(ctx, { sources: [], targetIds: [], options: job.options, origin: 'send' });
    const by = { host: os.hostname(), user: process.env.USERNAME || undefined, version: ctx.appVersion };
    for (const rel of job.pack!.subtrees ?? []) {
      const scan = await scanTree(local, rel, { filter, caseInsensitive: true });
      if (!scan.exists) continue;
      // its own walk leaves out at most what the sender's did, so the sender's exclusions describe it
      await saveManifestSubtree(local, rel, scan.entries, by, job.label, job.pack!.excluded);
    }
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
    // a sender's pause or cancel that came after its job was done here
    try {
      for (const n of await fsp.readdir(this.jobsDir)) {
        if (!n.endsWith('.cancel') && !n.endsWith('.pause')) continue;
        if (this.busy.has(n.slice(0, n.lastIndexOf('.')))) continue;
        const st = await fsp.stat(path.join(this.jobsDir, n)).catch(() => null);
        if (st && st.mtimeMs < Date.now() - 3600_000) await fsp.rm(path.join(this.jobsDir, n), { force: true });
      }
    } catch {
      /* no jobs folder */
    }
    // stashes no queued job needs any more
    try {
      const waiting = new Set((await this.readPending()).flatMap((p) => p.jobs.map((j) => j.id)));
      const dir = path.join(this.localRoot, RELAY_FOLDER, 'stash');
      for (const n of await fsp.readdir(dir)) {
        if (waiting.has(n)) continue;
        const st = await fsp.stat(path.join(dir, n)).catch(() => null);
        if (st && st.mtimeMs < Date.now() - 3600_000) await fsp.rm(path.join(dir, n), { recursive: true, force: true });
      }
    } catch {
      /* no stash */
    }
  }
}
