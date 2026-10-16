import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AutomationSettings, AutomationState, NodeConfig, RunDetail, ScheduleState, SendPlan, SourceSpec, SyncJob, SyncSchedule, WatchConfig, WatchState } from '../shared/types';
import type { CoreContext } from './context';
import { DEFAULT_GIT_EVENTS, ReflogWatcher, changedFiles, underWatched, type HeadMove } from './gitwatch';
import type { RunHandle } from './executor';
import { buildSendPlan } from './plan';
import { makeFilter, ancestorExcluded, type PathFilter } from './filter';
import { isUnder, normalizeAbs, toPosix } from './paths';
import { errMessage, newId } from './util';
import { t } from '../shared/i18n';
import { RELAY_FOLDER } from '../shared/relay';
import { OWN_FILE_PATTERNS } from '../shared/files';

/** What the automation needs from the service (kept narrow so it can be tested without Electron). */
export interface AutomationHost {
  ctx(): CoreContext;
  /** extraNodes: targets that are not in the configuration (a watch's plain folders). */
  runPlan(plan: SendPlan, notify: boolean, extraNodes?: NodeConfig[]): RunHandle | null;
  runSyncDefault(job: SyncJob, label: string): Promise<{ handle: RunHandle | null; actions: number }>;
  getWatches(): WatchConfig[];
  saveWatches(w: WatchConfig[]): Promise<void>;
  getScheduleRuns(): Record<string, number>;
  saveScheduleRun(jobId: string, at: number): Promise<void>;
  isPaused(): boolean;
  notify(title: string, body: string): void;
  emit(state: AutomationState): void;
  settings(): AutomationSettings;
}

const IGNORED = [/(^|[\\/])\.git([\\/]|$)/, /~$/, /\.(tmp|swp|swx|crdownload|part)$/i, /\.samsync-tmp$/, /(^|[\\/])~\$[^\\/]*$/, /(^|[\\/])\.~lock\./];

// ------------------------------------------------------------------ folder watch

/** Watches files and folders, collects changed paths and reports them after a quiet period. */
export class ChangeCollector {
  private watchers: fs.FSWatcher[] = [];
  /** path -> true once a create/rename event was seen (false: only content "change" events) */
  private changed = new Map<string, boolean>();
  private timer: NodeJS.Timeout | null = null;
  error?: string;

  constructor(
    private paths: string[],
    private quietMs: number,
    private onBatch: (paths: string[], contentOnly: Set<string>) => void,
    private ignore: (abs: string) => boolean = () => false,
  ) {}

  get pending(): number {
    return this.changed.size;
  }

  start(): void {
    this.error = undefined;
    for (const raw of this.paths) {
      const p = normalizeAbs(raw);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          const w = fs.watch(p, { recursive: true }, (ev, name) => name && this.touch(path.join(p, name.toString()), ev === 'rename'));
          w.on('error', (e) => (this.error = `${p}: ${errMessage(e)}`));
          this.watchers.push(w);
        } else {
          // editors often save by replacing the file, so watch the folder and pick our name out
          const dir = path.dirname(p);
          const base = path.basename(p).toLowerCase();
          const w = fs.watch(dir, (_ev, name) => name && name.toString().toLowerCase() === base && this.touch(p));
          w.on('error', (e) => (this.error = `${p}: ${errMessage(e)}`));
          this.watchers.push(w);
        }
      } catch (e) {
        this.error = `${p}: ${errMessage(e)}`;
      }
    }
  }

  touch(abs: string, renamed = true): void {
    if (IGNORED.some((r) => r.test(abs)) || this.ignore(abs)) return;
    this.changed.set(abs, renamed || !!this.changed.get(abs));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.quietMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.changed.size) return;
    const batch = [...this.changed.keys()];
    const contentOnly = new Set([...this.changed].filter(([, renamed]) => !renamed).map(([p]) => p));
    this.changed.clear();
    this.onBatch(batch, contentOnly);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}

/**
 * Turns changed paths into send sources: existing files and folders are copied, vanished paths become
 * deletions (only when deletions are propagated). Paths under an excluded folder or name are dropped.
 * A folder that only reported a content change (Windows does that when a child changes) is skipped:
 * its children arrive as their own events, and sending the whole folder would widen the send.
 */
