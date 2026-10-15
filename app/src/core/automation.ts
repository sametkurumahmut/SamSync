import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AutomationState, RunDetail, ScheduleState, SendPlan, SourceSpec, SyncJob, SyncSchedule, WatchConfig, WatchState } from '../shared/types';
import type { CoreContext } from './context';
import type { RunHandle } from './executor';
import { buildSendPlan } from './plan';
import { makeFilter, ancestorExcluded, type PathFilter } from './filter';
import { isUnder, normalizeAbs, toPosix } from './paths';
import { errMessage, newId } from './util';

/** What the automation needs from the service (kept narrow so it can be tested without Electron). */
export interface AutomationHost {
  ctx(): CoreContext;
  runPlan(plan: SendPlan, notify: boolean): RunHandle | null;
  runSyncDefault(job: SyncJob, label: string): Promise<{ handle: RunHandle | null; actions: number }>;
  getWatches(): WatchConfig[];
  saveWatches(w: WatchConfig[]): Promise<void>;
  getScheduleRuns(): Record<string, number>;
  saveScheduleRun(jobId: string, at: number): Promise<void>;
  isPaused(): boolean;
  notify(title: string, body: string): void;
  emit(state: AutomationState): void;
}

const IGNORED = [/(^|[\\/])\.git([\\/]|$)/, /~$/, /\.(tmp|swp|swx|crdownload|part)$/i, /\.samsync-tmp$/, /(^|[\\/])~\$[^\\/]*$/, /(^|[\\/])\.~lock\./];
const RETRY_MS = 60_000;

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

