import type {
  AppConfig,
  BackupLookup,
  AssistantReply,
  AssistantStatus,
  AssistantTurn,
  BackupSet,
  ChangelogSection,
  Bootstrap,
  CompareResult,
  DiffResult,
  GitChange,
  GitDiffSpec,
  GitLogPage,
  GitRepoInfo,
  LocalIdentity,
  InventoryRow,
  LocalSettings,
  PackWriteResult,
  ProbeResult,
  SpeedTestResult,
  DiscoveredHost,
  RelayState,
  RunDetail,
  RunSummary,
  SendPlan,
  SendRequest,
  SourceInfo,
  SourceSpec,
  SyncAction,
  SyncJob,
  UpdateState,
  FileMeta,
  ThemePref,
  AutomationState,
  WatchConfig,
  WizardImportResult,
  DirListing,
  WebUiState,
} from './types';

export interface PickOptions {
  title?: string;
  folders?: boolean;
  files?: boolean;
  multi?: boolean;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface NotepadPlusPlusInstallStatus {
  exe: string;
  version?: string;
  configDir: string;
  portable: boolean;
  running: boolean;
  installed: boolean;
  warnings: string[];
}

/** Explorer menu and Notepad++ integration (Windows only). */
export interface IntegrationStatus {
  supported: boolean;
  explorer: {
    enabled: boolean;
    installed: boolean;
    /** Program the menu starts. */
    command?: string;
    /** Groups shown as submenus with their machines / as one entry. */
    expanded: string[];
    collapsed: string[];
    overBudget: boolean;
    error?: string;
  };
  notepadPlusPlus: {
    enabled: boolean;
    installs: NotepadPlusPlusInstallStatus[];
    /** Notepad++ was open while its files changed; they are written again once it closes. */
    waitingForExit: boolean;
    error?: string;
  };
}

export interface BrowseEntry {
  rel: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

/** Everything the renderer can ask the main process. Both the Electron IPC bridge and the dev web server implement it. */
export interface Api {
  bootstrap(): Promise<Bootstrap>;
  saveConfig(cfg: AppConfig): Promise<{ config: AppConfig; identity: LocalIdentity }>;
  readConfigFile(path: string): Promise<AppConfig>;
  /** The configuration file (or another one) as text. */
  configText(path?: string): Promise<string>;
  saveConfigText(text: string): Promise<Bootstrap>;
  exportConfig(dest: string): Promise<void>;
  pickSave(opts: PickOptions): Promise<string | null>;
  useConfigFile(path: string | null): Promise<Bootstrap>;
  saveSettings(patch: Partial<LocalSettings>): Promise<LocalSettings>;
  setSecret(nodeId: string, secret: string | null): Promise<boolean>;

  probe(nodeIds?: string[]): Promise<ProbeResult[]>;
  /** Writes a few MB to the machine and reads them back: the pace of the link, as a number. */
  speedTest(nodeId: string): Promise<SpeedTestResult>;
  /** What the relay service on this machine is doing. */
  relayState(): Promise<RelayState>;
  /** A folder of this computer (null: its drives), for a browser's file picker in server mode. */
  listDir(path: string | null): Promise<DirListing>;
  /** Server mode: its state, and switching it on or off, the port, network access and the password (from the desktop only). */
  webUiState(): Promise<WebUiState>;
  webUiConfigure(patch: { enabled?: boolean; port?: number; lan?: boolean; password?: string | null }): Promise<WebUiState>;
  /** Scans this computer's subnets for machines that answer on file sharing or SSH; cancellable through cancelTask. */
  discoverHosts(taskId: string): Promise<DiscoveredHost[]>;
  /** Every enabled machine's manifest, read now: which release each one holds under each sent folder. */
  inventory(): Promise<InventoryRow[]>;
  /** `secrets`: passwords for protected packs by path; a pack opened once stays open while the app runs. */
  describeSources(paths: string[], count?: boolean, secrets?: Record<string, string>): Promise<SourceInfo[]>;
  mapPath(abs: string): Promise<{ rel: string; root?: string; outside: boolean }>;