export async function changesToSources(
  changed: string[],
  roots: string[],
  filter: PathFilter,
  propagateDeletes: boolean,
  contentOnly: Set<string> = new Set(),
): Promise<SourceSpec[]> {
  const out: SourceSpec[] = [];
  const seen = new Set<string>();
  for (const abs of changed) {
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const root = roots.find((r) => isUnder(abs, r));
    if (root) {
      const base = fs.existsSync(root) && fs.statSync(root).isDirectory() ? root : path.dirname(root);
      const rel = toPosix(path.relative(base, abs));
      if (rel && (ancestorExcluded(filter, rel) || !filter.file(rel))) continue;
    }
    const st = await fsp.stat(abs).catch(() => null);
    if (st?.isDirectory() && contentOnly.has(abs)) continue;
    if (st) out.push({ kind: 'fs', path: abs });
    else if (propagateDeletes) out.push({ kind: 'delete', path: abs });
  }
  // a folder covers what is inside it
  const dirs = out.filter((s) => s.kind === 'fs' && fs.existsSync(s.path) && fs.statSync(s.path).isDirectory()).map((s) => s.path);
  return out.filter((s) => !dirs.some((d) => d !== s.path && isUnder(s.path, d)));
}

/** Folders a watch sends to without the configuration: one ad-hoc "path" node per folder. */
export function folderNodes(folders: string[] = []): NodeConfig[] {
  return folders.map((f) => ({
    id: folderTargetId(f),
    name: f,
    address: '',
    localRoots: [],
    networkRoot: '',
    enabled: true,
    transport: 'path' as const,
    path: f,
  }));
}

export function folderTargetId(folder: string): string {
  const key = process.platform === 'win32' ? normalizeAbs(folder).toLowerCase() : normalizeAbs(folder);
  return `folder-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10)}`;
}

const isFolderTarget = (id: string) => id.startsWith('folder-');

/** Watches files and folders (or a repository's HEAD), collects changed paths and sends them after a quiet period. */
class WatchRunner {
  readonly state: WatchState;
  private collector: ChangeCollector | null = null;
  private reflog: ReflogWatcher | null = null;
  /** path -> saw a create/rename */
  private queue = new Map<string, boolean>();
  /** "Send now" (or the start with syncOnStart) asked for the differences of the whole watched paths. */
  private fullPending = false;
  private busy = false;
  private deferred = new Map<string, Set<string>>();
  private retryTimer: NodeJS.Timeout | null = null;
  /** Settings the runner was started with; a change restarts it. */
  settingsKey = '';

  constructor(
    public cfg: WatchConfig,
    private host: AutomationHost,
    private onChange: () => void,
  ) {
    this.state = { id: cfg.id, name: cfg.name, paths: cfg.paths, targetIds: cfg.targetIds, enabled: cfg.enabled, status: 'paused', pendingFiles: 0, deferredTargets: [], sentFiles: 0, runs: 0 };
    this.describe();
  }

  describe(): void {
    Object.assign(this.state, { name: this.cfg.name, paths: this.cfg.paths, targetIds: this.cfg.targetIds, enabled: this.cfg.enabled, trigger: this.cfg.trigger ?? 'files', folders: this.cfg.folders ?? [], syncJobId: this.cfg.syncJobId });
  }

  private filter(): PathFilter {
    return makeFilter({ excludeFiles: [...this.cfg.options.excludeFiles, ...OWN_FILE_PATTERNS], excludeDirs: this.cfg.options.excludeDirs, alwaysExcludeDirs: [this.host.ctx().config.copy.backupFolderName, RELAY_FOLDER] });
  }

  private roots(): string[] {
    return this.cfg.paths.map(normalizeAbs);
  }

  /** Every destination: machines from the configuration and the plain folders. */
  private destinations(): string[] {
    return [...this.cfg.targetIds, ...folderNodes(this.cfg.folders).map((n) => n.id)];
  }

