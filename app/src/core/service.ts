import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Api, IntegrationStatus, PickOptions, BrowseEntry } from '../shared/api';
import type { FilterPreview, FileTrace,
  AgentUpdateResult,
  HolderReport,
  DriftReport,
  ReleaseDiff,
  BusyFiles,
  StagedSend,
  ScheduledSend,
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
  InventoryEntry,
  SendMode,
  TimelineEntry,
  LocalIdentity,
  LocalSettings,
  PackWriteResult,
  SendPlan,
  SendOptions,
  SendRequest,
  PendingSend,
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
import { hashPassword, verifyPassword } from './webserver';
import { packFileName } from './packfile';
import { readChangelogSection } from './changelog';
import { ASSISTANT_MODEL, ASSISTANT_SECRET, askAssistant, assistantError, assistantSystem } from './assistant';
import { HashCache } from './hashcache';
import { PendingSends } from './pending';
import { probeNode } from './probe';
import { driftMessage, runMessage, sendNotification, startMessage, wantsNotification } from './notifications';
import { quickIdOf } from './automation';
import { baseSendOptions } from '../shared/options';
import { readManifest } from './manifest';
import { startRun, type ExecGroup, type ExecSettings, type RunHandle } from './executor';
import { probeNodes } from './probe';
import { FsTransport, transportForNode, transportForEndpoint, nodeRootLabel, type Transport } from './transport';
import { mapSource, normalizeAbs, pathKey } from './paths';
import { fsSources } from '../shared/sources';
import { runLocalCommand } from './command';
import { decodeText, textDiff, MAX_TEXT_DIFF_BYTES } from './textdiff';
import * as git from './git';
import { compareJob, syncExecSettings, syncGroups, updateDbAfterRun, resetDb } from './sync';
import { jobFileText, jobFromFile } from './jobfile';
import { findBackups, listBackupSets, browseBackup, restoreGroups, restoreRunGroups } from './backups';
import { findNode } from './context';
import crypto from 'node:crypto';
import { CancelToken, errMessage, formatBytes, mapLimit, newId, stamp, withTimeout } from './util';
import { RelayService, heartbeatFresh, readHeartbeat } from './relay';
import { driftFilter, driftOf, driftTime, type DriftResult } from './drift';
import { drifted, driftCounts } from '../shared/drift';
import { arpTable, broadcastAddresses, normalizeMac, subnetBroadcast, wake } from './wol';
import { releaseDiff, writeReleaseDiff } from './releasediff';
import { filterPreview } from './filterpreview';
import { writeRunHtml } from './runreport';
import { machinesFromCsv, machinesToCsv, type MachineCsvColumn } from '../shared/machinecsv';
import { inHours } from '../shared/machine';
import { lastMondayNine, weeklyMessage } from './weekly';
import { busyFiles, busyPrograms, listProcesses } from './processes';
import { ScheduledSends } from './scheduled';
import { powerAction } from './power';
import { expandTargetIds } from './context';
import { installerFromFile, putUpdate, type Installer } from './agentupdate';
import { askAgent } from './agentask';
import { HOLDERS_MAX_FILES, closePrograms, holdersUnder } from './holders';
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
  /** The Windows Setup of this version, for updating other machines (kept, from the update folder or downloaded once). */
  ownInstaller?(onProgress?: (done: number, total: number) => void): Promise<Installer>;
  /** This copy can run a Setup silently and restart on the new version (the installed Windows app). */
  canInstallUpdates?(): boolean;
  installUpdate?(file: string): boolean;
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

/** The account this SamSync runs as, the way whoami writes it: DOMAIN\user on Windows, the user name elsewhere. */
function whoami(): string | undefined {
  try {
    const user = os.userInfo().username;
    return process.platform === 'win32' ? `${process.env.USERDOMAIN || os.hostname()}\\${user}` : user;
  } catch {
    return undefined;
  }
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
    this.pending = new PendingSends(path.join(host.userDataPath, 'pending-sends.json'), {
      reachable: async (id) => {
        const n = findNode(this.config, id);
        // a machine that asked senders to wait while a program keeps it busy is not ready yet either
        return !!n && n.enabled !== false && (await probeNode(this.config, n, 3000, false)).ok && !(await this.heldBusy(n));
      },
      send: (item) => this.sendPending(item),
      changed: (items) => this.host.emit({ type: 'pending-sends', items }),
      expired: (item) => this.log.warn(t('Bekleyen gönderim'), t('{name} 7 gün içinde açılmadı; bekleyen gönderim düştü: {label}', { name: item.targetName, label: item.label || '-' })),
    });
    this.later = new ScheduledSends(path.join(host.userDataPath, 'scheduled-sends.json'), {
      run: (item) => this.runLater(item),
      wake: (item) => this.wakeLater(item),
      changed: (items) => this.host.emit({ type: 'scheduled-sends', items }),
    });
  }

  /** SamSync on the machine says a program keeps its target folder busy and asks senders to wait. */
  private async heldBusy(n: NodeConfig): Promise<boolean> {
    if (n.transport === 'sftp' || n.id === this.identity.node?.id) return false;
    let tgt: Transport | null = null;
    try {
      tgt = await transportForNode(this.ctx(), n);
      const h = await readHeartbeat(tgt);
      return !!h && heartbeatFresh(h) && !!h.holdWhileBusy && !!h.busyBy?.length;
    } catch {
      return false;
    } finally {
      await tgt?.close().catch(() => undefined);
    }
  }

  async busyFiles(nodeId: string): Promise<BusyFiles> {
    const n = findNode(this.config, nodeId);
    if (!n) throw new Error(t('Hedef bulunamadı'));
    const tgt = await transportForNode(this.ctx(), n);
    try {
      return await askAgent<BusyFiles>(tgt, { kind: 'busy' }, { answerMs: 60_000 });
    } finally {
      await tgt.close().catch(() => undefined);
    }
  }

  /** Sends waiting for machines that were off (Settings › Send when the machine is back). */
  readonly pending: PendingSends;

  /** Sends set for a time of their own (Send later in the review). */
  readonly later: ScheduledSends;

  async scheduleSend(planId: string, at: number, wake: boolean): Promise<ScheduledSend> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(t('Plan bulunamadı ya da eskidi; yeniden inceleyin.'));
    if (at < Date.now() + 10_000) throw new Error(t('Gelecekte bir zaman seçin.'));
    const item = await this.later.add(plan.request, at, wake);
    this.log.info(t('Sonra gönder'), t('{label}: {at} için kuruldu', { label: plan.request.label || t('Gönderim'), at: new Date(at).toLocaleString() }));
    return item;
  }

  async scheduledSends(): Promise<ScheduledSend[]> {
    return this.later.list();
  }

  async cancelScheduledSend(id: string): Promise<boolean> {
    return this.later.remove(id);
  }

  /** Its time came: planned now, with the sources as they are, and run like a reviewed send. */
  private async runLater(item: ScheduledSend): Promise<void> {
    // an automatic retry keeps its own label; a send set for later says so
    const req: SendRequest = { ...item.request, label: item.request.attempt ? item.label : t('Zamanlanmış: {label}', { label: item.label || t('Gönderim') }) };
    const scans: PlanScans = new Map();
    const plan = await buildSendPlan(this.ctx(), req, { scans });
    this.plans.set(plan.id, plan);
    this.planScans.set(plan.id, scans);
    try {
      this.runPlan(plan, 'default', { notify: true, unreachableFails: true, queueUnreachable: true });
      this.log.info(t('Sonra gönder'), t('{label} başladı', { label: req.label! }));
    } catch {
      this.log.info(t('Sonra gönder'), t('{label}: gönderilecek fark yok', { label: req.label! }));
    }
  }

  /** A few minutes before: the machines of the send that are off and whose MAC address is known are woken. */
  private async wakeLater(item: ScheduledSend): Promise<void> {
    const nodes = expandTargetIds(this.config, item.request.targetIds, this.identity.node?.id);
    const ids = nodes.filter((n) => n.mac || this.macs.get(n.id)?.length).map((n) => n.id);
    if (!ids.length) return;
    const probes = await probeNodes(this.config, nodes.filter((n) => ids.includes(n.id)), 1500, false);
    const off = probes.filter((p) => !p.ok).map((p) => p.nodeId);
    if (off.length) await this.wake(off);
  }

  async pendingSends(): Promise<PendingSend[]> {
    return this.pending.list();
  }

  async cancelPendingSend(id: string): Promise<boolean> {
    return this.pending.remove(id);
  }

  /** A machine that was off answers again: its waiting send is planned now (the sources as they are) and run. */
  private async sendPending(item: PendingSend): Promise<{ done: true } | { done: false; error: string }> {
    if (!findNode(this.config, item.targetId)) return { done: true }; // the machine is no longer in the configuration
    const req: SendRequest = { ...item.request, label: t('Açılınca: {label}', { label: item.label || t('Gönderim') }) };
    const scans: PlanScans = new Map();
    const plan = await buildSendPlan(this.ctx(), req, { scans });
    const tp = plan.targets[0];
    if (!tp?.reachable) return { done: false, error: tp?.error || t('Hedefe erişilemiyor') };
    this.plans.set(plan.id, plan);
    this.planScans.set(plan.id, scans);
    let h: RunHandle;
    try {
      h = this.runPlan(plan, 'default', { notify: true });
    } catch {
      this.log.info(t('Bekleyen gönderim'), t('{name} açıldı; gönderilecek fark kalmamış: {label}', { name: item.targetName, label: item.label || '-' }));
      return { done: true }; // nothing differs any more
    }
    this.log.info(t('Bekleyen gönderim'), t('{name} açıldı; bekleyen gönderim gidiyor: {label}', { name: item.targetName, label: item.label || '-' }));
    const d = await h.done;
    return d.status === 'failed' ? { done: false, error: d.targets[0]?.error || t('Gönderim başarısız') } : { done: true };
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
    await this.pending.load();
    this.pending.start();
    await this.later.load();
    this.later.start();
    // the drift check on schedule, when one is set (Targets › Machine inventory), and the weekly summary
    setInterval(() => void this.driftTick(), 10 * 60_000).unref();
    setInterval(() => void this.weeklyTick(), 10 * 60_000).unref();
    setTimeout(() => void this.weeklyTick(), 60_000).unref();
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
  async exportMachinesCsv(dest: string): Promise<void> {
    await fsp.writeFile(dest, machinesToCsv(this.config.nodes), 'utf8');
  }

  async readMachinesCsv(file: string): Promise<{ nodes: NodeConfig[]; errors: string[]; columns: MachineCsvColumn[] }> {
    return machinesFromCsv(decodeText(await fsp.readFile(file)));
  }

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
    const { passwordHash, viewerHash, ...rest } = w;
    return { ...this.settings, webUi: { ...rest, hasPassword: !!passwordHash, hasViewer: !!viewerHash } };
  }

  async saveSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
    const pinChanged = 'localNodeId' in patch && patch.localNodeId !== this.settings.localNodeId;
    // the server mode is changed through webUiConfigure only (the settings a window sends back have no hash)
    const { webUi: _ignored, ...safe } = patch;
    // the weekly summary's last time is kept here: the copy a window sends back may be older
    if (safe.notifications?.weekly && this.settings.notifications?.weekly) safe.notifications = { ...safe.notifications, weeklyLastAt: this.settings.notifications.weeklyLastAt };
    this.settings = { ...this.settings, ...safe };
    await this.persistSettings();
    if (pinChanged) {
      this.identity = detectIdentity(this.config, this.settings.localNodeId);
      this.syncRelay();
    }
    if ('updateAutoCheck' in patch || 'updateAutoDownload' in patch) this.host.updater?.configure(this.config.update, this.settings);
    if ('agent' in patch) {
      this.syncRelay();
      this.relay?.refreshDriftWatch();
    }
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

  async webUiConfigure(patch: { enabled?: boolean; port?: number; lan?: boolean; https?: boolean; password?: string | null; viewerPassword?: string | null }): Promise<WebUiState> {
    const cur: WebUiSettings = this.settings.webUi ?? { enabled: false, port: 8780, lan: true };
    const next: WebUiSettings = {
      enabled: patch.enabled ?? cur.enabled,
      port: Math.max(1024, Math.min(65535, Math.round(patch.port ?? cur.port) || 8780)),
      lan: patch.lan ?? cur.lan,
      https: patch.https ?? cur.https,
      passwordHash: patch.password === undefined ? cur.passwordHash : patch.password ? hashPassword(patch.password) : undefined,
      viewerHash: patch.viewerPassword === undefined ? cur.viewerHash : patch.viewerPassword ? hashPassword(patch.viewerPassword) : undefined,
    };
    if (patch.password != null && patch.password.length < 8) throw new Error(t('Parola en az 8 karakter olmalı'));
    if (patch.viewerPassword != null && patch.viewerPassword.length < 8) throw new Error(t('Parola en az 8 karakter olmalı'));
    if (next.viewerHash && next.passwordHash && patch.viewerPassword && verifyPassword(patch.viewerPassword, next.passwordHash)) throw new Error(t('İzleyici parolası ana paroladan farklı olmalı'));
    // the other way round too: a main password that is the viewer's would make every viewer an admin
    if (next.viewerHash && patch.password && verifyPassword(patch.password, next.viewerHash)) throw new Error(t('İzleyici parolası ana paroladan farklı olmalı'));
    if (next.enabled && !next.passwordHash) throw new Error(t('Önce bir parola belirleyin'));
    this.settings = { ...this.settings, webUi: next };
    await this.persistSettings();
    this.log.info(t('Web arayüzü'), next.enabled ? t('Açık: kapı {port}, {where}', { port: next.port, where: (next.lan ? t('ağdan erişilebilir') : t('yalnızca bu bilgisayar')) + (next.https ? ', HTTPS' : '') }) : t('Kapalı'));
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
    await this.learnMacs(results, nodes);
    await this.noteSeen(results);
    for (const r of results) {
      const n = nodes.find((x) => x.id === r.nodeId);
      const seen = this.lastSeen.get(r.nodeId);
      if (seen) r.lastSeenAt = seen;
      const macs = [...new Set([n?.mac, ...(this.macs.get(r.nodeId) ?? [])].filter((m): m is string => !!m))];
      if (macs.length) r.macs = macs;
      this.lastProbes.set(r.nodeId, r);
    }
    this.host.emit({ type: 'probe', results });
    return results;
  }

  /** node id -> when it last answered a probe (userData/last-seen.json, written at most every few minutes). */
  private lastSeen = new Map<string, number>();
  private lastSeenLoaded = false;
  private lastSeenWritten = 0;

  private async noteSeen(results: ProbeResult[]): Promise<void> {
    const file = path.join(this.host.userDataPath, 'last-seen.json');
    if (!this.lastSeenLoaded) {
      this.lastSeenLoaded = true;
      try {
        for (const [id, at] of Object.entries((await readJson(file)) as Record<string, number>)) if (typeof at === 'number') this.lastSeen.set(id, at);
      } catch {
        /* nothing seen yet */
      }
    }
    let fresh = false;
    for (const r of results) {
      if (!r.ok) continue;
      fresh ||= !this.lastSeen.has(r.nodeId);
      this.lastSeen.set(r.nodeId, r.checkedAt);
    }
    if (fresh || Date.now() - this.lastSeenWritten > 5 * 60_000) {
      this.lastSeenWritten = Date.now();
      await writeJsonAtomic(file, Object.fromEntries(this.lastSeen)).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------ waking machines up

  /** node id -> MAC addresses learned while the machine was on (userData/macs.json). */
  private macs = new Map<string, string[]>();
  private macsLoaded = false;
  private get macsFile() {
    return path.join(this.host.userDataPath, 'macs.json');
  }

  /** From the heartbeats of SamSync on the machines, and the ARP table for the others that answered. */
  private async learnMacs(results: ProbeResult[], nodes: NodeConfig[]): Promise<void> {
    if (!this.macsLoaded) {
      this.macsLoaded = true;
      try {
        for (const [id, list] of Object.entries((await readJson(this.macsFile)) as Record<string, string[]>)) if (Array.isArray(list)) this.macs.set(id, list);
      } catch {
        /* none learned yet */
      }
    }
    let changed = false;
    const set = (id: string, list: string[]) => {
      const clean = [...new Set(list.map(normalizeMac).filter((m): m is string => !!m))].sort();
      if (!clean.length || JSON.stringify(clean) === JSON.stringify(this.macs.get(id) ?? [])) return;
      this.macs.set(id, clean);
      changed = true;
    };
    for (const r of results) if (r.ok && r.agent?.alive && r.agent.macs?.length) set(r.nodeId, r.agent.macs);
    // the others that answered: this computer talked to them just now, so its ARP table knows their cards
    const ask = results.filter((r) => r.ok && !this.macs.has(r.nodeId) && !(r.agent?.alive && r.agent.macs?.length));
    if (ask.length) {
      const arp = await arpTable().catch(() => new Map<string, string>());
      for (const r of ask) {
        const mac = arp.get(nodes.find((n) => n.id === r.nodeId)?.address.trim() ?? '');
        if (mac) set(r.nodeId, [mac]);
      }
    }
    if (changed) await writeJsonAtomic(this.macsFile, Object.fromEntries(this.macs)).catch(() => undefined);
  }

  async machineTimeline(nodeId: string): Promise<TimelineEntry[]> {
    const tags = new Map((this.settings.releaseTags ?? []).map((x) => [x.runId, x.name]));
    const out: TimelineEntry[] = [];
    for (const r of await this.history.list()) {
      const tg = r.targets.find((x) => x.key === nodeId);
      if (!tg) continue;
      out.push({ runId: r.id, label: r.label, origin: r.origin, at: r.startedAt, finishedAt: tg.finishedAt ?? r.finishedAt, status: tg.status, done: tg.done, failed: tg.failed, bytes: tg.bytesDone, via: tg.via, deferred: tg.deferred, error: tg.error, check: tg.check, release: tags.get(r.id), dryRun: r.dryRun || undefined });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 300);
  }

  async machineFolders(nodeId: string): Promise<InventoryEntry[]> {
    const n = findNode(this.config, nodeId);
    if (!n) throw new Error(t('Hedef bulunamadı'));
    const tgt = await transportForNode(this.ctx(), n);
    try {
      const m = await withTimeout(readManifest(tgt), 8000);
      return Object.entries(m?.subtrees ?? {})
        .map(([rel, sub]) => {
          const files = (sub.entries ?? []).filter((e) => e[1] !== 1);
          return { rel, label: sub.label, writtenAt: sub.writtenAt, by: sub.by, files: files.length, dirs: (sub.entries ?? []).length - files.length, size: files.reduce((a, e) => a + e[2], 0) };
        })
        .sort((a, b) => a.rel.localeCompare(b.rel));
    } finally {
      await tgt.close().catch(() => undefined);
    }
  }

  /**
   * Distributing from a machine: SamSync there gets a relay job with no files of ours, only its own folders to send on,
   * and sends them from its disk to the machines named, over its own network. The run shows each machine, as a relay's.
   */
  async distributeFrom(sourceId: string, rels: string[], targetIds: string[], mode: SendMode): Promise<string> {
    const src = findNode(this.config, sourceId);
    if (!src) throw new Error(t('Hedef bulunamadı'));
    const targets = targetIds.map((id) => findNode(this.config, id)).filter((n): n is NodeConfig => !!n && n.enabled && n.id !== sourceId && n.id !== this.identity.node?.id);
    if (!rels.length || !targets.length) throw new Error(t('Bir klasör ve en az bir hedef seçin.'));
    const ctx = this.ctx();
    const tgt = await transportForNode(ctx, src);
    try {
      if (!heartbeatFresh(await readHeartbeat(tgt))) throw new Error(t('{name} makinesinde SamSync çalışmıyor; dağıtım oradaki SamSync ile yapılır.', { name: src.name }));
    } finally {
      await tgt.close().catch(() => undefined);
    }
    const options: SendOptions = { ...baseSendOptions(this.config.copy, this.settings.sendDefaults), mode, dryRun: false, notify: false };
    const label = t('{name} makinesinden: {folders}', { name: src.name, folders: rels.map((r) => r || '/').join(', ') });
    const job: RelayJob = { id: newId('relay-'), createdAt: Date.now(), label, from: ctx.localNodeId, sources: rels.map((rel) => ({ rel, kind: 'fs' as const })), targetIds: targets.map((n) => n.id), options };
    const group: ExecGroup = { key: src.id, title: src.name, rootLabel: nodeRootLabel(this.config, src), open: () => transportForNode(ctx, src), node: src, ops: [], relay: { targets, job } };
    const s = this.execSettings(label, 'send', options, { sources: rels, targetIds: [src.id, ...job.targetIds] });
    const handle = this.startQueued(ctx, [group], s);
    this.track(handle, true);
    this.log.info(t('Dağıt'), t('{label} → {targets}', { label, targets: targets.map((n) => n.name).join(', ') }));
    return handle.id;
  }

  async power(nodeIds: string[], action: 'restart' | 'shutdown' | 'cancel'): Promise<{ nodeId: string; ok: boolean; error?: string }[]> {
    return mapLimit(nodeIds, 6, async (id) => {
      const n = findNode(this.config, id);
      if (!n) return { nodeId: id, ok: false, error: t('Hedef bulunamadı') };
      let tgt: Transport | null = null;
      try {
        tgt = await transportForNode(this.ctx(), n);
        await askAgent(tgt, { kind: 'power', action, delaySec: 60, from: this.identity.node?.id }, { answerMs: 30_000 });
        this.log.info(t('Uzaktan'), action === 'cancel' ? t('{name}: bekleyen yeniden başlatma iptal edildi', { name: n.name }) : action === 'restart' ? t('{name}: bir dakika içinde yeniden başlayacak', { name: n.name }) : t('{name}: bir dakika içinde kapanacak', { name: n.name }));
        return { nodeId: id, ok: true };
      } catch (e) {
        return { nodeId: id, ok: false, error: errMessage(e) };
      } finally {
        await tgt?.close().catch(() => undefined);
      }
    });
  }

  async wake(nodeIds: string[]): Promise<{ nodeId: string; ok: boolean; error?: string }[]> {
    const out: { nodeId: string; ok: boolean; error?: string }[] = [];
    for (const id of nodeIds) {
      const n = findNode(this.config, id);
      const macs = [...new Set([n?.mac, ...(this.macs.get(id) ?? [])].filter((m): m is string => !!m))];
      if (!n || !macs.length) {
        out.push({ nodeId: id, ok: false, error: t('MAC adresi bilinmiyor: makine açıkken bir kez yoklanınca öğrenilir ya da makineyi düzenleyip girin') });
        continue;
      }
      try {
        const own = subnetBroadcast(n.address);
        await wake(macs, [...new Set([...broadcastAddresses(), ...(own ? [own] : [])])]);
        out.push({ nodeId: id, ok: true });
        this.log.info(t('Uyandırma'), t('{name}: uyandırma paketi gönderildi ({macs})', { name: n.name, macs: macs.join(', ') }));
      } catch (e) {
        out.push({ nodeId: id, ok: false, error: errMessage(e) });
      }
    }
    return out;
  }

  async describeSources(paths: string[], count = true, secrets?: Record<string, string>, rels?: Record<string, string>) {
    return describeSources(this.ctx(), paths, count, secrets, rels);
  }

  async mapPath(abs: string) {
    const isDir = !!(await fsp.stat(abs).catch(() => null))?.isDirectory();
    return mapSource(abs, this.ctx().localRoots, isDir, this.config.copy.outsideRoots);
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
        onProgress: (p) => this.host.emit({ type: 'task-progress', taskId, message: p.message, done: p.done, total: p.total, targets: p.targets }),
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
  async writePack(req: SendRequest, dir: string, taskId: string, password?: string, since?: { pack?: string; targetId?: string }): Promise<PackWriteResult> {
    const cancel = new CancelToken();
    this.tasks.set(taskId, cancel);
    const file = path.join(dir, packFileName(req.label || t('Gönderim')));
    try {
      this.log.info(t('Paket'), password ? t('{n} kaynak → {file} (parolalı)', { n: req.sources.length, file }) : t('{n} kaynak → {file}', { n: req.sources.length, file }));
      const r = await writeSendPack(this.ctx(), req, file, {
        cancel,
        password,
        since,
        onProgress: (p) => this.host.emit({ type: 'task-progress', taskId, message: p.message, done: p.done, total: p.total, targets: p.targets }),
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

  /** The operations of the last sends, for "retry the files in use" without planning again (memory only). */
  private recentGroups = new Map<string, { groups: ExecGroup[]; settings: ExecSettings }>();

  private keepGroups(id: string, groups: ExecGroup[], settings: ExecSettings): void {
    this.recentGroups.set(id, { groups, settings });
    while (this.recentGroups.size > 10) this.recentGroups.delete(this.recentGroups.keys().next().value!);
  }

  /** The runs writing to machines now, by their machines: with Settings › Copy › queue on, a new one waits for them. */
  private runKeys = new Map<string, { keys: Set<string>; done: Promise<unknown> }>();

  private startQueued(ctx: CoreContext, groups: ExecGroup[], s: ExecSettings): RunHandle {
    const keys = new Set(groups.flatMap((g) => [g.key, ...(g.relay?.targets.map((n) => n.id) ?? [])]));
    const before = this.config.copy.queueSends ? [...this.runKeys.values()].filter((r) => [...r.keys].some((k) => keys.has(k))).map((r) => r.done.catch(() => undefined)) : [];
    const handle = startRun(ctx, groups, before.length ? { ...s, waitFor: Promise.all(before).then(() => undefined) } : s);
    this.runKeys.set(handle.id, { keys, done: handle.done });
    handle.done.finally(() => this.runKeys.delete(handle.id)).catch(() => undefined);
    return handle;
  }

  /** The files a program held open in a finished send, written again now to the same machines, without a review. */
  async retryInUse(runId: string): Promise<string> {
    const kept = this.recentGroups.get(runId);
    const detail = kept ? await this.history.get(runId) : null;
    if (!kept || !detail) throw new Error(t('Bu çalıştırmanın işlemleri artık bellekte değil; “Yeniden dene” ile yeniden planlayın.'));
    const ids = new Map<string, Set<string>>();
    for (const r of detail.results) if (!r.ok && r.inUse) ids.set(r.key, (ids.get(r.key) ?? new Set<string>()).add(r.opId));
    const groups: ExecGroup[] = kept.groups
      .filter((g) => ids.has(g.key))
      .map((g) => ({
        ...g,
        ops: g.ops.filter((o) => ids.get(g.key)!.has(o.id)),
        // the manifest left after the first run stays; a machine running SamSync gets a new pack with these only
        manifest: undefined,
        relay: g.relay ? { targets: [], job: { ...g.relay.job, id: newId('relay-'), targetIds: [], pack: undefined } } : undefined,
      }))
      .filter((g) => g.ops.length);
    if (!groups.length) throw new Error(t('Bu çalıştırmada kullanımda kalan dosya yok.'));
    const s: ExecSettings = { ...kept.settings, label: t('Kullanımdakiler: {label}', { label: kept.settings.label }), targetIds: groups.map((g) => g.key), retryInUseAtEnd: false };
    const handle = this.startQueued(this.ctx(), groups, s);
    this.keepGroups(handle.id, groups, s);
    this.track(handle, true);
    return handle.id;
  }

  /**
   * Puts the Setup of this version on the machines' shares; SamSync there installs it once idle. The machines of a
   * group whose relay passes updates on get it from the relay, so the slow link carries it once.
   */
  async updateAgents(nodeIds: string[], taskId: string, installer?: string): Promise<AgentUpdateResult[]> {
    const cancel = new CancelToken();
    this.tasks.set(taskId, cancel);
    const progress = (message: string, done?: number, total?: number) => this.host.emit({ type: 'task-progress', taskId, message, done, total });
    try {
      let inst: Installer;
      if (installer) inst = await installerFromFile(installer);
      else if (this.host.ownInstaller) inst = await this.host.ownInstaller((done, total) => progress(t('Kurulum dosyası indiriliyor'), done, total || undefined));
      else throw new Error(t('Bu kopyanın kurulum dosyası yok; bir SamSync-Setup dosyası seçin'));
      const ctx = this.ctx();
      const nodes = nodeIds.map((id) => findNode(this.config, id)).filter((n): n is NodeConfig => !!n && n.id !== ctx.localNodeId);
      const forwarder = (n: NodeConfig) => {
        if (n.relay || !n.group) return undefined;
        return this.config.nodes.find((r) => {
          const a = this.lastProbes.get(r.id)?.agent;
          return r.relay && r.enabled && r.id !== n.id && r.group?.toLowerCase() === n.group!.toLowerCase() && a?.alive && a.forwardUpdates;
        });
      };
      const direct: NodeConfig[] = [];
      const via = new Map<string, NodeConfig[]>();
      for (const n of nodes) {
        const r = forwarder(n);
        if (r) via.set(r.id, [...(via.get(r.id) ?? []), n]);
        else direct.push(n);
      }
      // a relay that is up to date itself still passes the file on
      const dests = [
        ...direct.map((n) => ({ node: n, install: true, forward: via.get(n.id) })),
        ...[...via.keys()].filter((id) => !direct.some((n) => n.id === id)).map((id) => ({ node: findNode(this.config, id)!, install: false, forward: via.get(id) })),
      ];
      const size = (await fsp.stat(inst.file)).size;
      const out: AgentUpdateResult[] = [];
      for (const [i, d] of dests.entries()) {
        cancel.throwIfCancelled();
        const forward = d.forward?.map((n) => n.id);
        try {
          const tgt = await transportForNode(ctx, d.node);
          try {
            await putUpdate(tgt, inst, { install: d.install, forward, from: ctx.localNodeId }, (bytes) => progress(t('{name}: SamSync {version} gönderiliyor', { name: d.node.name, version: inst.version }), i * size + bytes, dests.length * size));
          } finally {
            await tgt.close().catch(() => undefined);
          }
          if (d.install) out.push({ nodeId: d.node.id, ok: true });
          for (const id of forward ?? []) out.push({ nodeId: id, ok: true, via: d.node.id });
          this.log.info(t('Güncelleme'), t('{name}: SamSync {version} kurulumu bırakıldı{via}', { name: d.node.name, version: inst.version, via: forward?.length ? ` (+${forward.length} ${t('makineye iletilecek')})` : '' }));
        } catch (e) {
          if (d.install) out.push({ nodeId: d.node.id, ok: false, error: errMessage(e) });
          for (const id of forward ?? []) out.push({ nodeId: id, ok: false, error: errMessage(e), via: d.node.id });
          this.log.warn(t('Güncelleme'), t('{name}: kurulum dosyası gönderilemedi: {error}', { name: d.node.name, error: errMessage(e) }));
        }
      }
      return out;
    } finally {
      this.tasks.delete(taskId);
    }
  }

  private drift: DriftReport[] | null = null;
  private driftRunning = false;

  async lastDrift(): Promise<DriftReport[] | null> {
    return this.drift;
  }

  async driftCheck(nodeIds: string[] | null, taskId: string): Promise<DriftReport[]> {
    const cancel = new CancelToken();
    this.tasks.set(taskId, cancel);
    try {
      const ctx = this.ctx();
      const nodes = this.config.nodes.filter((n) => n.enabled && (!nodeIds || nodeIds.includes(n.id)));
      const filter = driftFilter(ctx);
      const time = driftTime(ctx);
      let done = 0;
      const reports = await mapLimit(nodes, 4, async (n): Promise<DriftReport> => {
        const r: DriftReport = { nodeId: n.id, name: n.name, checkedAt: Date.now(), reachable: true, manifest: false, subtrees: [], changed: 0, added: 0, removed: 0 };
        let tgt: Transport | null = null;
        try {
          const self = n.id === ctx.localNodeId;
          if (!self) {
            const p = await probeNode(this.config, n, 1500, false);
            if (!p.ok) {
              r.reachable = false;
              r.error = p.detail;
              return r;
            }
          }
          tgt = await transportForNode(ctx, n);
          // SamSync there walks its own disk: fast, and nothing comes over the network but the answer
          const beat = !self && tgt.kind === 'fs' ? await readHeartbeat(tgt).catch(() => null) : null;
          const byAgent = !!beat && heartbeatFresh(beat) && !!beat.asks?.includes('drift');
          const res = byAgent ? await askAgent<DriftResult>(tgt, { kind: 'drift' }, { answerMs: 15 * 60_000, cancelled: () => cancel.cancelled }) : await driftOf(tgt, filter, time, this.config.copy.backupFolderName, cancel);
          r.manifest = res.manifest;
          r.subtrees = res.subtrees;
          r.byAgent = byAgent || undefined;
          for (const s of r.subtrees) {
            r.changed += s.counts.changed;
            r.added += s.counts.added;
            r.removed += s.counts.removed;
          }
        } catch (e) {
          if (cancel.cancelled) throw e;
          r.error = errMessage(e);
        } finally {
          await tgt?.close().catch(() => undefined);
          done++;
          this.host.emit({ type: 'task-progress', taskId, message: t('{done} / {total} makine denetlendi', { done, total: nodes.length }), done, total: nodes.length });
        }
        return r;
      });
      this.drift = reports;
      this.host.emit({ type: 'drift', reports });
      const found = reports.filter(drifted);
      this.log.info(t('Sapma'), t('{n} makine denetlendi; {d} makinede son gönderimden sonra değişiklik var', { n: reports.length, d: found.length }));
      for (const r of found) this.log.warn(t('Sapma'), `${r.name}: ${driftCounts(r)}`);
      return reports;
    } finally {
      this.tasks.delete(taskId);
    }
  }

  /** The scheduled drift check: when it is due, every machine; changes go to the desktop and the team's channel. */
  private async driftTick(): Promise<void> {
    const hours = this.settings.driftCheckHours ?? 0;
    if (!hours || this.driftRunning || Date.now() - (this.settings.driftLastAt ?? 0) < hours * 3600_000) return;
    this.driftRunning = true;
    try {
      this.settings.driftLastAt = Date.now();
      await this.persistSettings();
      const reports = await this.driftCheck(null, newId('drift-'));
      const found = reports.filter(drifted);
      if (!found.length) return;
      this.host.notify?.(t('Sapma: {n} makinede değişiklik', { n: found.length }), found.map((r) => `${r.name}: ${driftCounts(r)}`).join('\n'));
      const ns = this.settings.notifications;
      if (ns && (ns.webhookUrl || (ns.telegramToken && ns.telegramChatId))) {
        void sendNotification(ns, driftMessage(reports, { host: os.hostname(), user: whoami(), version: this.host.appVersion })).then((r) => {
          for (const [ch, res] of Object.entries(r)) if (res !== 'ok') this.log.warn(t('Bildirim'), t('{channel} gönderilemedi: {error}', { channel: ch, error: res }));
        });
      }
    } catch (e) {
      this.log.warn(t('Sapma'), errMessage(e));
    } finally {
      this.driftRunning = false;
    }
  }

  /** The files of a finished run that a program held open, by machine. */
  private async inUseOf(runId: string): Promise<{ detail: RunDetail; byKey: Map<string, string[]> }> {
    const detail = await this.history.get(runId);
    if (!detail) throw new Error(t('Çalıştırma bulunamadı'));
    const byKey = new Map<string, string[]>();
    for (const r of detail.results) if (!r.ok && r.inUse) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.rel]);
    return { detail, byKey };
  }

  /** A transport to a machine of a run (also a plain folder of a watch, kept with the run's operations). */
  private async runTransport(runId: string, key: string): Promise<Transport> {
    const node = findNode(this.config, key) ?? this.recentGroups.get(runId)?.groups.find((g) => g.key === key)?.node;
    if (!node) throw new Error(t('Hedef bulunamadı'));
    return transportForNode(this.ctx(), node);
  }

  /** A folder on this computer (not a share): its programs are looked at here, not by SamSync elsewhere. */
  private static localFolder(tgt: Transport): string | null {
    return tgt instanceof FsTransport && !/^[\\/]{2}/.test(tgt.root) ? tgt.root : null;
  }

  async whoHolds(runId: string): Promise<HolderReport[]> {
    const { detail, byKey } = await this.inUseOf(runId);
    return mapLimit([...byKey], 4, async ([key, rels]): Promise<HolderReport> => {
      const report: HolderReport = { key, title: detail.targets.find((x) => x.key === key)?.title ?? key, programs: [], inUse: rels.length, asked: Math.min(rels.length, HOLDERS_MAX_FILES), canClose: false };
      let tgt: Transport | null = null;
      try {
        tgt = await this.runTransport(runId, key);
        const local = Service.localFolder(tgt);
        const r = local ? { programs: await holdersUnder(local, rels), canClose: true } : await askAgent<{ programs: HolderReport['programs']; canClose: boolean }>(tgt, { kind: 'holders', rels: rels.slice(0, HOLDERS_MAX_FILES) }, { answerMs: 90_000 });
        report.programs = r.programs ?? [];
        report.canClose = !!r.canClose;
      } catch (e) {
        report.error = errMessage(e);
      } finally {
        await tgt?.close().catch(() => undefined);
      }
      return report;
    });
  }

  async closeHolders(runId: string, key: string, pids: number[]): Promise<{ closed: number; failed: string[] }> {
    const { byKey } = await this.inUseOf(runId);
    const rels = (byKey.get(key) ?? []).slice(0, HOLDERS_MAX_FILES);
    if (!rels.length) return { closed: 0, failed: [] };
    const tgt = await this.runTransport(runId, key);
    try {
      const local = Service.localFolder(tgt);
      // only the programs that hold one of these files now are closed, whatever ids came with the request
      const r = local ? await closePrograms((await holdersUnder(local, rels)).filter((h) => pids.includes(h.pid))) : await askAgent<Awaited<ReturnType<typeof closePrograms>>>(tgt, { kind: 'close', rels, pids }, { answerMs: 60_000 });
      this.log.info(t('Kullanımdakiler'), t('{key}: {n} program kapatıldı{failed}', { key, n: r.closed.length, failed: r.failed.length ? ` • ${r.failed.map((f) => `${f.name}: ${f.error}`).join(', ')}` : '' }));
      return { closed: r.closed.length, failed: r.failed.map((f) => `${f.name} (${f.pid}): ${f.error}`) };
    } finally {
      await tgt.close().catch(() => undefined);
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
      preCommand: o.runPreCommand !== false ? c.preCommand || undefined : undefined,
      postCommand: o.runPostCommand ? c.postCommand : undefined,
      postCommandFails: c.postCommandFails === true,
      postCommandTimeoutSeconds: c.postCommandTimeoutSeconds,
      // the limit holds in its hours only (Settings › Copy), as they are when the send starts
      bandwidthMBps: inHours(c.bandwidthHours, new Date()) ? c.bandwidthMBps : 0,
      retryInUseAtEnd: this.settings.retryInUseAtEnd === true,
      sources: [],
      targetIds: [],
      options: o,
      ...extra,
    };
  }

  /** `channel` false: the run is part of someone else's send (a relay or an agent working for the sender), whose own run reports it. */
  private track(handle: RunHandle, notify: boolean, after?: (d: Awaited<RunHandle['done']>) => Promise<void>, channel = true) {
    this.runsActive.set(handle.id, handle);
    handle.done
      .then(async (detail) => {
        await this.history.save(detail).catch((e) => this.log.error(t('Geçmiş'), t('Kaydedilemedi'), e));
        void this.hashCache.flush();
        // the team's channel, when one is set: never waits for, never fails the run
        if (channel && wantsNotification(this.settings.notifications, detail)) {
          void sendNotification(this.settings.notifications!, runMessage(detail, { host: os.hostname(), user: whoami(), version: this.host.appVersion }, this.config.nodes.filter((n) => n.id !== this.identity.node?.id))).then((r) => {
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
  runPlan(
    plan: SendPlan,
    selected: Record<string, string[]> | 'default',
    overrides: { dryRun?: boolean; notify?: boolean; unreachableFails?: boolean; queueUnreachable?: boolean; nodes?: NodeConfig[]; channel?: boolean; stages?: { first: string[]; auto: boolean }; fromRelay?: 'job' | 'queue' } = {},
  ): RunHandle {
    const ctx = this.ctx();
    // targets outside the configuration (a watch's plain folders) come with the plan
    const nodeOf = (id: string) => findNode(this.config, id) ?? overrides.nodes?.find((n) => n.id === id);
    let groups: ExecGroup[] = [];
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
      options: { ...req.options, dryRun: false, notify: false, runPostCommand: req.options.runPostCommand, runPreCommand: req.options.runPreCommand },
      // the machine-specific files of the machines behind it, which its own copy does not hold for them
      stash: relayed.get(relayId)?.length ? plan.stash?.[relayId]?.info : undefined,
    });
    for (const tp of plan.targets) {
      if (tp.via) continue;
      // a machine that asked to be left alone while a program keeps it busy: the send waits here until it closes
      if (tp.reachable && tp.held && !(overrides.dryRun ?? req.options.dryRun) && (req.origin === 'send' || req.origin === 'git')) {
        this.pending.add(req, tp.targetId, tp.targetName);
        if (overrides.unreachableFails) {
          const why = t('Meşgul: {programs} çalışıyor; kapanınca gönderilecek', { programs: (tp.busyBy ?? []).join(', ') });
          groups.push({ key: tp.targetId, title: tp.targetName, rootLabel: tp.root, open: () => Promise.reject(new Error(why)), node: nodeOf(tp.targetId), ops: [] });
        }
        continue;
      }
      if (!tp.reachable) {
        // kept for later when asked for: the machine gets the send once it answers again
        const queued = !!overrides.queueUnreachable && this.settings.sendWhenOnline === true && !tp.failed && !(overrides.dryRun ?? req.options.dryRun) && (req.origin === 'send' || req.origin === 'git');
        if (queued) this.pending.add(req, tp.targetId, tp.targetName);
        // a machine that was off counts as failed, so "select the failed ones" and "resend to failed" include it
        if (overrides.unreachableFails) {
          const why = (tp.error || t('Hedefe erişilemiyor')) + (queued ? ` • ${t('açılınca gönderilecek')}` : '');
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
      // a machine running SamSync (its heartbeat was fresh when the plan was made) takes its changes as a pack,
      // whether or not others are behind it
      const takesPack = !!tp.agent && node.transport !== 'sftp' && !req.direct && node.id !== ctx.localNodeId;
      groups.push({
        key: tp.targetId,
        title: tp.targetName,
        rootLabel: tp.root,
        open: () => transportForNode(ctx, node),
        node,
        // all or nothing needs the old files to put back
        backup: tp.backup || !!req.options.rollbackOnFailure,
        ops: ops.map((o) => ({ id: o.id, kind: o.kind, rel: o.rel, isDir: o.isDir, size: o.size, mtimeMs: o.srcMtime, src: o.src, replaceType: o.replaceType, dstExists: o.dstMtime != null, onlyIfEmpty: o.onlyIfEmpty })),
        relay: behind || takesPack ? { targets: behind ?? [], job: relayJob(tp.targetId) } : undefined,
        manifest: this.planScans.get(plan.id)?.get(tp.targetId),
        manifestExcluded: plan.manifestExcluded,
        stash: behind?.length ? plan.stash?.[tp.targetId]?.files : undefined,
      });
    }
    if (!groups.length) throw new Error(t('Seçili işlem yok.'));
    const opts = { ...req.options, ...(overrides.dryRun != null ? { dryRun: overrides.dryRun } : {}) };
    const label = req.label || (req.origin === 'git' ? t('Git gönderimi') : t('Gönderim'));
    const last = plan.sources[plan.sources.length - 1];
    const shown = plan.sources.slice(0, 200);
    const outside = shown.filter((x) => x.outsideRoots && !x.pack);
    const s = this.execSettings(label, req.origin, opts, {
      sources: shown.map((x) => x.path),
      sourceRels: outside.length ? Object.fromEntries(outside.map((x) => [x.path, x.rel])) : undefined,
      postSource: last ? { path: last.path, rel: last.rel } : undefined,
      targetIds: plan.targets.map((tp) => tp.targetId),
    });
    // a staged send: the first machines now, the rest once they went through (a machine behind a relay rides with it)
    const first = new Set(overrides.stages && !opts.dryRun ? overrides.stages.first : []);
    const later = first.size ? groups.filter((g) => !first.has(g.key)) : [];
    const stages = later.length && later.length < groups.length ? overrides.stages : undefined;
    let s1 = s;
    let s2: ExecSettings | null = null;
    if (stages) {
      groups = groups.filter((g) => first.has(g.key));
      const keysOf = (list: ExecGroup[]) => list.flatMap((g) => [g.key, ...(g.relay?.targets.map((n) => n.id) ?? [])]);
      s1 = { ...s, label: t('{label} (1. aşama)', { label }), targetIds: keysOf(groups) };
      s2 = { ...s, label: t('{label} (2. aşama)', { label }), targetIds: keysOf(later) };
    }
    const handle = this.startQueued(ctx, groups, s1);
    this.keepGroups(handle.id, groups, s1);
    const after = async (d: RunDetail) => {
      await this.rollbackFailed(d, opts);
      await this.relayFallback(plan, d, overrides);
      // a relay's run for a sender: the sender restarts the machines and tries the failed ones again, not the relay too
      // (a delivery from the relay's queue restarts its machine, as nobody else does then; the queue retries it)
      if (overrides.fromRelay !== 'job') await this.powerAfter(d, opts);
      if (!overrides.fromRelay) await this.retryFailedLater(d, plan);
    };
    this.track(
      handle,
      overrides.notify ?? opts.notify !== false,
      async (d) => {
        await after(d);
        if (stages && s2) await this.firstStageDone(d, label, later, s2, stages.auto, after, overrides.notify ?? opts.notify !== false, overrides.channel !== false);
      },
      overrides.channel !== false,
    );
    if (overrides.channel !== false && !opts.dryRun && (plan.request.origin === 'send' || plan.request.origin === 'git')) this.notifyStart(s1.label, groups);
    return handle;
  }

  /** Settings › Notifications › on start: what goes where, to the team's channel (never waits for, never fails the run). */
  private notifyStart(label: string, groups: ExecGroup[]): void {
    const ns = this.settings.notifications;
    if (!ns?.onStart || !(ns.webhookUrl || (ns.telegramToken && ns.telegramChatId))) return;
    const targets = groups.flatMap((g) => [{ key: g.key, title: g.title }, ...(g.relay?.targets.map((n) => ({ key: n.id, title: n.name })) ?? [])]);
    const copies = groups.flatMap((g) => g.ops.filter((o) => o.kind === 'copy'));
    const msg = startMessage(label, targets, copies.reduce((a, o) => a + o.size, 0), groups.reduce((a, g) => a + g.ops.length, 0), { host: os.hostname(), user: whoami(), version: this.host.appVersion }, this.config.nodes.filter((n) => n.id !== this.identity.node?.id));
    void sendNotification(ns, msg).then((r) => {
      for (const [ch, res] of Object.entries(r)) if (res !== 'ok') this.log.warn(t('Bildirim'), t('{channel} gönderilemedi: {error}', { channel: ch, error: res }));
    });
  }

  // ------------------------------------------------------------ staged sends

  /** First stage run id -> what the second stage sends, kept until it goes or is dropped (the last few only). */
  private staged = new Map<string, { state: StagedSend; groups: ExecGroup[]; settings: ExecSettings; notify: boolean; channel: boolean; after: (d: RunDetail) => Promise<void> }>();

  /**
   * The first machines of a staged send are done: when every one of them went through (and its health check, if
   * any, said yes) the rest go now with `auto`, or wait for a go; otherwise the send stops here and waits.
   */
  private async firstStageDone(d: RunDetail, label: string, later: ExecGroup[], settings: ExecSettings, auto: boolean, after: (d: RunDetail) => Promise<void>, notify: boolean, channel: boolean): Promise<void> {
    const firstOk = d.status === 'ok' && d.targets.every((x) => x.status === 'ok' && x.check?.ok !== false);
    const rest = later.flatMap((g) => [{ key: g.key, name: g.title }, ...(g.relay?.targets.map((n) => ({ key: n.id, name: n.name })) ?? [])]);
    const state: StagedSend = { runId: d.id, label, rest, status: firstOk ? 'waiting' : 'stopped', firstOk, at: Date.now() };
    this.staged.set(d.id, { state, groups: later, settings, notify, channel, after });
    while (this.staged.size > 20) this.staged.delete(this.staged.keys().next().value!);
    if (firstOk && auto) {
      await this.continueStaged(d.id);
      return;
    }
    this.host.emit({ type: 'staged', state });
    this.log[firstOk ? 'info' : 'warn'](t('Aşamalı gönderim'), firstOk ? t('{label}: ilk makineler tamam; kalan {n} makine onay bekliyor', { label, n: rest.length }) : t('{label}: ilk makinelerde hata var; kalan {n} makineye gönderilmedi', { label, n: rest.length }));
    this.host.notify?.(firstOk ? t('{label}: ilk aşama tamam', { label }) : t('{label}: ilk aşama hatalı', { label }), firstOk ? t('Kalan {n} makine onayınızı bekliyor', { n: rest.length }) : t('Kalan {n} makineye gönderilmedi', { n: rest.length }));
  }

  async stagedSend(runId: string): Promise<StagedSend | null> {
    return this.staged.get(runId)?.state ?? null;
  }

  async continueStaged(runId: string): Promise<string> {
    const st = this.staged.get(runId);
    if (!st || st.state.status === 'continued' || st.state.status === 'dropped') throw new Error(t('Bu gönderimin bekleyen aşaması yok.'));
    const handle = this.startQueued(this.ctx(), st.groups, st.settings);
    this.keepGroups(handle.id, st.groups, st.settings);
    this.track(handle, st.notify, st.after, st.channel);
    st.state = { ...st.state, status: 'continued', nextRunId: handle.id };
    this.host.emit({ type: 'staged', state: st.state });
    this.log.info(t('Aşamalı gönderim'), t('{label}: kalan {n} makineye gönderiliyor', { label: st.state.label, n: st.state.rest.length }));
    return handle.id;
  }

  async dropStaged(runId: string): Promise<void> {
    const st = this.staged.get(runId);
    if (!st || st.state.status === 'continued') return;
    st.state = { ...st.state, status: 'dropped' };
    st.groups = [];
    this.host.emit({ type: 'staged', state: st.state });
  }

  /**
   * Settings › Copy › retry failed machines: the machines a send failed on (not those that were off and wait in the
   * queue, nor a cancel) get the same send again some minutes later, planned anew then, a few times at most.
   */
  private async retryFailedLater(d: RunDetail, plan: SendPlan): Promise<void> {
    const c = this.config.copy;
    const req = plan.request;
    const minutes = c.retryFailedMinutes ?? 0;
    const times = c.retryFailedTimes ?? 3;
    const attempt = (req.attempt ?? 0) + 1;
    if (!minutes || d.dryRun || d.status === 'cancelled' || (req.origin !== 'send' && req.origin !== 'git') || attempt > times) return;
    const waiting = new Set(this.pending.list().map((p) => p.targetId));
    // a relay that never took the job: its machines already got a direct send (relayFallback)
    const failed = d.targets.filter((x) => (x.status === 'failed' || x.status === 'partial') && !x.deferred && !x.relayUnanswered && !waiting.has(x.key) && findNode(this.config, x.key)).map((x) => x.key);
    if (!failed.length) return;
    const base = req.retryLabel ?? (req.label || t('Gönderim'));
    const at = Date.now() + minutes * 60_000;
    await this.later.add({ ...req, targetIds: failed, attempt, retryLabel: base, label: t('{label} (yeniden deneme {k}/{n})', { label: base, k: attempt, n: times }) }, at, false);
    this.log.info(t('Yeniden deneme'), t('{names}: {m} dk sonra yeniden denenecek ({k}/{n})', { names: failed.map((id) => findNode(this.config, id)?.name ?? id).join(', '), m: minutes, k: attempt, n: times }));
  }

  /** A send option: the machines that got it (and allow it) restart or shut down a minute after. */
  private async powerAfter(d: RunDetail, o: Partial<SendOptions>): Promise<void> {
    if (!o.powerAfter || d.dryRun) return;
    const ok = d.targets.filter((x) => x.status === 'ok' && findNode(this.config, x.key) && x.key !== this.identity.node?.id).map((x) => x.key);
    if (!ok.length) return;
    for (const r of await this.power(ok, o.powerAfter)) if (!r.ok) this.log.warn(t('Uzaktan'), `${findNode(this.config, r.nodeId)?.name ?? r.nodeId}: ${r.error}`);
  }

  /**
   * All or nothing (a send option): a machine where the send went only partly is put back as it was before it, from
   * the backup the send took there. A machine that was never reached has nothing to put back.
   */
  private async rollbackFailed(d: RunDetail, o: Partial<SendOptions>): Promise<void> {
    if (!o.rollbackOnFailure || d.dryRun) return;
    const failed = d.targets.filter((x) => (x.status === 'partial' || x.status === 'failed') && !x.relayUnanswered);
    if (!failed.length) return;
    const ctx = this.ctx();
    const groups = await restoreRunGroups(ctx, { ...d, targets: failed });
    if (!groups.length) return;
    this.log.warn(t('Geri alma'), t('{label}: hata olan {names} gönderim öncesine döndürülüyor', { label: d.label, names: groups.map((g) => g.title).join(', ') }));
    const s = this.execSettings(t('Geri alındı (hata): {label}', { label: d.label }), 'restore', { backup: false, notify: true }, { sources: d.sources, targetIds: groups.map((g) => g.key) });
    const handle = this.startQueued(ctx, groups, s);
    this.track(handle, true);
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

  /**
   * Starts or stops the relay service: as the relay of its group when this machine's node says so, otherwise as the
   * agent that applies the packs sent to this machine (Settings › Agent, on by default).
   */
  private syncRelay(): void {
    const node = this.identity.node;
    const role: 'relay' | 'agent' | null = node?.relay ? 'relay' : (this.settings.agent?.receivePacks ?? true) ? 'agent' : null;
    const root = role ? node?.localRoots[0] : undefined;
    if (this.relay && (this.relay.node.id !== node?.id || this.relay.localRoot !== root || this.relay.role !== role)) {
      this.relay.stop();
      // an agent turned off takes its folder away again; a relay keeps its queue
      if (this.relay.role === 'agent') this.relay.removeIfIdle();
      this.relay = null;
    }
    if (!root || !role || this.relay) return;
    this.relay = new RelayService(
      {
        ctx: () => this.ctx(),
        agent: () => this.settings.agent,
        runHook: async (label, cmd) => {
          const r = await runLocalCommand(cmd, this.config.copy.postCommandTimeoutSeconds);
          this.log[r.ok ? 'info' : 'error'](t('Ajan'), r.error ? t('{label} çalıştırılamadı: {error}', { label, error: r.error }) : r.timedOut ? t('{label} {s} sn içinde bitmedi, durduruldu', { label, s: this.config.copy.postCommandTimeoutSeconds }) : r.output ? t('{label} bitti (kod {code}): {output}', { label, code: String(r.code), output: r.output }) : t('{label} bitti (kod {code})', { label, code: String(r.code) }));
          return { ok: r.ok, code: r.code, output: r.error ?? (r.timedOut ? t('{label} {s} sn içinde bitmedi, durduruldu', { label, s: this.config.copy.postCommandTimeoutSeconds }) : r.output) };
        },
        notify: (title, body) => this.host.notify?.(title, body),
        acceptsUpdates: () => this.settings.agent?.acceptUpdates === true && (this.host.canInstallUpdates?.() ?? false),
        idle: () => this.runsActive.size === 0,
        installUpdate: (file) => this.host.installUpdate?.(file) ?? false,
        answer: async (ask) => {
          if (ask.kind === 'holders') return { programs: await holdersUnder(root, ask.rels), canClose: this.settings.agent?.allowClose === true };
          if (ask.kind === 'close') {
            if (this.settings.agent?.allowClose !== true) throw new Error(t('Bu makine programlarının uzaktan kapatılmasına izin vermiyor (Ayarlar › Ajan)'));
            // only the programs that hold one of the sender's files now
            const held = (await holdersUnder(root, ask.rels)).filter((h) => ask.pids.includes(h.pid));
            const r = await closePrograms(held);
            this.log.info(t('Ajan'), t('Gönderenin isteğiyle kapatılan programlar: {list}', { list: held.filter((h) => r.closed.includes(h.pid)).map((h) => h.name).join(', ') || '-' }));
            return r;
          }
          if (ask.kind === 'power') {
            if (this.settings.agent?.allowPower !== true) throw new Error(t('Bu makine uzaktan yeniden başlatılmaya ya da kapatılmaya izin vermiyor (Ayarlar › Ajan)'));
            const who = ask.from ? (this.config.nodes.find((n) => n.id === ask.from)?.name ?? ask.from) : '?';
            await powerAction(ask.action, ask.delaySec ?? 60, ask.action === 'restart' ? t('SamSync: {from} yeniden başlatıyor', { from: who }) : t('SamSync: {from} kapatıyor', { from: who }));
            this.log.warn(t('Ajan'), ask.action === 'cancel' ? t('Bekleyen yeniden başlatma ya da kapatma iptal edildi ({from})', { from: who }) : ask.action === 'restart' ? t('{from} isteğiyle bir dakika içinde yeniden başlatılıyor', { from: who }) : t('{from} isteğiyle bir dakika içinde kapatılıyor', { from: who }));
            return { ok: true };
          }
          if (ask.kind === 'busy') {
            const procs = busyPrograms(await listProcesses(), root, this.settings.agent?.busyPrograms);
            const files = await busyFiles(procs.map((p) => p.pid), root).catch(() => ({}) as Record<number, string[]>);
            return { programs: procs.map((p) => ({ name: p.name, pid: p.pid, path: p.path, files: files[p.pid] ?? [] })) } satisfies BusyFiles;
          }
          if (ask.kind === 'drift') {
            const ctx = this.ctx();
            return driftOf(new FsTransport(root), driftFilter(ctx), driftTime(ctx), this.config.copy.backupFolderName);
          }
          throw new Error(t('Bu soru burada yanıtlanmıyor'));
        },
        runPlan: (plan, label, report) => {
          try {
            // what the relay does for a sender is reported by the sender's run, once, with every machine in it
            return this.runPlan({ ...plan, request: { ...plan.request, label } }, 'default', { notify: false, unreachableFails: true, channel: report === true, fromRelay: report === true ? 'queue' : 'job' });
          } catch {
            return null; // nothing to do on any machine
          }
        },
        runGroups: (groups, label, o) => {
          const s = this.execSettings(label, 'send', o.options, { backup: o.backup, verify: o.verify, parallelGroups: 1, targetIds: groups.map((g) => g.key) });
          const handle = startRun(this.ctx(), groups, s);
          // a pack applied for a sender: the sender's run reports it
          this.track(handle, false, undefined, false);
          return handle;
        },
      },
      root,
      node!,
      2000,
      this.host.appVersion,
      role,
    );
    this.relay.start();
  }

  /** remember: false for the one-click menu sends, so "send with last settings" keeps what was last reviewed. */
  async executePlan(planId: string, selected: Record<string, string[]>, overrides: { dryRun?: boolean; remember?: boolean; stages?: { first: string[]; auto: boolean } } = {}): Promise<string> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(t('Plan bulunamadı ya da eskidi; yeniden inceleyin.'));
    const handle = this.runPlan(plan, selected, { dryRun: overrides.dryRun, unreachableFails: true, queueUnreachable: true, stages: overrides.stages });
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

  async setRunNote(runId: string, note: string): Promise<void> {
    await this.history.setNote(runId, note.trim().slice(0, 1000));
    this.host.emit({ type: 'history-changed' });
  }

  async filterPreview(req: SendRequest): Promise<FilterPreview> {
    return filterPreview(this.ctx(), req);
  }

  async releaseDiff(fromRunId: string, toRunId: string | null): Promise<ReleaseDiff> {
    const names = new Map((this.settings.releaseTags ?? []).map((x) => [x.runId, x.name]));
    return releaseDiff(await this.history.list(), (id) => this.history.get(id), fromRunId, toRunId, names);
  }

  async exportReleaseDiff(fromRunId: string, toRunId: string | null, format: 'csv' | 'html'): Promise<string> {
    return writeReleaseDiff(await this.releaseDiff(fromRunId, toRunId), this.reportsDir(), format);
  }

  exportRunCsv(id: string) {
    return this.history.exportCsv(id, this.reportsDir());
  }

  async exportRunHtml(id: string): Promise<string | null> {
    const run = await this.history.get(id);
    if (!run) return null;
    const tag = (this.settings.releaseTags ?? []).find((x) => x.runId === id)?.name;
    return writeRunHtml(run, this.reportsDir(), tag);
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
    const req: SendRequest = { sources: fsSources(q.paths, q.rels), targetIds: q.targetIds, options, origin: 'send', label };
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
  async sendWeeklySummary(): Promise<{ webhook?: string; telegram?: string }> {
    const s = this.settings.notifications;
    if (!s || !(s.webhookUrl || (s.telegramToken && s.telegramChatId))) return {};
    const names = new Map(this.config.nodes.map((n) => [n.id, n.name]));
    const msg = weeklyMessage(await this.history.list(), [...this.lastProbes.values()], names, this.drift, { host: os.hostname(), user: whoami(), version: this.host.appVersion });
    return sendNotification(s, msg);
  }

  /** Monday 09:00 (or the first start after it): the summary of the week, once. */
  private async weeklyTick(now = new Date()): Promise<void> {
    const s = this.settings.notifications;
    if (!s?.weekly) return;
    // switched on just now: the first summary is the next Monday's, not one straight away
    if (!s.weeklyLastAt) {
      this.settings.notifications = { ...s, weeklyLastAt: now.getTime() };
      await this.persistSettings();
      return;
    }
    const due = lastMondayNine(now);
    if (s.weeklyLastAt >= due) return;
    this.settings.notifications = { ...s, weeklyLastAt: now.getTime() };
    await this.persistSettings();
    const r = await this.sendWeeklySummary().catch((e) => ({ error: errMessage(e) }));
    for (const [ch, res] of Object.entries(r)) if (res !== 'ok') this.log.warn(t('Bildirim'), t('{channel} gönderilemedi: {error}', { channel: ch, error: String(res) }));
  }

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
  /** `only`: just these machines of the run (going back to a release point leaves the others as they are). */
  async restoreRun(runId: string, backupCurrent: boolean, only?: ReadonlySet<string>): Promise<string> {
    const run = await this.history.get(runId);
    if (!run) throw new Error(t('Çalıştırma bulunamadı.'));
    if (!run.options?.backup) throw new Error(t('Bu gönderim yedek almadan yapılmış; geri alınamaz.'));
    if (run.dryRun) throw new Error(t('Deneme çalıştırması hiçbir şey yazmadı.'));
    const ctx = this.ctx();
    const groups = (await restoreRunGroups(ctx, run)).filter((g) => !only || only.has(g.key));
    if (!groups.length) throw new Error(t('Geri alınacak bir şey bulunamadı (yedekler silinmiş olabilir).'));
    const s = this.execSettings(t('Geri alma: {label}', { label: run.label }), 'restore', { backup: backupCurrent, notify: true }, { sources: run.sources, targetIds: groups.map((g) => g.key) });
    const handle = this.startQueued(ctx, groups, s);
    this.track(handle, true);
    return handle.id;
  }

  /**
   * Brings the tagged run's machines back to how that run left them: every later send to any of them is undone from
   * its backups, newest first, one after the other. A run that kept no backup (or whose backups are gone) is skipped
   * and named in the result.
   */
  async restoreToTag(runId: string, backupCurrent: boolean): Promise<{ restored: number; skipped: string[] }> {
    const all = await this.runs();
    const tag = all.find((r) => r.id === runId);
    if (!tag) throw new Error(t('Çalıştırma bulunamadı.'));
    const machines = new Set(tag.targetIds);
    const later = all
      .filter((r) => r.startedAt > tag.startedAt && (r.origin === 'send' || r.origin === 'git') && !r.dryRun && r.targetIds.some((id) => machines.has(id)))
      .sort((a, b) => b.startedAt - a.startedAt);
    const skipped: string[] = [];
    let restored = 0;
    for (const r of later) {
      try {
        // only on the release point's machines: a later send that also went elsewhere stays there
        const id = await this.restoreRun(r.id, backupCurrent, machines);
        const d = await this.runsActive.get(id)?.done;
        if (d && d.status !== 'ok') skipped.push(`${r.label}: ${t('{ok} başarılı, {failed} hatalı', { ok: d.opsOk, failed: d.opsFailed })}`);
        else restored++;
      } catch (e) {
        skipped.push(`${r.label}: ${errMessage(e)}`);
      }
    }
    this.log.info(t('Geçmiş'), t('{name} noktasına dönüldü: {n} gönderim geri alındı, {skipped} atlandı', { name: tag.label, n: restored, skipped: skipped.length }));
    return { restored, skipped };
  }

  /** Where a file went: the runs whose results name it, newest first; `limit` lines at most. */
  async findInHistory(query: string, limit = 300): Promise<FileTrace[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: FileTrace[] = [];
    for (const r of (await this.runs()).slice(0, 400)) {
      const d = await this.history.get(r.id).catch(() => null);
      if (!d) continue;
      for (const x of d.results) {
        if (!x.rel.toLowerCase().includes(q)) continue;
        out.push({ runId: r.id, startedAt: r.startedAt, label: r.label, origin: r.origin, target: x.key, rel: x.rel, kind: x.kind, ok: x.ok });
        if (out.length >= limit) return out;
      }
    }
    return out;
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
    const handle = this.startQueued(ctx, groups, s);
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

  /** Opens where a send lands on a machine in the file manager: this machine's own root, or the share or folder. */
  async openTarget(nodeId: string) {
    const n = findNode(this.config, nodeId);
    if (!n) throw new Error(t('Hedef bulunamadı: {ids}', { ids: nodeId }));
    if (n.transport === 'sftp') throw new Error(t('SFTP hedefi dosya yöneticisinde açılamaz.'));
    const ctx = this.ctx();
    const root = n.id === ctx.localNodeId && ctx.localRoots[0] ? ctx.localRoots[0] : nodeRootLabel(this.config, n);
    await this.host.openPath?.(root);
  }
}