  planSend(req: SendRequest, taskId: string): Promise<SendPlan>;
  /** Writes the request's sources to a pack file (.samsync-pack) in `dir`, for a release that travels on a disk; with a password, encrypted. */
  writePack(req: SendRequest, dir: string, taskId: string, password?: string): Promise<PackWriteResult>;
  cancelTask(taskId: string): Promise<void>;
  /** `selected`: target id -> ids of the plan operations to run. */
  executePlan(planId: string, selected: Record<string, string[]>, overrides?: { dryRun?: boolean; remember?: boolean }): Promise<string>;
  cancelRun(runId: string): Promise<void>;
  /** Holds a running send between files (a streamed copy stops mid-file) until resumed with false. */
  pauseRun(runId: string, paused: boolean): Promise<void>;
  /** Drops one target from a running send: its remaining operations are skipped, the others go on. */
  cancelRunTarget(runId: string, key: string): Promise<void>;
  compareWithTarget(src: SourceSpec, targetId: string, rel: string): Promise<DiffResult>;

  runs(): Promise<RunSummary[]>;
  run(id: string): Promise<RunDetail | null>;
  deleteRun(id: string): Promise<void>;
  clearRuns(): Promise<void>;
  exportRunCsv(id: string): Promise<string | null>;

  gitRepos(): Promise<GitRepoInfo[]>;
  gitAddRepo(path: string): Promise<GitRepoInfo | null>;
  gitRemoveRepo(root: string): Promise<void>;
  gitStatus(repo: string): Promise<{ info: GitRepoInfo; changes: GitChange[] }>;
  gitLog(repo: string, q: { skip?: number; limit?: number; search?: string; ref?: string; all?: boolean; path?: string }): Promise<GitLogPage & { unpushed: string[] }>;
  gitBranches(repo: string): Promise<{ current: string; local: string[]; remote: string[] }>;
  gitCommitChanges(repo: string, shas: string[]): Promise<GitChange[]>;
  gitSources(req: { repo: string; changes: { path: string; oldPath?: string }[]; contentFrom: 'worktree' | 'commit'; rev?: string }): Promise<SourceSpec[]>;
  gitDiff(spec: GitDiffSpec): Promise<DiffResult>;

  compareJob(job: SyncJob, taskId: string): Promise<CompareResult>;
  syncRun(compareId: string, job: SyncJob, overrides: Record<string, Record<string, SyncAction>>, dryRun?: boolean): Promise<string>;
  syncItemDiff(compareId: string, pairId: string, key: string): Promise<DiffResult>;
  resetSyncState(jobId: string): Promise<void>;
  /** Writes a sync job to a file ({ "samsyncSyncJob": 1, "job": ... }) to bring it into another configuration. */
  exportSyncJob(jobId: string, dest: string): Promise<void>;
  /** Adds the job of such a file to the configuration and returns its id (a new one when the id is taken). */
  importSyncJob(path: string): Promise<string>;
  browse(endpoint: { kind: 'local'; path: string } | { kind: 'node'; nodeId: string; subPath: string }, rel: string): Promise<BrowseEntry[]>;

  findBackups(rel: string, targetIds: string[]): Promise<BackupLookup[]>;
  backupSets(targetIds: string[]): Promise<BackupSet[]>;
  browseBackup(targetId: string, stamp: string, relDir: string, folder?: string): Promise<BrowseEntry[]>;
  restore(rel: string, picks: { targetId: string; stamp: string; folder?: string }[], backupCurrent: boolean): Promise<string>;
  /** Undoes a whole run from its backups (replaced and deleted files come back, created ones go); the run id of the restore. */
  restoreRun(runId: string, backupCurrent: boolean): Promise<string>;
  /** The text difference of the same file on two machines. */
  diffNodes(leftId: string, rightId: string, rel: string): Promise<DiffResult>;

  /** The old wizard's state file on this computer, if there is one. */
  findWizardState(): Promise<string | null>;
  importWizardState(file: string): Promise<WizardImportResult>;

