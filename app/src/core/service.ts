import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Api, IntegrationStatus, PickOptions, BrowseEntry } from '../shared/api';
import type {
  AppConfig,
  AppEvent,
  Bootstrap,
  CompareResult,
  DiffResult,
  LocalIdentity,
  LocalSettings,
  SendPlan,
  SendRequest,
  SourceSpec,
  SyncAction,
  SyncJob,
  UpdateConfig,
  UpdateState,
  GitRepoInfo,
  AutomationState,
  WatchConfig,
  WizardImportResult,
} from '../shared/types';
import type { CoreContext } from './context';
import { DEFAULT_SETTINGS, emptyConfig, loadConfig, readJson, saveConfigFile, writeJsonAtomic, normalizeConfig } from './config';
import { detectIdentity } from './identity';
import { createLogger, type Logger } from './logger';
import { History, pruneReports } from './history';
import { buildSendPlan, describeSources } from './plan';
import { startRun, type ExecGroup, type ExecSettings, type RunHandle } from './executor';
import { probeNodes } from './probe';
import { transportForNode, transportForEndpoint, nodeRootLabel } from './transport';
import { mapToRel, normalizeAbs, pathKey } from './paths';
import { textDiff, MAX_TEXT_DIFF_BYTES } from './textdiff';
import * as git from './git';
import { compareJob, syncGroups, updateDbAfterRun, resetDb } from './sync';
import { findBackups, listBackupSets, browseBackup, restoreGroups } from './backups';
import { findNode } from './context';
import { CancelToken, errMessage } from './util';
import { Automation } from './automation';
import { convertWizardState, findWizardStates, isWizardState } from './wizardImport';
import { resolveLang, setLang, systemLang, t, type Lang } from '../shared/i18n';

export interface HostAdapter {
  isElectron: boolean;
  appVersion: string;
  userDataPath: string;
  initialPaths: string[];
  initialTargets?: string[];
  /** The computer's preferred language tags, most preferred first ("tr-TR", "en-US"). */
  systemLanguages?: string[];
  emit(e: AppEvent): void;
  pick?(opts: PickOptions): Promise<string[]>;
  openPath?(p: string): Promise<void>;
  showInFolder?(p: string): Promise<void>;
  openExternal?(url: string): Promise<void>;
  encrypt?(plain: string): string | null;
  decrypt?(enc: string): string | null;
  notify?(title: string, body: string): void;
  /** Explorer menu and Notepad++ entries (Windows); apply() rewrites them from the current settings. */
  integrations?: { status(): IntegrationStatus; apply(): Promise<IntegrationStatus> };
  updater?: {
    configure(cfg: UpdateConfig | undefined, settings: LocalSettings): void;
    state(): UpdateState;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): void;
  };
  windowControl?(action: 'minimize' | 'maximize' | 'close' | 'devtools' | 'reload'): void;
  setChrome?(opts: { theme: 'system' | 'light' | 'dark'; bg: string; fg: string }): void;
  /** Tray, close-to-tray and launch-at-login follow these settings. */
  applySettings?(s: LocalSettings, automation: AutomationState): void;
}

async function readCapped(stream: NodeJS.ReadableStream, cap = MAX_TEXT_DIFF_BYTES + 1): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream as AsyncIterable<Buffer>) {
    chunks.push(c);
    n += c.length;
    if (n >= cap) {
      (stream as any).destroy?.();
      break;
    }
  }
  return Buffer.concat(chunks);
}

export class Service implements Api {
  private settingsFile: string;
  private secretsFile: string;
  settings: LocalSettings = { ...DEFAULT_SETTINGS };
  config: AppConfig = emptyConfig();
  configPath = '';
  configError?: string;
  identity!: LocalIdentity;
  readonly log: Logger;
  readonly history: History;
  private plans = new Map<string, SendPlan>();
  private compares = new Map<string, { job: SyncJob; result: CompareResult }>();
  private runsActive = new Map<string, RunHandle>();
  private tasks = new Map<string, CancelToken>();
  private gitVersion: string | null = null;
  automation: Automation | null = null;