  start(): void {
    this.stop();
    this.state.enabled = this.cfg.enabled;
    this.state.error = undefined;
    if (!this.cfg.enabled || this.host.isPaused()) {
      this.state.status = 'paused';
      return;
    }
    const roots = this.roots();
    if (this.cfg.trigger === 'git') {
      const reflog = new ReflogWatcher(roots[0], this.cfg.gitEvents?.length ? this.cfg.gitEvents : DEFAULT_GIT_EVENTS, (moves) => void this.onHeadMoves(moves));
      this.reflog = reflog;
      this.state.status = 'watching';
      void reflog.start().then(() => {
        if (this.reflog !== reflog) return;
        this.state.error = reflog.error;
        this.state.status = reflog.error ? 'error' : 'watching';
        this.onChange();
      });
    } else {
      const filter = this.filter();
      this.collector = new ChangeCollector(roots, this.cfg.quietMs, (batch, contentOnly) => this.enqueue(batch, contentOnly), (abs) => {
        const root = roots.find((r) => isUnder(abs, r));
        if (!root) return false;
        const rel = toPosix(path.relative(root, abs));
        return !!rel && ancestorExcluded(filter, rel);
      });
      this.collector.start();
      this.state.error = this.collector.error;
      this.state.status = this.collector.error ? 'error' : 'watching';
    }
    const s = this.host.settings();
    if (s.retryUnreachable) this.retryTimer = setInterval(() => void this.retryDeferred(), s.retryEveryMinutes * 60_000);
    else this.deferred.clear();
    this.state.deferredTargets = [...this.deferred.keys()];
    // the differences that are already there go first
    if (this.cfg.syncOnStart) this.runNow();
  }

  /**
   * Sends what differs between the watched paths and the destinations now (or runs the sync job), whether
   * the watch is on or paused. Only differences go: equal files are skipped, nothing is deleted.
   */
  runNow(): void {
    this.fullPending = true;
    void this.drain();
  }

  /** Test hook: read the reflog now instead of waiting for the poll. */
  async pollGit(): Promise<void> {
    await this.reflog?.read();
  }

  isActive(): boolean {
    return !!this.collector || !!this.reflog;
  }

  stop(): void {
    this.collector?.stop();
    this.collector = null;
    this.reflog?.stop();
    this.reflog = null;
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    if (!this.busy) this.state.status = 'paused';
  }

  pendingCount(): number {
    return (this.collector?.pending ?? 0) + this.queue.size;
  }

  private async onHeadMoves(moves: HeadMove[]): Promise<void> {
    const roots = this.roots();
    const files = new Set<string>();
    for (const m of moves) {
      try {
        for (const f of underWatched(await changedFiles(roots[0], m.from, m.to), roots)) files.add(f);
      } catch (e) {
        this.host.ctx().log.error(t('İzleme'), t('{name}: Git değişiklikleri okunamadı', { name: this.cfg.name }), e);
      }
    }
    this.host.ctx().log.info(t('İzleme'), t('{name}: {events} → {n} dosya', { name: this.cfg.name, events: moves.map((m) => m.event).join(', '), n: files.size }));
    if (files.size) this.enqueue([...files], new Set());
  }

