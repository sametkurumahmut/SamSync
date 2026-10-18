import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Api, IntegrationStatus, PickOptions, BrowseEntry } from '../shared/api';
import type {
  DiscoveredHost,
  DirListing,
  WebUiSettings,
  WebUiState,
  AppConfig,
  AssistantReply,
  AssistantStatus,
  AssistantTurn,
  ChangelogSection,
  AppEvent,
  Bootstrap,
  CompareResult,
  DiffResult,
  InventoryRow,
  LocalIdentity,
  LocalSettings,
  PackWriteResult,
  SendPlan,
  SendOptions,
  SendRequest,
  RunDetail,
  ProbeResult,
  QuickSend,
  SpeedTestResult,
  RelayState,
  SourceSpec,
  SyncAction,
  SyncJob,
  UpdateConfig,
  UpdateState,
  GitRepoInfo,
  AutomationState,
  WatchConfig,
  WizardImportResult,
  NodeConfig,
} from '../shared/types';
import type { CoreContext } from './context';
import { DEFAULT_SETTINGS, automationSettings, emptyConfig, loadConfig, readJson, saveConfigFile, writeJsonAtomic, normalizeConfig, serializeConfig } from './config';
import { detectIdentity } from './identity';
import { createLogger, type Logger } from './logger';
import { History, pruneReports } from './history';
import { buildSendPlan, describeSources, writeSendPack, type PlanScans } from './plan';
import { discoverHosts } from './discover';
import { hashPassword } from './webserver';
import { packFileName } from './packfile';
import { readChangelogSection } from './changelog';
import { ASSISTANT_MODEL, ASSISTANT_SECRET, askAssistant, assistantError, assistantSystem } from './assistant';
import { HashCache } from './hashcache';
import { runMessage, sendNotification, wantsNotification } from './notifications';
import { quickIdOf } from './automation';
import { baseSendOptions } from '../shared/options';
import { readManifest } from './manifest';
import { startRun, type ExecGroup, type ExecSettings, type RunHandle } from './executor';
import { probeNodes } from './probe';
import { transportForNode, transportForEndpoint, nodeRootLabel, type Transport } from './transport';
import { mapToRel, normalizeAbs, pathKey } from './paths';
import { textDiff, MAX_TEXT_DIFF_BYTES } from './textdiff';
import * as git from './git';
import { compareJob, syncExecSettings, syncGroups, updateDbAfterRun, resetDb } from './sync';
import { jobFileText, jobFromFile } from './jobfile';
import { findBackups, listBackupSets, browseBackup, restoreGroups, restoreRunGroups } from './backups';
import { findNode } from './context';
import crypto from 'node:crypto';
import { CancelToken, errMessage, formatBytes, mapLimit, newId, stamp, withTimeout } from './util';
import { RelayService } from './relay';
import type { RelayJob } from '../shared/relay';
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
  /** The GitHub repository the app updates from, for the release notes link. */
  repositoryUrl?: string;
  /** CHANGELOG.md as shipped with the app, for the "what's new" card. */
  changelogPath?: string;
  /** Where README.md and README.tr.md are (resources/ in the packaged app), for the help bot. */
  docsDir?: string;
  emit(e: AppEvent): void;
  pick?(opts: PickOptions): Promise<string[]>;
  /** A save dialog; null when cancelled. */
  pickSave?(opts: PickOptions): Promise<string | null>;
  openPath?(p: string): Promise<void>;
  showInFolder?(p: string): Promise<void>;
  openExternal?(url: string): Promise<void>;
  /** Server mode: the HTTP server of the desktop app (absent in the development preview). */
  webUi?: { state(): WebUiState; apply(s: WebUiSettings | undefined): Promise<WebUiState> };
  /** Moves a local file or folder to the operating system's trash (sync jobs that delete to the Recycle Bin). */
  trash?(absPath: string): Promise<void>;
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
  setChrome?(opts: { theme: 'system' | 'light' | 'dark'; bg: string; fg: string; zoom?: number }): void;
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
  /** Content hashes remembered across runs (userData/hashcache.json). */
  readonly hashCache: HashCache;
  private plans = new Map<string, SendPlan>();
  /** What each plan saw on each target (kept here, not sent to the window): the run writes the manifest from it. */
  private planScans = new Map<string, PlanScans>();
  private compares = new Map<string, { job: SyncJob; result: CompareResult }>();
  private runsActive = new Map<string, RunHandle>();
  private tasks = new Map<string, CancelToken>();
  private gitVersion: string | null = null;
  automation: Automation | null = null;
  /** Runs when this machine's node is a relay: hands sends on to the other machines of its group. */
  relay: RelayService | null = null;
  /** The last reachability check per machine, so a plan right after it skips its own. */
  private lastProbes = new Map<string, ProbeResult>();

  constructor(private host: HostAdapter) {
    this.settingsFile = path.join(host.userDataPath, 'settings.json');
    this.secretsFile = path.join(host.userDataPath, 'secrets.json');
    const logEnv = process.env.SAMSYNC_LOG;
    const logDir = logEnv ? path.dirname(logEnv) : path.join(host.userDataPath, 'log');
    this.log = createLogger(logDir);
    this.history = new History(host.userDataPath);
    this.hashCache = new HashCache(path.join(host.userDataPath, 'hashcache.json'));
    void this.hashCache.load();
  }

  async init(): Promise<void> {
    try {
      const raw = (await readJson(this.settingsFile)) as Partial<LocalSettings>;
      this.settings = { ...DEFAULT_SETTINGS, ...raw };
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
      runPlan: (plan, notify, nodes) => {
        try {
          return this.runPlan(plan, 'default', { notify, nodes });
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
      getQuickSends: () => this.settings.quickSends ?? [],
      runQuick: (q, label) => this.runQuick(q, label),
      isPaused: () => !!this.settings.automationPaused,
      notify: (title, body) => this.host.notify?.(title, body),
      settings: () => automationSettings(this.settings),
      emit: (state) => {
        this.host.emit({ type: 'automation', state });
        this.host.applySettings?.(this.settings, state);
      },
    });
    this.automation.start();
    this.syncRelay();
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
      appVersion: this.host.appVersion,
      localRoots: this.identity.node?.localRoots ?? [],
      localNodeId: this.identity.node?.id,
      userDataPath: this.host.userDataPath,
      getSecret: (id) => this.getSecret(id),
      trash: this.host.trash ? (p) => this.host.trash!(p) : undefined,
      recentProbe: (id) => this.lastProbes.get(id),
      hashCache: this.hashCache,
      runLog: (id) => this.history.openLog(id),
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
      settings: this.publicSettings(),
      identity: this.identity,
      initialPaths: this.host.initialPaths.splice(0),
      initialTargets: this.host.initialTargets?.splice(0) ?? [],
      userDataPath: this.host.userDataPath,
      isElectron: this.host.isElectron,
      repositoryUrl: this.host.repositoryUrl,
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
    this.syncRelay();
    this.log.info(t('Config'), t('Yapılandırma kaydedildi ({n} node)', { n: this.config.nodes.length }));
    return { config: this.config, identity: this.identity };
  }

  /** The configuration file as text, edited as it is (fields of the old tool and unknown ones included). */
  async configText(p?: string): Promise<string> {
    try {
      return (await fsp.readFile(p || this.configPath, 'utf8')).replace(/^\uFEFF/, '');
    } catch (e) {
      if (p) throw e;
      return `${JSON.stringify(serializeConfig(this.config), null, 2)}\n`;
    }
  }

  /** Writes edited configuration text after checking it; the file keeps the text exactly as written. */
  async saveConfigText(text: string): Promise<Bootstrap> {
    let raw: unknown;
    try {
      raw = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (e) {
      throw new Error(t('JSON okunamadı: {error}', { error: errMessage(e) }));
    }
    normalizeConfig(raw);
    await fsp.mkdir(path.dirname(this.configPath), { recursive: true });
    const tmp = `${this.configPath}.samsync-tmp`;
    await fsp.writeFile(tmp, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    await fsp.rename(tmp, this.configPath);
    await this.loadConfigFrom(this.configPath);
    this.host.emit({ type: 'config-changed', config: this.config });
    this.host.updater?.configure(this.config.update, this.settings);
    this.automation?.emit();
    this.syncRelay();
    this.log.info(t('Config'), t('Yapılandırma metin olarak kaydedildi ({n} node)', { n: this.config.nodes.length }));
    return this.bootstrap();
  }

  /** Saves a copy of the configuration file somewhere else. */
  async exportConfig(dest: string): Promise<void> {
    await fsp.writeFile(dest, await this.configText(), 'utf8');
    this.log.info(t('Config'), t('Yapılandırma dışa aktarıldı: {path}', { path: dest }));
  }

  async pickSave(opts: PickOptions): Promise<string | null> {
    return this.host.pickSave ? this.host.pickSave(opts) : null;
  }

  async readConfigFile(p: string): Promise<AppConfig> {
    return loadConfig(p);
  }

  async useConfigFile(p: string | null): Promise<Bootstrap> {
    this.settings.configPath = p || undefined;
    await this.persistSettings();
    await this.loadConfigFrom(p || path.join(this.host.userDataPath, 'config.json'));
    this.host.updater?.configure(this.config.update, this.settings);
    this.syncRelay();
    return this.bootstrap();
  }

  /** The settings as a window sees them: the server mode's password hash stays here. */
  publicSettings(): LocalSettings {
    const w = this.settings.webUi;
    if (!w) return this.settings;
    const { passwordHash, ...rest } = w;
    return { ...this.settings, webUi: { ...rest, hasPassword: !!passwordHash } };
  }

  async saveSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
    const pinChanged = 'localNodeId' in patch && patch.localNodeId !== this.settings.localNodeId;
    // the server mode is changed through webUiConfigure only (the settings a window sends back have no hash)
    const { webUi: _ignored, ...safe } = patch;
    this.settings = { ...this.settings, ...safe };
    await this.persistSettings();
    if (pinChanged) {
      this.identity = detectIdentity(this.config, this.settings.localNodeId);
      this.syncRelay();
    }
    if ('updateAutoCheck' in patch || 'updateAutoDownload' in patch) this.host.updater?.configure(this.config.update, this.settings);
    if ('automationPaused' in patch || 'automation' in patch) this.automation?.setPaused();
    if ('language' in patch) setLang(this.uiLang());
    if (this.automation) this.host.applySettings?.(this.settings, this.automation.snapshot());
    return this.publicSettings();
  }

  /** A folder of this computer for a browser's file picker: folders first, then files; null lists the drives. */
  async listDir(p: string | null): Promise<DirListing> {
    if (!p) {
      if (process.platform !== 'win32') return this.listDir('/');
      const drives: DirListing['entries'] = [];
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZAB') {
        const root = `${letter}:\\`;
        const st = await fsp.stat(root).catch(() => null);
        if (st) drives.push({ name: `${letter}:`, path: root, isDir: true, size: 0, mtimeMs: st.mtimeMs });
      }
      return { path: null, parent: null, entries: drives };
    }
    const abs = path.resolve(p);
    const parentDir = path.dirname(abs);
    const parent = parentDir === abs ? (process.platform === 'win32' ? '' : null) : parentDir;
    try {
      const items = await fsp.readdir(abs, { withFileTypes: true });
      const entries = await mapLimit(items, 16, async (d) => {
        const full = path.join(abs, d.name);
        const st = await fsp.stat(full).catch(() => null);
        return { name: d.name, path: full, isDir: st ? st.isDirectory() : d.isDirectory(), size: st?.size ?? 0, mtimeMs: st?.mtimeMs ?? 0 };
      });
      entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      return { path: abs, parent: parent === '' ? null : parent, entries };
    } catch (e) {
      return { path: abs, parent: parent === '' ? null : parent, entries: [], error: errMessage(e) };
    }
  }

  async webUiState(): Promise<WebUiState> {
    if (this.host.webUi) return this.host.webUi.state();
    const w = this.settings.webUi;
    return { available: false, enabled: !!w?.enabled, running: false, port: w?.port ?? 8780, lan: w?.lan ?? true, hasPassword: !!w?.passwordHash, urls: [], clients: 0, sessions: 0 };
  }

  async webUiConfigure(patch: { enabled?: boolean; port?: number; lan?: boolean; password?: string | null }): Promise<WebUiState> {
    const cur: WebUiSettings = this.settings.webUi ?? { enabled: false, port: 8780, lan: true };
    const next: WebUiSettings = {
      enabled: patch.enabled ?? cur.enabled,
      port: Math.max(1024, Math.min(65535, Math.round(patch.port ?? cur.port) || 8780)),
      lan: patch.lan ?? cur.lan,
      passwordHash: patch.password === undefined ? cur.passwordHash : patch.password ? hashPassword(patch.password) : undefined,
    };
    if (patch.password != null && patch.password.length < 8) throw new Error(t('Parola en az 8 karakter olmalı'));
    if (next.enabled && !next.passwordHash) throw new Error(t('Önce bir parola belirleyin'));
    this.settings = { ...this.settings, webUi: next };
    await this.persistSettings();
    this.log.info(t('Web arayüzü'), next.enabled ? t('Açık: kapı {port}, {where}', { port: next.port, where: next.lan ? t('ağdan erişilebilir') : t('yalnızca bu bilgisayar') }) : t('Kapalı'));
    return this.host.webUi ? this.host.webUi.apply(next) : this.webUiState();
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

  /** A few MB written to the machine and read back, then removed: what the link really does. */
  async speedTest(nodeId: string): Promise<SpeedTestResult> {
    const node = findNode(this.config, nodeId);
    if (!node) throw new Error(t('Hedef bulunamadı: {id}', { id: nodeId }));
    const tgt = await transportForNode(this.ctx(), node);
    const rel = `.samsync-speedtest-${newId()}.tmp`;
    // random bytes: a compressing link cannot shrink them, so the number is the link's own
    const size = 3 * 1024 * 1024;
    const data = crypto.randomBytes(size);
    const { Readable } = await import('node:stream');
    try {
      const t0 = Date.now();
      await withTimeout(tgt.stat(''), 15000);
      const latencyMs = Date.now() - t0;
      const t1 = Date.now();
      await withTimeout(tgt.writeStream(rel, Readable.from([data])), 120000);
      const writeMs = Date.now() - t1;
      const t2 = Date.now();
      let got = 0;
      for await (const c of await withTimeout(tgt.readStream(rel), 15000)) got += (c as Buffer).length;
      const readMs = Date.now() - t2;
      if (got !== size) throw new Error(t('Okunan boyut tutmuyor'));
      const r: SpeedTestResult = { nodeId, bytes: size, writeMBps: (size / 1048576 / Math.max(writeMs, 1)) * 1000, readMBps: (size / 1048576 / Math.max(readMs, 1)) * 1000, latencyMs, at: Date.now() };
      this.log.info(t('Hız sınaması'), t('{name}: yazma {w} MB/sn, okuma {r} MB/sn, gecikme {ms} ms', { name: node.name, w: r.writeMBps.toFixed(2), r: r.readMBps.toFixed(2), ms: latencyMs }));
      return r;
    } finally {
      await tgt.remove(rel, false).catch(() => undefined);
      await tgt.close().catch(() => undefined);
    }
  }

  /**
   * Which release each machine holds: every enabled machine's manifest, read now (one small file per machine).
   * A machine that does not answer within a few seconds is listed as unreachable rather than holding the table up.
   */
  async inventory(): Promise<InventoryRow[]> {
    const ctx = this.ctx();
    const nodes = this.config.nodes.filter((n) => n.enabled);
    return mapLimit(nodes, 6, async (n): Promise<InventoryRow> => {
      const row: InventoryRow = { nodeId: n.id, name: n.name, group: n.group, reachable: true, manifest: false, entries: [], checkedAt: Date.now() };
      let tgt: Transport | null = null;
      try {
        tgt = await transportForNode(ctx, n);
        const m = await withTimeout(readManifest(tgt), 8000);
        if (!m) return row;
        row.manifest = true;
        for (const [rel, sub] of Object.entries(m.subtrees)) {
          let files = 0;
          let dirs = 0;
          let size = 0;
          for (const e of sub.entries ?? []) {
            if (e[1] === 1) dirs++;
            else {
              files++;
              size += e[2];
            }
          }
          row.entries.push({ rel, label: sub.label, writtenAt: sub.writtenAt, by: sub.by, files, dirs, size });
        }
        row.entries.sort((a, b) => a.rel.localeCompare(b.rel));
      } catch (e) {
        row.reachable = false;
        row.error = errMessage(e);
      } finally {
        await tgt?.close().catch(() => undefined);
      }
      return row;
    });
  }

  async relayState(): Promise<RelayState> {
    return this.relay?.state() ?? { active: false, jobs: 0 };
  }

  async probe(nodeIds?: string[]) {
    const nodes = this.config.nodes.filter((n) => n.enabled && n.id !== this.identity.node?.id && (!nodeIds || nodeIds.includes(n.id)));
    const results = await probeNodes(this.config, nodes);
    for (const r of results) this.lastProbes.set(r.nodeId, r);
    this.host.emit({ type: 'probe', results });
    return results;
  }

  async describeSources(paths: string[], count = true, secrets?: Record<string, string>) {
    return describeSources(this.ctx(), paths, count, secrets);
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
      const scans: PlanScans = new Map();
      const plan = await buildSendPlan(this.ctx(), req, {
        cancel,
        scans,
        onProgress: (p) => this.host.emit({ type: 'task-progress', taskId, message: p.message, done: p.done, total: p.total }),
      });
      this.plans.set(plan.id, plan);
      this.planScans.set(plan.id, scans);
      while (this.plans.size > 12) {
        const oldest = this.plans.keys().next().value!;
        this.plans.delete(oldest);
        this.planScans.delete(oldest);
      }
      return plan;
    } finally {
      this.tasks.delete(taskId);
    }
  }

  /** The sources as one pack file in `dir` (named after the label and the time), for a release carried on a disk. */
  async writePack(req: SendRequest, dir: string, taskId: string, password?: string): Promise<PackWriteResult> {
    const cancel = new CancelToken();
    this.tasks.set(taskId, cancel);
    const file = path.join(dir, packFileName(req.label || t('Gönderim')));
    try {
      this.log.info(t('Paket'), password ? t('{n} kaynak → {file} (parolalı)', { n: req.sources.length, file }) : t('{n} kaynak → {file}', { n: req.sources.length, file }));
      const r = await writeSendPack(this.ctx(), req, file, {
        cancel,
        password,
        onProgress: (p) => this.host.emit({ type: 'task-progress', taskId, message: p.message, done: p.done, total: p.total }),
      });
      this.log.info(t('Paket'), t('Paket yazıldı: {file} ({files} dosya, {size} → {packed})', { file, files: r.files, size: formatBytes(r.size), packed: formatBytes(r.packed) }));
      return r;
    } finally {
      this.tasks.delete(taskId);
    }
  }

  async cancelTask(taskId: string) {
    this.tasks.get(taskId)?.cancel();
  }

  /** The machines on this computer's subnets that answer on file sharing or SSH, for the Targets page and the setup wizard. */
  async discoverHosts(taskId: string): Promise<DiscoveredHost[]> {
    const cancel = new CancelToken();
    this.tasks.set(taskId, cancel);
    try {
      const hosts = await discoverHosts(this.config, {
        cancel,
        onProgress: (done, total, found) => this.host.emit({ type: 'task-progress', taskId, message: t('{found} makine bulundu', { found }), done, total }),
      });
      this.log.info(t('Ağ taraması'), t('{n} makine yanıt verdi', { n: hosts.length }));
      return hosts;
    } finally {
      this.tasks.delete(taskId);
    }
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
      relayAckMs: (c.relayAckSeconds ?? 60) * 1000,
      relayDoneMs: (c.relayTimeoutMinutes ?? 15) * 60_000,
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
        void this.hashCache.flush();
        // the team's channel, when one is set: never waits for, never fails the run
        if (wantsNotification(this.settings.notifications, detail)) {
          void sendNotification(this.settings.notifications!, runMessage(detail, { host: os.hostname(), version: this.host.appVersion })).then((r) => {
            for (const [ch, res] of Object.entries(r)) if (res !== 'ok') this.log.warn(t('Bildirim'), t('{channel} gönderilemedi: {error}', { channel: ch, error: res }));
          });
        }
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
  runPlan(plan: SendPlan, selected: Record<string, string[]> | 'default', overrides: { dryRun?: boolean; notify?: boolean; unreachableFails?: boolean; nodes?: NodeConfig[] } = {}): RunHandle {
    const ctx = this.ctx();
    // targets outside the configuration (a watch's plain folders) come with the plan
    const nodeOf = (id: string) => findNode(this.config, id) ?? overrides.nodes?.find((n) => n.id === id);
    const groups: ExecGroup[] = [];
    const req = plan.request;
    // the machines behind a relay: they ride on the relay's group
    const relayed = new Map<string, NodeConfig[]>();
    for (const tp of plan.targets) {
      if (!tp.via) continue;
      const n = nodeOf(tp.targetId);
      if (n && tp.reachable) relayed.set(tp.via, [...(relayed.get(tp.via) ?? []), n]);
      else if (overrides.unreachableFails) {
        const why = tp.error || t('Hedefe erişilemiyor');
        groups.push({ key: tp.targetId, title: tp.targetName, rootLabel: tp.root, open: () => Promise.reject(new Error(why)), node: n, ops: [] });
      }
    }
    const relayJob = (relayId: string): RelayJob => ({
      id: newId('relay-'),
      createdAt: Date.now(),
      label: req.label || t('Gönderim'),
      from: ctx.localNodeId,
      // the sources by their path on the share; a source that is gone is a deletion on the relayed machines too
      sources: plan.sources.filter((s) => s.exists || !s.error).map((s) => ({ rel: s.rel, kind: s.exists ? ('fs' as const) : ('delete' as const) })),
      targetIds: (relayed.get(relayId) ?? []).map((n) => n.id),
      options: { ...req.options, dryRun: false, notify: false, runPostCommand: req.options.runPostCommand },
    });
    for (const tp of plan.targets) {
      if (tp.via) continue;
      if (!tp.reachable) {
        // a machine that was off counts as failed, so "select the failed ones" and "resend to failed" include it
        if (overrides.unreachableFails) {
          const why = tp.error || t('Hedefe erişilemiyor');
          groups.push({ key: tp.targetId, title: tp.targetName, rootLabel: tp.root, open: () => Promise.reject(new Error(why)), node: nodeOf(tp.targetId), ops: [] });
        }
        continue;
      }
      const ids = selected === 'default' ? new Set(tp.ops.filter((o) => o.selected).map((o) => o.id)) : new Set(selected[tp.targetId] ?? []);
      const ops = tp.ops.filter((o) => ids.has(o.id));
      const behind = relayed.get(tp.targetId);
      // a relay with nothing to copy itself still hands the job on: the machines behind it may be behind
      if (!ops.length && !behind) continue;
      const node = nodeOf(tp.targetId)!;
      // a machine running SamSync takes its changes as a pack, whether or not others are behind it
      const takesPack = !!node.relay && node.transport !== 'sftp' && !req.direct && !tp.relayDown && node.id !== ctx.localNodeId;
      groups.push({
        key: tp.targetId,
        title: tp.targetName,
        rootLabel: tp.root,
        open: () => transportForNode(ctx, node),
        node,
        backup: tp.backup,
        ops: ops.map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, replaceType: o.replaceType, dstExists: o.dstMtime != null })),
        relay: behind || takesPack ? { targets: behind ?? [], job: relayJob(tp.targetId) } : undefined,
        manifest: this.planScans.get(plan.id)?.get(tp.targetId),
      });
    }
    if (!groups.length) throw new Error(t('Seçili işlem yok.'));
    const opts = { ...req.options, ...(overrides.dryRun != null ? { dryRun: overrides.dryRun } : {}) };
    const label = req.label || (req.origin === 'git' ? t('Git gönderimi') : t('Gönderim'));
    const last = plan.sources[plan.sources.length - 1];
    const s = this.execSettings(label, req.origin, opts, {
      sources: plan.sources.map((x) => x.path).slice(0, 200),
      postSource: last ? { path: last.path, rel: last.rel } : undefined,
      targetIds: plan.targets.map((tp) => tp.targetId),
    });
    const handle = startRun(ctx, groups, s);
    this.track(handle, overrides.notify ?? opts.notify !== false, (d) => this.relayFallback(plan, d, overrides));
    return handle;
  }

  /** A relay that never picked the job up: send to the machines behind it from here, as a run of its own. */
  private async relayFallback(plan: SendPlan, d: RunDetail, overrides: { notify?: boolean; nodes?: NodeConfig[] }): Promise<void> {
    // the relay itself too: with a pack its files were never written there
    const ids = d.targets.filter((x) => x.relayUnanswered).map((x) => x.key);
    if (!ids.length || plan.request.options.dryRun) return;
    this.log.warn(t('Röle'), t('Röle yanıt vermedi; {targets} için doğrudan gönderim başlıyor', { targets: ids.join(', ') }));
    const req: SendRequest = { ...plan.request, targetIds: ids, direct: true, label: t('{label} (doğrudan, röle yanıt vermedi)', { label: plan.request.label || t('Gönderim') }) };
    const direct = await buildSendPlan(this.ctx(), req);
    this.plans.set(direct.id, direct);
    try {
      this.runPlan(direct, 'default', { notify: overrides.notify, nodes: overrides.nodes, unreachableFails: true });
    } catch (e) {
      this.log.info(t('Röle'), errMessage(e));
    }
  }

  /** Starts or stops the relay service as this machine's node says. */
  private syncRelay(): void {
    const node = this.identity.node;
    const root = node?.relay ? node.localRoots[0] : undefined;
    if (this.relay && (this.relay.node.id !== node?.id || this.relay.localRoot !== root)) {
      this.relay.stop();
      this.relay = null;
    }
    if (!root || this.relay) return;
    this.relay = new RelayService(
      {
        ctx: () => this.ctx(),
        runPlan: (plan, label) => {
          try {
            return this.runPlan({ ...plan, request: { ...plan.request, label } }, 'default', { notify: false, unreachableFails: true });
          } catch {
            return null; // nothing to do on any machine
          }
        },
        runGroups: (groups, label, o) => {
          const s = this.execSettings(label, 'send', o.options, { backup: o.backup, verify: o.verify, parallelGroups: 1, targetIds: groups.map((g) => g.key) });
          const handle = startRun(this.ctx(), groups, s);
          this.track(handle, false);
          return handle;
        },
      },
      root,
      node!,
      2000,
      this.host.appVersion,
    );
    this.relay.start();
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

  async pauseRun(runId: string, paused: boolean) {
    this.runsActive.get(runId)?.pause(paused);
  }

  async cancelRunTarget(runId: string, key: string) {
    this.runsActive.get(runId)?.cancelTarget(key);
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
    const s = syncExecSettings(ctx, job, t('Senkron: {name}', { name: job.name }), result, groups, { dryRun, notify: true });
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
    const handle = startRun(ctx, groups, syncExecSettings(ctx, job, label, result, groups));
    this.track(handle, false, (detail) => updateDbAfterRun(ctx, job, result, detail));
    return { handle, actions: groups.reduce((a, g) => a + g.ops.length, 0) };
  }

  // ------------------------------------------------------------ automation

  async automationState(): Promise<AutomationState> {
    return this.automation?.snapshot() ?? { paused: false, watches: [], schedules: [] };
  }

  async watchAdd(cfg: Omit<WatchConfig, 'id'>): Promise<AutomationState> {
    if (!cfg.paths.length) throw new Error(t('İzlenecek dosya ya da klasör yok.'));
    if (!cfg.targetIds.length && !cfg.folders?.length && !cfg.syncJobId) throw new Error(t('Hedef seçilmedi.'));
    if (cfg.trigger === 'git' && !(await git.findRepoRoot(cfg.paths[0]))) throw new Error(t('{path} bir Git deposunda değil.', { path: cfg.paths[0] }));
    this.log.info(t('İzleme'), t('{name}: {n} yol → {targets}', { name: cfg.name, n: cfg.paths.length, targets: cfg.targetIds.join(', ') }));
    return this.automation!.addWatch(cfg);
  }

  async watchUpdate(id: string, patch: Partial<WatchConfig>): Promise<AutomationState> {
    return this.automation!.updateWatch(id, patch);
  }

  async watchRunNow(id: string): Promise<void> {
    this.automation!.runWatch(id);
  }

  async watchRemove(id: string): Promise<AutomationState> {
    return this.automation!.removeWatch(id);
  }

  async automationPause(paused: boolean): Promise<AutomationState> {
    await this.saveSettings({ automationPaused: paused });
    return this.automation!.snapshot();
  }

  async scheduleRunNow(jobId: string): Promise<void> {
    const quickId = quickIdOf(jobId);
    if (quickId) {
      const q = (this.settings.quickSends ?? []).find((x) => x.id === quickId);
      if (!q) throw new Error(t('Hızlı gönderim bulunamadı: {name}', { name: quickId }));
      void this.automation?.runQuickSchedule(q);
      return;
    }
    const job = this.config.syncJobs.find((j) => j.id === jobId);
    if (!job) throw new Error(t('İş bulunamadı'));
    void this.automation?.runSchedule(job);
  }

  /** A saved send run without the window (its schedule): planned and sent as it is; null when nothing differs. */
  private async runQuick(q: QuickSend, label: string): Promise<RunHandle | null> {
    const options: SendOptions = { ...baseSendOptions(this.config.copy, this.settings.sendDefaults), ...(q.options ?? {}), dryRun: false, notify: false };
    const req: SendRequest = { sources: q.paths.map((p) => ({ kind: 'fs', path: p })), targetIds: q.targetIds, options, origin: 'send', label };
    const scans: PlanScans = new Map();
    const plan = await buildSendPlan(this.ctx(), req, { scans });
    this.plans.set(plan.id, plan);
    this.planScans.set(plan.id, scans);
    try {
      return this.runPlan(plan, 'default', { notify: false, unreachableFails: true });
    } catch {
      return null;
    }
  }

  /** Sends a test message to the webhook and the Telegram chat set in the settings. */
  async notifyTest(): Promise<{ webhook?: string; telegram?: string }> {
    const s = this.settings.notifications;
    if (!s) return {};
    const text = t('SamSync bildirim sınaması: {host}', { host: os.hostname() });
    return sendNotification(s, { text, payload: { event: 'test', from: os.hostname(), version: this.host.appVersion, text } });
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

  /** Writes one sync job to a file of its own, to bring it into another configuration. */
  async exportSyncJob(jobId: string, dest: string): Promise<void> {
    const job = this.config.syncJobs.find((j) => j.id === jobId);
    if (!job) throw new Error(t('İş bulunamadı'));
    await fsp.writeFile(dest, jobFileText(job), 'utf8');
    this.log.info(t('Senkron'), t('{name} dışa aktarıldı: {path}', { name: job.name, path: dest }));
  }

  /** Adds the job of an exported job file to the configuration; returns its id here (a new one when the id was taken). */
  async importSyncJob(file: string): Promise<string> {
    const job = jobFromFile(await readJson(file), this.config.syncJobs, this.identity.node?.id);
    await this.saveConfig({ ...this.config, syncJobs: [...this.config.syncJobs, job] });
    this.log.info(t('Senkron'), t('{name} içe aktarıldı: {path}', { name: job.name, path: file }));
    return job.id;
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

  /** Undoes a run: what it replaced or deleted comes back from its backups, what it created goes. */
  async restoreRun(runId: string, backupCurrent: boolean): Promise<string> {
    const run = await this.history.get(runId);
    if (!run) throw new Error(t('Çalıştırma bulunamadı.'));
    if (!run.options?.backup) throw new Error(t('Bu gönderim yedek almadan yapılmış; geri alınamaz.'));
    if (run.dryRun) throw new Error(t('Deneme çalıştırması hiçbir şey yazmadı.'));
    const ctx = this.ctx();
    const groups = await restoreRunGroups(ctx, run);
    if (!groups.length) throw new Error(t('Geri alınacak bir şey bulunamadı (yedekler silinmiş olabilir).'));
    const s = this.execSettings(t('Geri alma: {label}', { label: run.label }), 'restore', { backup: backupCurrent, notify: true }, { sources: run.sources, targetIds: groups.map((g) => g.key) });
    const handle = startRun(ctx, groups, s);
    this.track(handle, true);
    return handle.id;
  }

  /** The text difference of the same file on two machines (the Compare page's machine mode). */
  async diffNodes(leftId: string, rightId: string, rel: string): Promise<DiffResult> {
    const ln = findNode(this.config, leftId);
    const rn = findNode(this.config, rightId);
    if (!ln || !rn) throw new Error(t('Hedef bulunamadı'));
    const ctx = this.ctx();
    const [lt, rt] = await Promise.all([transportForNode(ctx, ln), transportForNode(ctx, rn)]);
    const read = async (tg: Transport) => {
      const st = await tg.stat(rel);
      if (!st || st.isDir) return { buf: null as Buffer | null, info: { size: 0, exists: false } };
      return { buf: await readCapped(await tg.readStream(rel)), info: { size: st.size, mtimeMs: st.mtimeMs, exists: true } };
    };
    try {
      const [l, r] = await Promise.all([read(lt), read(rt)]);
      const d = textDiff(l.buf ?? Buffer.alloc(0), r.buf ?? Buffer.alloc(0), { leftLabel: ln.name, rightLabel: rn.name });
      return { ...d, leftInfo: l.info, rightInfo: r.info, leftLabel: ln.name, rightLabel: rn.name };
    } finally {
      await Promise.all([lt.close().catch(() => undefined), rt.close().catch(() => undefined)]);
    }
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
      settings: this.publicSettings(),
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

  /**
   * Everything that helps to look into a problem, in one folder the user picks: the logs, the configuration,
   * the settings, and a summary of this machine, the machines' reachability, the relay and the last runs.
   * The secrets file (SFTP passwords) is never included.
   */
  // ------------------------------------------------------------ help bot (Claude)

  async assistantStatus(): Promise<AssistantStatus> {
    return { configured: !!(await this.getSecret(ASSISTANT_SECRET)), model: ASSISTANT_MODEL };
  }

  async assistantSetKey(key: string | null): Promise<boolean> {
    const ok = await this.setSecret(ASSISTANT_SECRET, key?.trim() || null);
    if (ok) this.log.info(t('Yardım'), key ? t('Claude API anahtarı kaydedildi') : t('Claude API anahtarı kaldırıldı'));
    return ok;
  }

  private async readme(lang: 'tr' | 'en'): Promise<string> {
    if (!this.host.docsDir) return '';
    return fsp.readFile(path.join(this.host.docsDir, lang === 'tr' ? 'README.tr.md' : 'README.md'), 'utf8').catch(() => '');
  }

  async assistantAsk(turns: AssistantTurn[], lang: 'tr' | 'en'): Promise<AssistantReply> {
    const key = await this.getSecret(ASSISTANT_SECRET);
    if (!key) throw new Error(t('Claude API anahtarı tanımlı değil (Ayarlar › Yardım botu).'));
    const system = assistantSystem(lang, await this.readme(lang), this.host.appVersion);
    try {
      const r = await askAssistant(key, system, turns);
      this.log.info(t('Yardım'), t('Claude yanıtladı: {inp} giriş ({cached} önbellekten), {out} çıkış', { inp: r.usage.input, cached: r.usage.cached, out: r.usage.output }));
      return r;
    } catch (e) {
      const msg = assistantError(e);
      this.log.warn(t('Yardım'), msg);
      throw new Error(msg);
    }
  }

  async whatsNew(force = false): Promise<ChangelogSection | null> {
    if (!this.host.changelogPath) return null;
    const version = this.host.appVersion;
    if (!force) {
      const seen = this.settings.lastSeenVersion;
      if (seen === version) return null;
      if (!seen) {
        // a first start: nothing to tell yet, remember the version so the next update gets its card
        this.settings.lastSeenVersion = version;
        void this.persistSettings();
        return null;
      }
    }
    const section = await readChangelogSection(this.host.changelogPath, version);
    return section && section.items.length ? section : null;
  }

  async exportDiagnostics(): Promise<string | null> {
    const picked = (await this.host.pick?.({ folders: true, title: t('Tanılama klasörü nereye yazılsın?') })) ?? [];
    if (!picked.length) return null;
    const dir = path.join(picked[0], `SamSync-tanilama-${stamp()}`);
    await fsp.mkdir(dir, { recursive: true });
    // the log is written in the background: the lines of this very session must be on disk before the copy
    await this.log.drain?.();
    const logDir = path.dirname(this.log.file);
    for (const name of await fsp.readdir(logDir).catch(() => [] as string[])) {
      if (/\.log(\.\d+)?$/.test(name)) await fsp.copyFile(path.join(logDir, name), path.join(dir, name)).catch(() => undefined);
    }
    await fsp.copyFile(this.configPath, path.join(dir, 'config.json')).catch(() => undefined);
    await fsp.copyFile(this.settingsFile, path.join(dir, 'settings.json')).catch(() => undefined);
    const about = {
      version: this.host.appVersion,
      platform: process.platform,
      hostname: os.hostname(),
      exportedAt: new Date().toISOString(),
      configPath: this.configPath,
      identity: { node: this.identity.node?.id, method: this.identity.method, reason: this.identity.reason },
      relay: this.relay?.state() ?? { active: false, jobs: 0 },
      probes: [...this.lastProbes.values()],
      automation: this.automation?.snapshot(),
      lastRuns: (await this.runs()).slice(0, 20),
    };
    await fsp.writeFile(path.join(dir, 'about.json'), JSON.stringify(about, null, 2));
    this.log.info(t('Tanılama'), t('Tanılama klasörü yazıldı: {dir}', { dir }));
    await this.host.showInFolder?.(dir).catch(() => undefined);
    return dir;
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

  async clientError(message: string) {
    this.log.error(t('Arayüz'), String(message).slice(0, 8000));
  }

  rootLabel(nodeId: string) {
    const n = findNode(this.config, nodeId);
    return n ? nodeRootLabel(this.config, n) : '';
  }
}
