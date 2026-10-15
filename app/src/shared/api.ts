import type {
  AppConfig,
  BackupLookup,
  BackupSet,
  Bootstrap,
  CompareResult,
  DiffResult,
  GitChange,
  GitDiffSpec,
  GitLogPage,
  GitRepoInfo,
  LocalIdentity,
  LocalSettings,
  ProbeResult,
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
  useConfigFile(path: string | null): Promise<Bootstrap>;
  saveSettings(patch: Partial<LocalSettings>): Promise<LocalSettings>;
  setSecret(nodeId: string, secret: string | null): Promise<boolean>;

  probe(nodeIds?: string[]): Promise<ProbeResult[]>;
  describeSources(paths: string[], count?: boolean): Promise<SourceInfo[]>;
  mapPath(abs: string): Promise<{ rel: string; root?: string; outside: boolean }>;

  planSend(req: SendRequest, taskId: string): Promise<SendPlan>;
  cancelTask(taskId: string): Promise<void>;
  /** `selected`: target id -> ids of the plan operations to run. */
  executePlan(planId: string, selected: Record<string, string[]>, overrides?: { dryRun?: boolean; remember?: boolean }): Promise<string>;
  cancelRun(runId: string): Promise<void>;
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
  browse(endpoint: { kind: 'local'; path: string } | { kind: 'node'; nodeId: string; subPath: string }, rel: string): Promise<BrowseEntry[]>;

  findBackups(rel: string, targetIds: string[]): Promise<BackupLookup[]>;
  backupSets(targetIds: string[]): Promise<BackupSet[]>;
  browseBackup(targetId: string, stamp: string, relDir: string): Promise<BrowseEntry[]>;
  restore(rel: string, picks: { targetId: string; stamp: string }[], backupCurrent: boolean): Promise<string>;

  pick(opts: PickOptions): Promise<string[]>;
  openPath(p: string): Promise<void>;
  showInFolder(p: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openLog(): Promise<void>;
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
  automationPause(paused: boolean): Promise<AutomationState>;
  scheduleRunNow(jobId: string): Promise<void>;

  windowControl(action: 'minimize' | 'maximize' | 'close' | 'devtools' | 'reload'): Promise<void>;
  /** Native theme + title bar overlay colours, so the window buttons match the app theme. */
  setChrome(opts: { theme: ThemePref; bg: string; fg: string }): Promise<void>;
}

export type ApiMethod = keyof Api;

/** The only methods the renderer may call (the main process and the web bridge check against it). */
export const API_METHODS = {
  bootstrap: true,
  saveConfig: true,
  readConfigFile: true,
  useConfigFile: true,
  saveSettings: true,
  setSecret: true,
  probe: true,
  describeSources: true,
  mapPath: true,
  planSend: true,
  cancelTask: true,
  executePlan: true,
  cancelRun: true,
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
  browse: true,
  findBackups: true,
  backupSets: true,
  browseBackup: true,
  restore: true,
  pick: true,
  openPath: true,
  showInFolder: true,
  openExternal: true,
  openLog: true,
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
  automationPause: true,
  scheduleRunNow: true,
  windowControl: true,
  setChrome: true,
} satisfies Record<ApiMethod, true>;

export function isApiMethod(m: string): m is ApiMethod {
  return Object.prototype.hasOwnProperty.call(API_METHODS, m);
}