  private enqueue(batch: string[], contentOnly: Set<string>): void {
    for (const p of batch) this.queue.set(p, !contentOnly.has(p) || !!this.queue.get(p));
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy || (!this.queue.size && !this.fullPending)) return;
    this.busy = true;
    try {
      while (this.queue.size || this.fullPending) {
        if (this.fullPending) {
          this.fullPending = false;
          await this.send(this.roots(), this.destinations(), new Set(), true);
          continue;
        }
        const batch = [...this.queue.keys()];
        const contentOnly = new Set([...this.queue].filter(([, renamed]) => !renamed).map(([p]) => p));
        this.queue.clear();
        await this.send(batch, this.destinations(), contentOnly);
      }
    } finally {
      this.busy = false;
      this.settle();
    }
  }

  private settle(): void {
    if (this.collector) this.state.status = this.collector.error ? 'error' : 'watching';
    else if (this.reflog) this.state.status = this.reflog.error ? 'error' : 'watching';
    else this.state.status = 'paused';
    this.onChange();
  }

  private notify(status: RunDetail['status'] | 'blocked', body: string): void {
    const n = this.host.settings().notify;
    if (n === 'never' || (n === 'errors' && status === 'ok')) return;
    this.host.notify(`${status === 'ok' ? '✓' : '✕'} ${this.cfg.name}`, body);
  }

  /** `full`: `changed` are the watched paths themselves, sent whole; a missing one is never deleted on the targets. */
  private async send(changed: string[], targetIds: string[], contentOnly: Set<string> = new Set(), full = false): Promise<void> {
    const ctx = this.host.ctx();
    const settings = this.host.settings();
    const roots = this.roots();
    const sources = await changesToSources(changed, roots, this.filter(), !full && this.cfg.options.propagateDeletes, contentOnly);
    if (!sources.length) {
      if (!full) return;
      this.state.lastRunAt = Date.now();
      this.state.lastStatus = 'failed';
      this.state.lastSummary = t('İzlenen dosya ve klasörler bulunamadı');
      return;
    }
    if (!full && settings.maxFilesPerSend && sources.length > settings.maxFilesPerSend) {
      // a branch switch or a mass rename seen as file changes should not go out on its own
      this.state.lastRunAt = Date.now();
      this.state.lastStatus = 'cancelled';
      this.state.lastSummary = t('{n} değişiklik birden geldi; sınır {max}, gönderilmedi', { n: sources.length, max: settings.maxFilesPerSend });
      this.notify('blocked', this.state.lastSummary);
      return;
    }
    if (this.cfg.syncJobId) return this.runSyncJob();
    this.state.status = 'sending';
    this.onChange();
    const files = sources.length;
    const label = t('Otomatik: {name}', { name: this.cfg.name });
    const options = { ...this.cfg.options, dryRun: false };
    try {
      const plans: { plan: SendPlan; nodes?: NodeConfig[] }[] = [];
      const machines = targetIds.filter((id) => !isFolderTarget(id));
      if (machines.length) plans.push({ plan: await buildSendPlan(ctx, { sources, targetIds: machines, options, origin: 'send', label }) });
      const wanted = new Set(targetIds.filter(isFolderTarget));
      const nodes = folderNodes(this.cfg.folders).filter((n) => wanted.has(n.id));
      if (nodes.length) {
        for (const n of nodes) await fsp.mkdir(n.path!, { recursive: true }).catch(() => undefined);
        // a plain folder receives each watched folder's content, relative to that folder
        const local = roots.map((r) => (fs.existsSync(r) && fs.statSync(r).isFile() ? path.dirname(r) : r));
        const fctx: CoreContext = { ...ctx, localRoots: local, config: { ...ctx.config, nodes: [...ctx.config.nodes, ...nodes] } };
        plans.push({ plan: await buildSendPlan(fctx, { sources, targetIds: nodes.map((n) => n.id), options, origin: 'send', label }), nodes });
      }
      const unreachable: string[] = [];
      for (const { plan } of plans) {
        for (const tp of plan.targets) {
          if (tp.reachable) this.deferred.delete(tp.targetId);
          else {
            unreachable.push(tp.targetName);
            if (!settings.retryUnreachable) continue;
            // unreachable targets keep the changed paths and get them again later
            const set = this.deferred.get(tp.targetId) ?? new Set<string>();
            for (const p of changed) set.add(p);
            this.deferred.set(tp.targetId, set);
          }
        }
      }
      this.state.deferredTargets = [...this.deferred.keys()];
      this.state.unreachableTargets = settings.retryUnreachable ? [] : unreachable;
      this.state.lastRunAt = Date.now();
      const ops = plans.reduce((s, { plan }) => s + plan.targets.reduce((a, tp) => a + (tp.reachable ? tp.ops.filter((o) => o.selected).length : 0), 0), 0);
      if (!ops) {
        this.state.lastStatus = 'nothing';
        this.state.lastSummary = full ? t('Hedefler zaten güncel') : t('{n} değişiklik, hedefler zaten güncel', { n: files });
        return;
      }
      let ok = 0;
      let failed = 0;
      let targets = 0;
      let status: RunDetail['status'] = 'ok';
      for (const { plan, nodes: extra } of plans) {
        const handle = this.host.runPlan(plan, false, extra);
        if (!handle) continue;
        this.state.lastRunId = handle.id;
        const detail: RunDetail = await handle.done;
        this.state.runs++;
        ok += detail.opsOk;
        failed += detail.opsFailed;
        targets += detail.targets.length;
        if (detail.status !== 'ok') status = detail.status;
      }
      this.state.sentFiles += ok;
      this.state.lastStatus = status;
      const sum = { n: ok, targets, failed };
      this.state.lastSummary = failed ? t('{n} işlem • {targets} hedef • {failed} hata', sum) : t('{n} işlem • {targets} hedef', sum);
      this.notify(status, failed ? t('Otomatik gönderim: {n} hatalı işlem', { n: failed }) : this.state.lastSummary);
    } catch (e) {
      this.state.lastStatus = 'failed';
      this.state.lastSummary = errMessage(e);
      this.host.ctx().log.error(t('İzleme'), t('{name}: gönderim başarısız', { name: this.cfg.name }), e);
    }
  }

  /** Live sync: a change runs the chosen sync job (both directions, mirror… as the job says). */
  private async runSyncJob(): Promise<void> {
    const job = this.host.ctx().config.syncJobs.find((j) => j.id === this.cfg.syncJobId);
    this.state.lastRunAt = Date.now();
    if (!job) {
      this.state.lastStatus = 'failed';
      this.state.lastSummary = t('Senkron işi bulunamadı: {id}', { id: this.cfg.syncJobId ?? '' });
      return;
    }
    this.state.status = 'sending';
    this.onChange();
    try {
      const { handle } = await this.host.runSyncDefault(job, t('Otomatik: {name}', { name: this.cfg.name }));
      if (!handle) {
        this.state.lastStatus = 'nothing';
        this.state.lastSummary = t('Değişiklik yok');
        return;
      }
      this.state.lastRunId = handle.id;
      const d = await handle.done;
      this.state.runs++;
      this.state.sentFiles += d.opsOk;
      this.state.lastStatus = d.status;
      this.state.lastSummary = d.opsFailed ? t('{n} işlem • {failed} hata', { n: d.opsOk, failed: d.opsFailed }) : t('{n} işlem', { n: d.opsOk });
      this.notify(d.status, this.state.lastSummary);
    } catch (e) {
      this.state.lastStatus = 'failed';
      this.state.lastSummary = errMessage(e);
      this.host.ctx().log.error(t('İzleme'), t('{name}: senkron başarısız', { name: this.cfg.name }), e);
    }
  }

  private async retryDeferred(): Promise<void> {
    if (this.busy || !this.deferred.size || this.host.isPaused()) return;
    const targets = [...this.deferred.keys()];
    const paths = new Set<string>();
    for (const s of this.deferred.values()) for (const p of s) paths.add(p);
    this.busy = true;
    try {
      await this.send([...paths], targets);
    } finally {
      this.busy = false;
      this.settle();
      // what arrived meanwhile
      void this.drain();
    }
  }
}