  pick(opts: PickOptions): Promise<string[]>;
  openPath(p: string): Promise<void>;
  showInFolder(p: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openLog(): Promise<void>;
  /** Copies the logs, the configuration, the settings (no secrets) and a summary into a folder the user picks; null when cancelled. */
  exportDiagnostics(): Promise<string | null>;
  /** The help bot's cloud half: whether a Claude key is set, setting it, and asking a question with the conversation so far. */
  assistantStatus(): Promise<AssistantStatus>;
  assistantSetKey(key: string | null): Promise<boolean>;
  assistantAsk(turns: AssistantTurn[], lang: 'tr' | 'en'): Promise<AssistantReply>;
  /** This version's changelog section: after an update once (null when it was shown), or always with `force`. */
  whatsNew(force?: boolean): Promise<ChangelogSection | null>;
  statFile(p: string): Promise<FileMeta | null>;

  integrationStatus(): Promise<IntegrationStatus | null>;
  integrationSet(patch: Pick<LocalSettings, 'explorerMenu' | 'notepadPlusPlus'>): Promise<IntegrationStatus | null>;

  updateState(): Promise<UpdateState>;
  updateCheck(): Promise<UpdateState>;
  updateDownload(): Promise<UpdateState>;
  updateInstall(): Promise<void>;

  automationState(): Promise<AutomationState>;
  watchAdd(cfg: Omit<WatchConfig, 'id'>): Promise<AutomationState>;
  watchUpdate(id: string, patch: Partial<WatchConfig>): Promise<AutomationState>;
  watchRemove(id: string): Promise<AutomationState>;
  /** Sends what differs between a watch's paths and its destinations now (or runs its sync job). */
  watchRunNow(id: string): Promise<void>;
  automationPause(paused: boolean): Promise<AutomationState>;
  scheduleRunNow(jobId: string): Promise<void>;
  /** A test message to the webhook / Telegram chat in the settings; per channel 'ok' or the error. */
  notifyTest(): Promise<{ webhook?: string; telegram?: string }>;

  windowControl(action: 'minimize' | 'maximize' | 'close' | 'devtools' | 'reload'): Promise<void>;
  /** Native theme + title bar overlay colours, so the window buttons match the app theme; zoom is the UI scale (1 = 100%). */
  setChrome(opts: { theme: ThemePref; bg: string; fg: string; zoom?: number }): Promise<void>;
  /** An error the window caught (a page that failed to render): goes to the log so it ends up in the diagnostics folder. */
  clientError(message: string): Promise<void>;
}

export type ApiMethod = keyof Api;

/** The only methods the renderer may call (the main process and the web bridge check against it). */
export const API_METHODS = {
  bootstrap: true,
  saveConfig: true,
  readConfigFile: true,
  configText: true,
  saveConfigText: true,
  exportConfig: true,
  pickSave: true,
  useConfigFile: true,
  saveSettings: true,
  setSecret: true,
  probe: true,
  describeSources: true,
  mapPath: true,
  planSend: true,
  writePack: true,
  cancelTask: true,
  executePlan: true,
  cancelRun: true,
  pauseRun: true,
  cancelRunTarget: true,
  compareWithTarget: true,
  runs: true,
  run: true,
  deleteRun: true,
  clearRuns: true,
  exportRunCsv: true,
  gitRepos: true,
  gitAddRepo: true,
  gitRemoveRepo: true,
  gitStatus: true,
  gitLog: true,
  gitBranches: true,
  gitCommitChanges: true,
  gitSources: true,
  gitDiff: true,
  compareJob: true,
  syncRun: true,
  syncItemDiff: true,
  resetSyncState: true,
  exportSyncJob: true,
  importSyncJob: true,
  browse: true,
  findBackups: true,
  backupSets: true,
  browseBackup: true,
  restore: true,
  restoreRun: true,
  diffNodes: true,
  findWizardState: true,
  importWizardState: true,
  pick: true,
  openPath: true,
  showInFolder: true,
  openExternal: true,
  openLog: true,
  exportDiagnostics: true,
  whatsNew: true,
  assistantStatus: true,
  assistantSetKey: true,
  assistantAsk: true,
  statFile: true,
  integrationStatus: true,
  integrationSet: true,
  updateState: true,
  updateCheck: true,
  updateDownload: true,
  updateInstall: true,
  automationState: true,
  watchAdd: true,
  watchUpdate: true,
  watchRemove: true,
  watchRunNow: true,
  automationPause: true,
  speedTest: true,
  relayState: true,
  discoverHosts: true,
  listDir: true,
  webUiState: true,
  webUiConfigure: true,
  inventory: true,
  scheduleRunNow: true,
  notifyTest: true,
  windowControl: true,
  setChrome: true,
  clientError: true,
} satisfies Record<ApiMethod, true>;

export function isApiMethod(m: string): m is ApiMethod {
  return Object.prototype.hasOwnProperty.call(API_METHODS, m);
}