  constructor(private host: HostAdapter) {
    this.settingsFile = path.join(host.userDataPath, 'settings.json');
    this.secretsFile = path.join(host.userDataPath, 'secrets.json');
    const logEnv = process.env.SAMSYNC_LOG;
    const logDir = logEnv ? path.dirname(logEnv) : path.join(host.userDataPath, 'log');
    this.log = createLogger(logDir);
    this.history = new History(host.userDataPath);
  }

  async init(): Promise<void> {
    try {
      const raw = (await readJson(this.settingsFile)) as Partial<LocalSettings>;
      this.settings = { ...DEFAULT_SETTINGS, ...raw };
      delete (this.settings as { lang?: unknown }).lang; // 2.0.0 kept an unused "lang"; "language" replaced it
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    setLang(this.uiLang());
    await this.loadConfigFrom(process.env.SAMSYNC_CONFIG || this.settings.configPath || path.join(this.host.userDataPath, 'config.json'));
    this.gitVersion = await git.gitVersion();
    this.log.info(
      t('Uygulama'),
      t('SamSync {version} başladı ({host}, {platform}); config: {config}; node: {node} ({reason})', {
        version: this.host.appVersion,
        host: os.hostname(),
        platform: process.platform,
        config: this.configPath,
        node: this.identity.node?.id ?? '-',
        reason: this.identity.reason,
      }),
    );
    this.host.updater?.configure(this.config.update, this.settings);
    this.automation = new Automation({
      ctx: () => this.ctx(),
      runPlan: (plan, notify) => {
        try {
          return this.runPlan(plan, 'default', { notify });
        } catch {
          return null;
        }
      },
      runSyncDefault: (job, label) => this.runSyncDefault(job, label),
      getWatches: () => this.settings.watches ?? [],
      saveWatches: async (w) => {
        this.settings.watches = w;
        await this.persistSettings();
      },
      getScheduleRuns: () => this.settings.scheduleRuns ?? {},
      saveScheduleRun: async (id, at) => {
        this.settings.scheduleRuns = { ...(this.settings.scheduleRuns ?? {}), [id]: at };
        await this.persistSettings();
      },
      isPaused: () => !!this.settings.automationPaused,
      notify: (title, body) => this.host.notify?.(title, body),
      emit: (state) => {
        this.host.emit({ type: 'automation', state });
        this.host.applySettings?.(this.settings, state);
      },
    });
    this.automation.start();
  }

  private async loadConfigFrom(file: string) {
    this.configPath = file;
    this.configError = undefined;
    try {
      if (fs.existsSync(file)) this.config = await loadConfig(file);
      else this.config = emptyConfig();
    } catch (e) {
      this.configError = errMessage(e);
      this.config = emptyConfig();
      this.log.error(t('Config'), t('Yapılandırma okunamadı: {path}', { path: file }), e);
    }
    this.identity = detectIdentity(this.config, this.settings.localNodeId);
  }

  ctx(): CoreContext {
    return {
      config: this.config,
      localRoots: this.identity.node?.localRoots ?? [],
      localNodeId: this.identity.node?.id,
      userDataPath: this.host.userDataPath,
      getSecret: (id) => this.getSecret(id),
      emit: (e) => this.host.emit(e),
      log: this.log,
    };
  }

  private configWritable(): boolean {
    try {
      const target = fs.existsSync(this.configPath) ? this.configPath : path.dirname(this.configPath);
      fs.accessSync(target, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ bootstrap & config

  get systemLang(): Lang {
    return systemLang(this.host.systemLanguages ?? []);
  }

  /** The language the UI, menus and messages use now. */
  uiLang(): Lang {
    return resolveLang(this.settings.language, this.systemLang);
  }

  async bootstrap(): Promise<Bootstrap> {
    return {
      appVersion: this.host.appVersion,
      platform: process.platform,
      hostname: os.hostname(),
      config: this.config,
      configPath: this.configPath,
      configWritable: this.configWritable(),
      configError: this.configError,
      settings: this.settings,
      identity: this.identity,
      initialPaths: this.host.initialPaths.splice(0),
      initialTargets: this.host.initialTargets?.splice(0) ?? [],
      userDataPath: this.host.userDataPath,
      isElectron: this.host.isElectron,
      systemLang: this.systemLang,
      gitAvailable: !!this.gitVersion,
      gitVersion: this.gitVersion ?? undefined,
    };
  }

  async saveConfig(cfg: AppConfig) {
    const normalized = normalizeConfig(cfg);
    await saveConfigFile(this.configPath, normalized);
    this.config = normalized;
    this.configError = undefined;
    this.identity = detectIdentity(this.config, this.settings.localNodeId);
    this.host.emit({ type: 'config-changed', config: this.config });
    this.host.updater?.configure(this.config.update, this.settings);
    this.automation?.emit();
    this.log.info(t('Config'), t('Yapılandırma kaydedildi ({n} node)', { n: this.config.nodes.length }));
    return { config: this.config, identity: this.identity };
  }

  async readConfigFile(p: string): Promise<AppConfig> {
    return loadConfig(p);
  }

  async useConfigFile(p: string | null): Promise<Bootstrap> {
    this.settings.configPath = p || undefined;
    await this.persistSettings();
    await this.loadConfigFrom(p || path.join(this.host.userDataPath, 'config.json'));
    this.host.updater?.configure(this.config.update, this.settings);
    return this.bootstrap();
  }

  async saveSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
    const pinChanged = 'localNodeId' in patch && patch.localNodeId !== this.settings.localNodeId;
    this.settings = { ...this.settings, ...patch };
    await this.persistSettings();
    if (pinChanged) this.identity = detectIdentity(this.config, this.settings.localNodeId);
    if ('updateAutoCheck' in patch || 'updateAutoDownload' in patch) this.host.updater?.configure(this.config.update, this.settings);
    if ('automationPaused' in patch) this.automation?.setPaused();
    if ('language' in patch) setLang(this.uiLang());
    if (this.automation) this.host.applySettings?.(this.settings, this.automation.snapshot());
    return this.settings;
  }

  private async persistSettings() {
    await writeJsonAtomic(this.settingsFile, this.settings);
  }

  private async readSecrets(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fsp.readFile(this.secretsFile, 'utf8'));
    } catch {
      return {};
    }
  }

  async setSecret(nodeId: string, secret: string | null): Promise<boolean> {
    if (!this.host.encrypt) return false;
    const all = await this.readSecrets();
    if (secret) {
      const enc = this.host.encrypt(secret);
      if (!enc) return false;
      all[nodeId] = enc;
    } else delete all[nodeId];
    await writeJsonAtomic(this.secretsFile, all);
    return true;
  }

  private async getSecret(nodeId: string): Promise<string | undefined> {
    const enc = (await this.readSecrets())[nodeId];
    if (!enc || !this.host.decrypt) return undefined;
    return this.host.decrypt(enc) ?? undefined;
  }

  // ------------------------------------------------------------ targets & sources

  async probe(nodeIds?: string[]) {
    const nodes = this.config.nodes.filter((n) => n.enabled && n.id !== this.identity.node?.id && (!nodeIds || nodeIds.includes(n.id)));
    const results = await probeNodes(this.config, nodes);
    this.host.emit({ type: 'probe', results });
    return results;
  }

  async describeSources(paths: string[], count = true) {
    return describeSources(this.ctx(), paths, count);
  }

  async mapPath(abs: string) {
    return mapToRel(abs, this.ctx().localRoots);
  }

  // ------------------------------------------------------------ send

  async planSend(req: SendRequest, taskId: string): Promise<SendPlan> {
    const cancel = new CancelToken();
    this.tasks.set(taskId, cancel);
    try {
      this.log.info(
        t('Plan'),
        t('{n} kaynak → {targets} ({mode}, {compare})', { n: req.sources.length, targets: req.targetIds.join(', '), mode: req.options.mode, compare: req.options.compare }),
      );
      const plan = await buildSendPlan(this.ctx(), req, {
        cancel,
        onProgress: (p) => this.host.emit({ type: 'task-progress', taskId, message: p.message, done: p.done, total: p.total }),
      });
      this.plans.set(plan.id, plan);
      while (this.plans.size > 12) this.plans.delete(this.plans.keys().next().value!);
      return plan;
    } finally {
      this.tasks.delete(taskId);
    }
  }

  async cancelTask(taskId: string) {
    this.tasks.get(taskId)?.cancel();
  }

  private execSettings(label: string, origin: SendRequest['origin'], o: Partial<SendRequest['options']>, extra: Partial<ExecSettings> = {}): ExecSettings {
    const c = this.config.copy;
    return {
      label,
      origin,
      dryRun: !!o.dryRun,
      backup: !!o.backup,
      backupKeep: c.backupKeep,
      backupFolderName: c.backupFolderName,
      verify: o.verify ?? c.verify,
      retryCount: c.retryCount,
      waitSeconds: c.waitSeconds,
      parallelGroups: o.parallelTargets ?? c.parallelTargets,
      parallelFiles: c.parallelFiles,
      postCommand: o.runPostCommand ? c.postCommand : undefined,
      postCommandTimeoutSeconds: c.postCommandTimeoutSeconds,
      bandwidthMBps: c.bandwidthMBps,
      sources: [],
      targetIds: [],
      options: o,
      ...extra,
    };
  }

  private track(handle: RunHandle, notify: boolean, after?: (d: Awaited<RunHandle['done']>) => Promise<void>) {
    this.runsActive.set(handle.id, handle);
    handle.done
      .then(async (detail) => {
        await this.history.save(detail).catch((e) => this.log.error(t('Geçmiş'), t('Kaydedilemedi'), e));
        // a CSV report for every run, as the old tool wrote one for every copy
        await this.history
          .exportCsv(detail.id, this.reportsDir())
          .then(() => pruneReports(this.reportsDir()))
          .catch((e) => this.log.error(t('Geçmiş'), t('Rapor yazılamadı'), e));
        if (after) await after(detail).catch((e) => this.log.error(t('Senkron'), t('Sonrası işlem'), e));
        if (notify && this.host.notify) {
          const icon = detail.status === 'ok' ? '✓' : detail.status === 'cancelled' ? '–' : '✕';
          this.host.notify(
            `${icon} ${detail.label}`,
            t('{ok} başarılı, {failed} hatalı • {n} hedef', { ok: detail.opsOk, failed: detail.opsFailed, n: detail.targets.length }),
          );
        }
      })
      .catch((e) => this.log.error(t('Kopyala'), t('Çalıştırma hatası'), e))
      .finally(() => this.runsActive.delete(handle.id));
  }

  /** Runs a plan; 'default' runs every operation the planner selected. Throws when there is nothing to do. */
  runPlan(plan: SendPlan, selected: Record<string, string[]> | 'default', overrides: { dryRun?: boolean; notify?: boolean; unreachableFails?: boolean } = {}): RunHandle {
    const ctx = this.ctx();
    const groups: ExecGroup[] = [];
    for (const tp of plan.targets) {
      if (!tp.reachable) {
        // a machine that was off counts as failed, so "select the failed ones" and "resend to failed" include it
        if (overrides.unreachableFails) {
          const why = tp.error || t('Hedefe erişilemiyor');
          groups.push({ key: tp.targetId, title: tp.targetName, rootLabel: tp.root, open: () => Promise.reject(new Error(why)), node: findNode(this.config, tp.targetId) ?? undefined, ops: [] });
        }
        continue;
      }
      const ids = selected === 'default' ? new Set(tp.ops.filter((o) => o.selected).map((o) => o.id)) : new Set(selected[tp.targetId] ?? []);
      const ops = tp.ops.filter((o) => ids.has(o.id));
      if (!ops.length) continue;
      const node = findNode(this.config, tp.targetId)!;
      groups.push({
        key: tp.targetId,
        title: tp.targetName,
        rootLabel: tp.root,
        open: () => transportForNode(ctx, node),
        node,
        backup: tp.backup,
        ops: ops.map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, replaceType: o.replaceType })),
      });
    }
    if (!groups.length) throw new Error(t('Seçili işlem yok.'));
    const req = plan.request;
    const opts = { ...req.options, ...(overrides.dryRun != null ? { dryRun: overrides.dryRun } : {}) };
    const label = req.label || (req.origin === 'git' ? t('Git gönderimi') : t('Gönderim'));
    const last = plan.sources[plan.sources.length - 1];
    const s = this.execSettings(label, req.origin, opts, {
      sources: plan.sources.map((x) => x.path).slice(0, 200),
      postSource: last ? { path: last.path, rel: last.rel } : undefined,
      targetIds: plan.targets.map((tp) => tp.targetId),
    });
    const handle = startRun(ctx, groups, s);
    this.track(handle, overrides.notify ?? opts.notify !== false);
    return handle;
  }

  /** remember: false for the one-click menu sends, so "send with last settings" keeps what was last reviewed. */
  async executePlan(planId: string, selected: Record<string, string[]>, overrides: { dryRun?: boolean; remember?: boolean } = {}): Promise<string> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(t('Plan bulunamadı ya da eskidi; yeniden inceleyin.'));
    const handle = this.runPlan(plan, selected, { dryRun: overrides.dryRun, unreachableFails: true });
    if (overrides.remember !== false) {
      // remember what the user picked, not just the targets that happened to need changes
      this.settings.lastTargets = plan.targets.map((tp) => tp.targetId);
      void this.persistSettings();
    }
    return handle.id;
  }

  async cancelRun(runId: string) {
    this.runsActive.get(runId)?.cancel.cancel();
  }

  private async readSource(src: SourceSpec): Promise<{ buf: Buffer | null; size: number; mtimeMs?: number }> {
    if (src.kind === 'fs') {
      const st = await fsp.stat(src.path).catch(() => null);
      if (!st || st.isDirectory()) return { buf: null, size: 0 };
      return { buf: await readCapped(fs.createReadStream(src.path)), size: st.size, mtimeMs: st.mtimeMs };
    }
    if (src.kind === 'git') {
      const b = await git.showFile(src.repo, src.rev, src.path);
      return { buf: b, size: b?.length ?? 0 };
    }
    return { buf: null, size: 0 };
  }

  async compareWithTarget(src: SourceSpec, targetId: string, rel: string): Promise<DiffResult> {
    const node = findNode(this.config, targetId);
    if (!node) throw new Error(t('Hedef bulunamadı'));
    const left = await this.readSource(src);
    const tgt = await transportForNode(this.ctx(), node);
    try {
      const st = await tgt.stat(rel);
      const right = st && !st.isDir ? await readCapped(await tgt.readStream(rel)) : null;
      const leftInfo = { size: left.size, mtimeMs: left.mtimeMs, exists: !!left.buf };
      const rightInfo = { size: st?.size ?? 0, mtimeMs: st?.mtimeMs, exists: !!st };
      if (!right) {
        const r = left.buf ? textDiff(Buffer.alloc(0), left.buf, { leftLabel: t('hedef'), rightLabel: t('kaynak') }) : { ok: false, lines: [], additions: 0, deletions: 0 };
        return { ...r, reason: t('Hedefte yok: dosyanın tamamı eklenecek'), leftInfo: rightInfo, rightInfo: leftInfo, leftLabel: t('hedef'), rightLabel: t('kaynak') };
      }
      // left side of the view = target (what will be replaced), right side = source (what will be written)
      const r = textDiff(right, left.buf ?? Buffer.alloc(0), { leftLabel: t('hedef'), rightLabel: t('kaynak') });
      return { ...r, leftInfo: rightInfo, rightInfo: leftInfo };
    } finally {
      await tgt.close();
    }
  }

  // ------------------------------------------------------------ history

  runs() {
    return this.history.list();
  }
  run(id: string) {
    return this.history.get(id);
  }
  deleteRun(id: string) {
    return this.history.remove(id);
  }
  clearRuns() {
    return this.history.clear();
  }
  private reportsDir() {
    return path.join(this.host.userDataPath, 'reports');
  }

  exportRunCsv(id: string) {
    return this.history.exportCsv(id, this.reportsDir());
  }

  // ------------------------------------------------------------ git

  async gitRepos(): Promise<GitRepoInfo[]> {
    const roots = await git.discoverRepos(this.ctx().localRoots, this.settings.recentRepos);
    const infos: GitRepoInfo[] = [];
    for (const r of roots) {
      try {
        infos.push(await git.repoInfo(r));
      } catch {
        /* vanished */
      }
    }
    return infos;
  }

  async gitAddRepo(p: string): Promise<GitRepoInfo | null> {
    const root = await git.findRepoRoot(p);
    if (!root) return null;
    if (!this.settings.recentRepos.some((x) => pathKey(x) === pathKey(root))) {
      this.settings.recentRepos = [root, ...this.settings.recentRepos].slice(0, 12);
      await this.persistSettings();
    }
    return git.repoInfo(root);
  }

  async gitRemoveRepo(root: string) {
    this.settings.recentRepos = this.settings.recentRepos.filter((x) => pathKey(x) !== pathKey(root));
    await this.persistSettings();
  }

  gitStatus(repo: string) {
    return git.status(normalizeAbs(repo));
  }
  gitLog(repo: string, q: git.LogQuery) {
    return git.log(normalizeAbs(repo), q);
  }
  gitBranches(repo: string) {
    return git.branches(normalizeAbs(repo));
  }
  gitCommitChanges(repo: string, shas: string[]) {
    return git.commitChanges(normalizeAbs(repo), shas);
  }
  gitSources(req: git.GitSourceRequest) {
    return git.gitSources(req);
  }
  gitDiff(spec: Parameters<typeof git.fileDiff>[0]) {
    return git.fileDiff(spec);
  }

  // ------------------------------------------------------------ folder sync

  async compareJob(job: SyncJob, taskId: string): Promise<CompareResult> {
    const cancel = new CancelToken();
    this.tasks.set(taskId, cancel);
    try {
      const result = await compareJob(this.ctx(), job, cancel, (message) => this.host.emit({ type: 'task-progress', taskId, message }));
      this.compares.set(result.id, { job, result });
      while (this.compares.size > 6) this.compares.delete(this.compares.keys().next().value!);
      return result;
    } finally {
      this.tasks.delete(taskId);
    }
  }

  async syncRun(compareId: string, job: SyncJob, overrides: Record<string, Record<string, SyncAction>>, dryRun = false): Promise<string> {
    const entry = this.compares.get(compareId);
    if (!entry) throw new Error(t('Karşılaştırma sonucu bulunamadı; yeniden karşılaştırın.'));
    const result: CompareResult = {
      ...entry.result,
      pairs: entry.result.pairs.map((p) => ({
        ...p,
        items: p.items.map((it) => {
          const o = overrides[p.pairId]?.[it.key];
          return o ? { ...it, action: o } : it;
        }),
      })),
    };
    const ctx = this.ctx();
    const groups = syncGroups(ctx, job, result);
    if (!groups.length) throw new Error(t('Yapılacak işlem yok.'));
    const s = this.execSettings(t('Senkron: {name}', { name: job.name }), 'sync', { dryRun, backup: job.deletion === 'versioning', notify: true }, {
      backupKeep: job.versioningKeep,
      sources: result.pairs.map((p) => p.leftLabel),
      targetIds: groups.map((g) => g.key),
    });
    const handle = startRun(ctx, groups, s);
    this.track(handle, true, async (detail) => {
      await updateDbAfterRun(ctx, job, result, detail);
      const j = this.config.syncJobs.find((x) => x.id === job.id);
      if (j && !detail.dryRun) {
        j.lastRun = new Date().toISOString();
        await saveConfigFile(this.configPath, this.config).catch(() => undefined);
      }
    });
    return handle.id;
  }

  /** Compares a job and runs its default actions (conflicts stay untouched). Used by schedules. */
  async runSyncDefault(job: SyncJob, label: string): Promise<{ handle: RunHandle | null; actions: number }> {
    const ctx = this.ctx();
    const result = await compareJob(ctx, job);
    const errors = result.pairs.filter((p) => p.error && !p.items.length);
    if (errors.length) throw new Error(errors.map((p) => p.error).join('; '));
    const groups = syncGroups(ctx, job, result);
    const conflicts = result.stats.byCategory.conflict;
    if (!groups.length) return { handle: null, actions: conflicts };
    const s = this.execSettings(label, 'sync', { backup: job.deletion === 'versioning' }, {
      backupKeep: job.versioningKeep,
      sources: result.pairs.map((p) => p.leftLabel),
      targetIds: groups.map((g) => g.key),
    });
    const handle = startRun(ctx, groups, s);
    this.track(handle, false, (detail) => updateDbAfterRun(ctx, job, result, detail));
    return { handle, actions: groups.reduce((a, g) => a + g.ops.length, 0) };
  }

  // ------------------------------------------------------------ automation

  async automationState(): Promise<AutomationState> {
    return this.automation?.snapshot() ?? { paused: false, watches: [], schedules: [] };
  }

  async watchAdd(cfg: Omit<WatchConfig, 'id'>): Promise<AutomationState> {
    if (!cfg.paths.length) throw new Error(t('İzlenecek dosya ya da klasör yok.'));
    if (!cfg.targetIds.length) throw new Error(t('Hedef seçilmedi.'));
    this.log.info(t('İzleme'), t('{name}: {n} yol → {targets}', { name: cfg.name, n: cfg.paths.length, targets: cfg.targetIds.join(', ') }));
    return this.automation!.addWatch(cfg);
  }

  async watchUpdate(id: string, patch: Partial<WatchConfig>): Promise<AutomationState> {
    return this.automation!.updateWatch(id, patch);
  }

  async watchRemove(id: string): Promise<AutomationState> {
    return this.automation!.removeWatch(id);
  }

  async automationPause(paused: boolean): Promise<AutomationState> {
    await this.saveSettings({ automationPaused: paused });
    return this.automation!.snapshot();
  }

  async scheduleRunNow(jobId: string): Promise<void> {
    const job = this.config.syncJobs.find((j) => j.id === jobId);
    if (!job) throw new Error(t('İş bulunamadı'));
    void this.automation?.runSchedule(job);
  }

  async syncItemDiff(compareId: string, pairId: string, key: string): Promise<DiffResult> {
    const entry = this.compares.get(compareId);
    const pr = entry?.result.pairs.find((p) => p.pairId === pairId);
    const item = pr?.items.find((i) => i.key === key);
    const pair = entry?.job.pairs.find((p) => p.id === pairId);
    if (!entry || !pr || !item || !pair) throw new Error(t('Öğe bulunamadı'));
    const ctx = this.ctx();
    const [l, r] = await Promise.all([transportForEndpoint(ctx, pair.left), transportForEndpoint(ctx, pair.right)]);
    try {
      const lb = item.left && !item.left.isDir ? await readCapped(await l.readStream(item.rel)) : Buffer.alloc(0);
      const rb = item.right && !item.right.isDir ? await readCapped(await r.readStream(item.rel)) : Buffer.alloc(0);
      const d = textDiff(rb, lb, { leftLabel: t('sağ'), rightLabel: t('sol') });
      return {
        ...d,
        leftInfo: { size: item.right?.size ?? 0, mtimeMs: item.right?.mtimeMs, exists: !!item.right },
        rightInfo: { size: item.left?.size ?? 0, mtimeMs: item.left?.mtimeMs, exists: !!item.left },
      };
    } finally {
      await l.close();
      await r.close();
    }
  }

  resetSyncState(jobId: string) {
    return resetDb(this.ctx(), jobId);
  }

  async browse(ep: Parameters<Api['browse']>[0], rel: string): Promise<BrowseEntry[]> {
    const tgt = await transportForEndpoint(this.ctx(), ep);
    try {
      const list = await tgt.list(rel);
      return list.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.rel.localeCompare(b.rel));
    } finally {
      await tgt.close();
    }
  }

  // ------------------------------------------------------------ backups

  findBackups(rel: string, targetIds: string[]) {
    return findBackups(this.ctx(), rel, targetIds);
  }
  backupSets(targetIds: string[]) {
    return listBackupSets(this.ctx(), targetIds);
  }
  browseBackup(targetId: string, stamp: string, relDir: string, folder?: string) {
    return browseBackup(this.ctx(), targetId, stamp, relDir, folder);
  }

  async restore(rel: string, picks: { targetId: string; stamp: string; folder?: string }[], backupCurrent: boolean): Promise<string> {
    const ctx = this.ctx();
    const groups = await restoreGroups(ctx, rel, picks);
    if (!groups.length) throw new Error(t('Geri alınacak yedek bulunamadı.'));
    const s = this.execSettings(t('Geri alma: {path}', { path: rel }), 'restore', { backup: backupCurrent, notify: true }, { sources: [rel], targetIds: groups.map((g) => g.key) });
    const handle = startRun(ctx, groups, s);
    this.track(handle, true);
    return handle.id;
  }

  // ------------------------------------------------------------ import from the old wizard

  async findWizardState(): Promise<string | null> {
    return (await findWizardStates())[0] ?? null;
  }

  /** Brings the old wizard's profiles and last selection over, once; profiles that already exist here are kept. */
  async importWizardState(file: string): Promise<WizardImportResult> {
    const raw = await readJson(file);
    const conv = isWizardState(raw) ? convertWizardState(raw, this.config, this.configPath) : null;
    if (!conv) throw new Error(t('Bu dosyada eski sihirbazın ayarları yok: {path}', { path: file }));
    const has = new Set(this.config.profiles.flatMap((p) => [p.id.toLowerCase(), p.name.toLowerCase()]));
    const added = conv.profiles.filter((p) => !has.has(p.id.toLowerCase()) && !has.has(p.name.toLowerCase()));
    const skipped = conv.profiles.filter((p) => !added.includes(p)).map((p) => p.name);
    let profilesError: string | undefined;
    if (added.length) {
      try {
        await this.saveConfig({ ...this.config, profiles: [...this.config.profiles, ...added] });
      } catch (e) {
        profilesError = errMessage(e);
      }
    }
    const patch: Partial<LocalSettings> = { wizardImport: { at: Date.now(), file } };
    if (conv.lastTargets.length) {
      patch.lastTargets = conv.lastTargets;
      patch.lastOptions = { ...this.settings.lastOptions, ...conv.lastOptions };
    }
    await this.saveSettings(patch);
    this.log.info(
      t('Config'),
      t('Eski sihirbazdan içe aktarıldı ({file}): {targets} hedef, {profiles} profil', { file, targets: conv.lastTargets.length, profiles: added.length }),
    );
    return {
      file,
      configKey: conv.configKey,
      lastTargets: conv.lastTargets,
      profilesAdded: profilesError ? [] : added.map((p) => p.name),
      profilesSkipped: skipped,
      unknownTargets: conv.unknownTargets,
      profilesError,
      settings: this.settings,
      config: this.config,
    };
  }

  // ------------------------------------------------------------ shell & host

  async pick(opts: PickOptions) {
    return this.host.pick ? this.host.pick(opts) : [];
  }
  async openPath(p: string) {
    await this.host.openPath?.(p);
  }
  async showInFolder(p: string) {
    await this.host.showInFolder?.(p);
  }
  async openExternal(url: string) {
    // [/]{2} rather than \/\/: the i18n check reads "//" as a comment and would miss the text after it
    if (!/^https?:[/]{2}/i.test(url)) throw new Error(t('Yalnızca http(s) bağlantıları açılabilir'));
    await this.host.openExternal?.(url);
  }
  async openLog() {
    await this.host.openPath?.(this.log.file);
  }
  async statFile(p: string) {
    const st = await fsp.stat(p).catch(() => null);
    return st ? { size: st.size, mtimeMs: st.mtimeMs, isDir: st.isDirectory() } : null;
  }

  async integrationStatus(): Promise<IntegrationStatus | null> {
    return this.host.integrations?.status() ?? null;
  }
  /** Turns the Explorer menu or the Notepad++ entries on or off and writes them now. */
  async integrationSet(patch: Pick<LocalSettings, 'explorerMenu' | 'notepadPlusPlus'>): Promise<IntegrationStatus | null> {
    if (!this.host.integrations) return null;
    await this.saveSettings(patch);
    return this.host.integrations.apply();
  }

  private noUpdater(): UpdateState {
    return { phase: 'unsupported', source: this.config.update?.source ?? 'github', currentVersion: this.host.appVersion, detail: t('Güncelleme yalnızca kurulu masaüstü uygulamasında çalışır.') };
  }
  async updateState() {
    return this.host.updater?.state() ?? this.noUpdater();
  }
  async updateCheck() {
    return this.host.updater ? this.host.updater.check() : this.noUpdater();
  }
  async updateDownload() {
    return this.host.updater ? this.host.updater.download() : this.noUpdater();
  }
  async updateInstall() {
    this.host.updater?.install();
  }

  async windowControl(action: Parameters<Api['windowControl']>[0]) {
    this.host.windowControl?.(action);
  }

  async setChrome(opts: Parameters<Api['setChrome']>[0]) {
    this.host.setChrome?.(opts);
  }

  rootLabel(nodeId: string) {
    const n = findNode(this.config, nodeId);
    return n ? nodeRootLabel(this.config, n) : '';
  }
}