// ------------------------------------------------------------------ schedules

function parseTime(t: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? [h, mi] : null;
}

/** Next due time of a schedule after `last` (or after `since` when it never ran). */
export function nextRun(s: SyncSchedule, last: number | undefined, since: number, now = Date.now(), catchUp = true): number | undefined {
  if (s.mode === 'interval') {
    const every = Math.max(1, s.everyMinutes) * 60_000;
    return (last ?? since) + every;
  }
  const times = s.times.map(parseTime).filter((x): x is [number, number] => !!x);
  if (!times.length) return undefined;
  // without catching up, a slot that already passed is skipped, not run late
  const after = Math.max(last ?? since, since, catchUp ? -Infinity : now);
  let best: number | undefined;
  for (let day = 0; day <= 1; day++) {
    for (const [h, m] of times) {
      const d = new Date(now);
      d.setDate(d.getDate() + day);
      d.setHours(h, m, 0, 0);
      const at = d.getTime();
      if (at > after && (best == null || at < best)) best = at;
    }
  }
  // a slot passed while the app was closed today: run it now
  for (const [h, m] of catchUp ? times : []) {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > after && d.getTime() <= now) return d.getTime();
  }
  return best;
}

// ------------------------------------------------------------------ automation

export class Automation {
  private runners = new Map<string, WatchRunner>();
  private running = new Set<string>();
  private lastResult = new Map<string, { status: ScheduleState['lastStatus']; summary: string }>();
  private tick: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();

  constructor(private host: AutomationHost) {}

  start(): void {
    this.syncRunners();
    if (!this.tick) this.tick = setInterval(() => void this.checkSchedules(), 20_000);
    setTimeout(() => void this.checkSchedules(), 5_000);
    this.emit();
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    for (const r of this.runners.values()) r.stop();
  }

  /** Re-reads watch configs and (re)starts their runners. */
  syncRunners(): void {
    const cfgs = this.host.getWatches();
    const settingsKey = JSON.stringify(this.host.settings());
    for (const [id, r] of this.runners) {
      if (!cfgs.some((c) => c.id === id)) {
        r.stop();
        this.runners.delete(id);
      }
    }
    for (const c of cfgs) {
      const existing = this.runners.get(c.id);
      const shouldRun = c.enabled && !this.host.isPaused();
      if (existing && JSON.stringify(existing.cfg) === JSON.stringify(c) && existing.settingsKey === settingsKey && existing.isActive() === shouldRun) continue;
      existing?.stop();
      const r = existing ?? new WatchRunner(c, this.host, () => this.emit());
      r.cfg = c;
      r.settingsKey = settingsKey;
      r.describe();
      this.runners.set(c.id, r);
      r.start();
    }
  }