class WatchRunner {
  readonly state: WatchState;
  private collector: ChangeCollector | null = null;
  /** path -> saw a create/rename */
  private queue = new Map<string, boolean>();
  private busy = false;
  private deferred = new Map<string, Set<string>>();
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    public cfg: WatchConfig,
    private host: AutomationHost,
    private onChange: () => void,
  ) {
    this.state = { id: cfg.id, name: cfg.name, paths: cfg.paths, targetIds: cfg.targetIds, enabled: cfg.enabled, status: 'paused', pendingFiles: 0, deferredTargets: [], sentFiles: 0, runs: 0 };
  }

  private filter(): PathFilter {
    return makeFilter({ excludeFiles: this.cfg.options.excludeFiles, excludeDirs: this.cfg.options.excludeDirs, alwaysExcludeDirs: [this.host.ctx().config.copy.backupFolderName] });
  }

  start(): void {
    this.stop();
    this.state.enabled = this.cfg.enabled;
    if (!this.cfg.enabled || this.host.isPaused()) {
      this.state.status = 'paused';
      return;
    }
    const filter = this.filter();
    const roots = this.cfg.paths.map(normalizeAbs);
    this.collector = new ChangeCollector(roots, this.cfg.quietMs, (batch, contentOnly) => this.enqueue(batch, contentOnly), (abs) => {
      const root = roots.find((r) => isUnder(abs, r));
      if (!root) return false;
      const rel = toPosix(path.relative(root, abs));
      return !!rel && ancestorExcluded(filter, rel);
    });
    this.collector.start();
    this.state.error = this.collector.error;
    this.state.status = this.collector.error ? 'error' : 'watching';
    this.retryTimer = setInterval(() => void this.retryDeferred(), RETRY_MS);
  }

  isActive(): boolean {
    return !!this.collector;
  }

  stop(): void {
    this.collector?.stop();
    this.collector = null;
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    if (!this.busy) this.state.status = 'paused';
  }

  pendingCount(): number {
    return (this.collector?.pending ?? 0) + this.queue.size;
  }

  private enqueue(batch: string[], contentOnly: Set<string>): void {
    for (const p of batch) this.queue.set(p, !contentOnly.has(p) || !!this.queue.get(p));
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy || !this.queue.size) return;
    this.busy = true;
    try {
      while (this.queue.size) {
        const batch = [...this.queue.keys()];
        const contentOnly = new Set([...this.queue].filter(([, renamed]) => !renamed).map(([p]) => p));
        this.queue.clear();
        await this.send(batch, this.cfg.targetIds, contentOnly);
      }
    } finally {
      this.busy = false;
      if (this.collector) this.state.status = this.collector.error ? 'error' : 'watching';
      else this.state.status = 'paused';
      this.onChange();
    }
  }

  private async send(changed: string[], targetIds: string[], contentOnly: Set<string> = new Set()): Promise<void> {
    const ctx = this.host.ctx();
    const sources = await changesToSources(changed, this.cfg.paths.map(normalizeAbs), this.filter(), this.cfg.options.propagateDeletes, contentOnly);
    if (!sources.length) return;
    this.state.status = 'sending';
    this.onChange();
    const files = sources.length;
    try {
      const plan = await buildSendPlan(ctx, {
        sources,
        targetIds,
        options: { ...this.cfg.options, dryRun: false },
        origin: 'send',
        label: `Otomatik: ${this.cfg.name}`,
      });
      // unreachable targets keep the changed paths and get them again later
      for (const t of plan.targets) {
        if (t.reachable) this.deferred.delete(t.targetId);
        else {
          const set = this.deferred.get(t.targetId) ?? new Set<string>();
          for (const p of changed) set.add(p);
          this.deferred.set(t.targetId, set);
        }
      }
      this.state.deferredTargets = [...this.deferred.keys()];
      const ops = plan.targets.reduce((s, t) => s + (t.reachable ? t.ops.filter((o) => o.selected).length : 0), 0);
      this.state.lastRunAt = Date.now();
      if (!ops) {
        this.state.lastStatus = 'nothing';
        this.state.lastSummary = `${files} değişiklik, hedefler zaten güncel`;
        return;
      }
      const handle = this.host.runPlan(plan, false);
      if (!handle) return;
      this.state.lastRunId = handle.id;
      const detail: RunDetail = await handle.done;
      this.state.runs++;
      this.state.sentFiles += detail.opsOk;
      this.state.lastStatus = detail.status;
      this.state.lastSummary = `${detail.opsOk} işlem • ${detail.targets.length} hedef${detail.opsFailed ? ` • ${detail.opsFailed} hata` : ''}`;
      if (detail.status !== 'ok') this.host.notify(`✕ ${this.cfg.name}`, `Otomatik gönderim: ${detail.opsFailed} hatalı işlem`);
    } catch (e) {
      this.state.lastStatus = 'failed';
      this.state.lastSummary = errMessage(e);
      this.host.ctx().log.error('İzleme', `${this.cfg.name}: gönderim başarısız`, e);
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
      if (this.collector) this.state.status = 'watching';
      this.onChange();
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
export function nextRun(s: SyncSchedule, last: number | undefined, since: number, now = Date.now()): number | undefined {
  if (s.mode === 'interval') {
    const every = Math.max(1, s.everyMinutes) * 60_000;
    return (last ?? since) + every;
  }
  const times = s.times.map(parseTime).filter((x): x is [number, number] => !!x);
  if (!times.length) return undefined;
  const after = Math.max(last ?? since, since);
  let best: number | undefined;
  for (let day = 0; day <= 1; day++) {
    for (const [h, m] of times) {
      const d = new Date(now);
      d.setDate(d.getDate() + day);
      d.setHours(h, m, 0, 0);
      const t = d.getTime();
      if (t > after && (best == null || t < best)) best = t;
    }
  }
  // a slot passed while the app was closed today: run it now
  for (const [h, m] of times) {
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
    for (const [id, r] of this.runners) {
      if (!cfgs.some((c) => c.id === id)) {
        r.stop();
        this.runners.delete(id);
      }
    }
    for (const c of cfgs) {
      const existing = this.runners.get(c.id);
      const shouldRun = c.enabled && !this.host.isPaused();
      if (existing && JSON.stringify(existing.cfg) === JSON.stringify(c) && existing.isActive() === shouldRun) continue;
      existing?.stop();
      const r = existing ?? new WatchRunner(c, this.host, () => this.emit());
      r.cfg = c;
      Object.assign(r.state, { name: c.name, paths: c.paths, targetIds: c.targetIds, enabled: c.enabled });
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
          reason: activeHere ? undefined : `Yalnızca ${s.machineId} makinesinde çalışır`,
          running: this.running.has(j.id),
          nextAt: s.enabled && activeHere ? nextRun(s, last, this.startedAt) : undefined,
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
    const notify = job.schedule?.notify ?? 'errors';
    try {
      const { handle, actions } = await this.host.runSyncDefault(job, `Zamanlanmış: ${job.name}`);
      if (!handle) {
        this.lastResult.set(job.id, { status: 'nothing', summary: actions ? 'Yalnızca çakışmalar var' : 'Değişiklik yok' });
        if (notify === 'always') this.host.notify(`= ${job.name}`, 'Değişiklik yok');
      } else {
        const d = await handle.done;
        this.lastResult.set(job.id, { status: d.status, summary: `${d.opsOk} işlem${d.opsFailed ? ` • ${d.opsFailed} hata` : ''}` });
        if (notify === 'always' || notify === 'changes' || d.status !== 'ok')
          this.host.notify(`${d.status === 'ok' ? '✓' : '✕'} ${job.name}`, `${d.opsOk} başarılı, ${d.opsFailed} hatalı`);
      }
    } catch (e) {
      this.lastResult.set(job.id, { status: 'failed', summary: errMessage(e) });
      this.host.ctx().log.error('Zamanlama', `${job.name} çalışmadı`, e);
      this.host.notify(`✕ ${job.name}`, errMessage(e));
    } finally {
      this.running.delete(job.id);
      await this.host.saveScheduleRun(job.id, Date.now());
      this.emit();
    }
  }

  setPaused(): void {
    this.syncRunners();
    this.emit();
  }
}