  snapshot(): AutomationState {
    const ctx = this.host.ctx();
    const runs = this.host.getScheduleRuns();
    const local = ctx.localNodeId;
    const schedules: ScheduleState[] = ctx.config.syncJobs
      .filter((j) => j.schedule)
      .map((j) => {
        const s = j.schedule!;
        const activeHere = !s.machineId || s.machineId.toLowerCase() === (local ?? '').toLowerCase();
        const last = runs[j.id];
        const r = this.lastResult.get(j.id);
        return {
          jobId: j.id,
          name: j.name,
          enabled: s.enabled,
          activeHere,
          reason: activeHere ? undefined : t('Yalnızca {machine} makinesinde çalışır', { machine: s.machineId ?? '' }),
          running: this.running.has(j.id),
          nextAt: s.enabled && activeHere ? nextRun(s, last, this.startedAt, Date.now(), this.host.settings().catchUpSchedules) : undefined,
          lastAt: last,
          lastStatus: r?.status,
          lastSummary: r?.summary,
        };
      });
    const watches = [...this.runners.values()].map((r) => ({ ...r.state, pendingFiles: r.pendingCount() }));
    return { paused: this.host.isPaused(), watches, schedules };
  }

  emit(): void {
    this.host.emit(this.snapshot());
  }

  async addWatch(c: Omit<WatchConfig, 'id'>): Promise<AutomationState> {
    const list = [...this.host.getWatches(), { ...c, id: newId('w-') }];
    await this.host.saveWatches(list);
    this.syncRunners();
    this.emit();
    return this.snapshot();
  }

  async updateWatch(id: string, patch: Partial<WatchConfig>): Promise<AutomationState> {
    await this.host.saveWatches(this.host.getWatches().map((w) => (w.id === id ? { ...w, ...patch, id } : w)));
    this.syncRunners();
    this.emit();
    return this.snapshot();
  }

  /** "Send now" on a watch card. */
  runWatch(id: string): void {
    const r = this.runners.get(id);
    if (!r) throw new Error(t('İzleme bulunamadı'));
    r.runNow();
    this.emit();
  }

  async removeWatch(id: string): Promise<AutomationState> {
    await this.host.saveWatches(this.host.getWatches().filter((w) => w.id !== id));
    this.syncRunners();
    this.emit();
    return this.snapshot();
  }

  async checkSchedules(): Promise<void> {
    if (this.host.isPaused()) return;
    const now = Date.now();
    for (const s of this.snapshot().schedules) {
      if (!s.enabled || !s.activeHere || s.running || s.nextAt == null || s.nextAt > now) continue;
      const job = this.host.ctx().config.syncJobs.find((j) => j.id === s.jobId);
      if (job) await this.runSchedule(job);
    }
  }

  async runSchedule(job: SyncJob): Promise<void> {
    if (this.running.has(job.id)) return;
    this.running.add(job.id);
    this.emit();
    const global = this.host.settings().notify;
    const notify = global === 'never' ? 'never' : job.schedule?.notify ?? 'errors';
    try {
      const { handle, actions } = await this.host.runSyncDefault(job, t('Zamanlanmış: {name}', { name: job.name }));
      if (!handle) {
        this.lastResult.set(job.id, { status: 'nothing', summary: actions ? t('Yalnızca çakışmalar var') : t('Değişiklik yok') });
        if (notify === 'always') this.host.notify(`= ${job.name}`, t('Değişiklik yok'));
      } else {
        const d = await handle.done;
        this.lastResult.set(job.id, { status: d.status, summary: d.opsFailed ? t('{n} işlem • {failed} hata', { n: d.opsOk, failed: d.opsFailed }) : t('{n} işlem', { n: d.opsOk }) });
        if (notify === 'always' || notify === 'changes' || d.status !== 'ok')
          this.host.notify(`${d.status === 'ok' ? '✓' : '✕'} ${job.name}`, t('{ok} başarılı, {failed} hatalı', { ok: d.opsOk, failed: d.opsFailed }));
      }
    } catch (e) {
      this.lastResult.set(job.id, { status: 'failed', summary: errMessage(e) });
      this.host.ctx().log.error(t('Zamanlama'), t('{name} çalışmadı', { name: job.name }), e);
      if (notify !== 'never') this.host.notify(`✕ ${job.name}`, errMessage(e));
    } finally {
      this.running.delete(job.id);
      await this.host.saveScheduleRun(job.id, Date.now());
      this.emit();
    }
  }

  /** Test hook: read the reflog of git watches now. */
  async pollGit(): Promise<void> {
    for (const r of this.runners.values()) await r.pollGit();
  }

  setPaused(): void {
    this.syncRunners();
    this.emit();
  }
}

