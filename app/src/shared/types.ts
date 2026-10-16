// Types shared by the core (Node), the Electron main process and the renderer.
// Relative paths ("rel") are always POSIX style ("Data/x.entity") regardless of platform.

export type Platform = 'win32' | 'darwin' | 'linux' | string;

export type TransportKind = 'smb' | 'path' | 'sftp';

export interface SftpConfig {
  host?: string; // defaults to node.address
  port?: number; // 22
  username: string;
  privateKeyPath?: string;
  useAgent?: boolean;
  /** Has a password been saved (encrypted, local only) for this node? */
  hasPassword?: boolean;
  /** Absolute remote root, e.g. /srv/sim/ActiveRelease */
  root: string;
}

export interface NodeConfig {
  id: string;
  name: string;
  group?: string;
  address: string;
  localNames?: string[];
  localRoots: string[];
  /** Share relative root: "Sim\\ActiveRelease" -> \\address\Sim\ActiveRelease */
  networkRoot: string;
  enabled: boolean;
  transport?: TransportKind;
  /** Explicit target root for the "path" transport (local folder, mounted share, UNC). */
  path?: string;
  sftp?: SftpConfig;
  color?: string;
  notes?: string;
  /**
   * This machine passes sends on to the other machines of its group: a send that includes it and them
   * writes to it only, and SamSync running there sends the files on over the group's own network.
   */
  relay?: boolean;
}

export type CompareMethod = 'timeSize' | 'content' | 'size';
export type SendMode = 'overwrite' | 'update' | 'mirror';

export interface CopySettings {
  retryCount: number;
  waitSeconds: number;
  parallelTargets: number;
  parallelFiles: number;
  backupKeep: number;
  backupFolderName: string;
  verify: boolean;
  timeToleranceSec: number;
  ignoreDstShift: boolean;
  /** How long a relay may take to pick a job up before the sender gives up on it (and sends directly). */
  relayAckSeconds?: number;
  /** How long a relay may take to finish a job. */
  relayTimeoutMinutes?: number;
  postCommand?: string;
  postCommandTimeoutSeconds: number;
  /** Upper bound per transfer in MB/s (0 = unlimited), like robocopy /IPG in the PowerShell tool. */
  bandwidthMBps: number;
  excludeFiles: string[];
  excludeDirs: string[];
}

/** One target's exceptions to the send options, like the per machine columns of the old wizard. */
export interface TargetOptions {
  mode?: SendMode;
  backup?: boolean;
}

export interface SendOptions {
  mode: SendMode;
  compare: CompareMethod;
  backup: boolean;
  dryRun: boolean;
  verify: boolean;
  excludeFiles: string[];
  excludeDirs: string[];
  parallelTargets: number;
  /** Git: delete on targets the files that were deleted in the selected changes. */
  propagateDeletes: boolean;
  runPostCommand: boolean;
  notify: boolean;
  /** Per target (node id) mode and backup that differ from the ones above. */
  perTarget?: Record<string, TargetOptions>;
}

export interface Profile {
  id: string;
  name: string;
  targetIds: string[];
  options?: Partial<SendOptions>;
  icon?: string;
}

export type SyncVariant = 'twoWay' | 'mirror' | 'update' | 'custom';
export type Category = 'leftOnly' | 'rightOnly' | 'leftNewer' | 'rightNewer' | 'different' | 'equal' | 'conflict';
export type SyncAction = 'copyRight' | 'copyLeft' | 'deleteLeft' | 'deleteRight' | 'none';

export type CustomActions = Record<Exclude<Category, 'equal' | 'conflict'>, SyncAction>;

export type Endpoint =
  | { kind: 'local'; path: string }
  | { kind: 'node'; nodeId: string; subPath: string };

export interface SyncPair {
  id: string;
  left: Endpoint;
  right: Endpoint;
}

export interface SyncFilter {
  include: string[];
  exclude: string[];
  minSizeKb?: number;
  maxSizeKb?: number;
  /** Only items modified in the last N days. */
  newerThanDays?: number;
}

/** recycle: a local folder side uses the operating system's trash, any other side the versioning folder. */
export type DeletionPolicy = 'versioning' | 'permanent' | 'recycle';

export interface SyncSchedule {
  enabled: boolean;
  mode: 'interval' | 'times';
  everyMinutes: number;
  /** "HH:mm" in local time, for mode 'times'. */
  times: string[];
  /** Run only on this machine (node id). The config is shared, so without it every machine would run the job. */
  machineId?: string;
  notify: 'always' | 'changes' | 'errors';
}

export interface SyncJob {
  id: string;
  name: string;
  schedule?: SyncSchedule;
  pairs: SyncPair[];
  compare: CompareMethod;
  variant: SyncVariant;
  custom?: CustomActions;
  filter: SyncFilter;
  deletion: DeletionPolicy;
  versioningKeep: number;
  /** Versions older than this many days are removed after a run (0 or empty = no age limit). */
  versioningMaxDays?: number;
  detectMoves?: boolean;
  lastRun?: string;
}

export type UpdateSource = 'github' | 'url' | 'folder' | 'off';

export interface UpdateConfig {
  source: UpdateSource;
  /** Generic HTTP(S) feed: the folder that holds latest.yml and the installers. */
  url?: string;
  /** Shared folder (\\server\share\SamSync) that holds latest.yml and the installers. */
  folder?: string;
}

export interface AppConfig {
  /** Schema marker. The legacy "version" string (PowerShell tool version) is left untouched on save. */
  schema: 2;
  title?: string;
  nodes: NodeConfig[];
  copy: CopySettings;
  profiles: Profile[];
  syncJobs: SyncJob[];
  update?: UpdateConfig;
  /** Machines in the Explorer menu: auto (while they fit), always, never. Shared with the PowerShell tool. */
  menuShowNodes?: 'auto' | 'always' | 'never';
  /** Notepad++ shortcuts by menu entry id, e.g. { "wizard:last": "Ctrl+Alt+W" }. Shared with the PowerShell tool. */
  notepadPlusPlusShortcuts?: Record<string, string>;
  /** Per platform template for the SMB transport root. Placeholders: {address} {networkRoot} {share} {rest} {id} */
  smbPathTemplate?: Partial<Record<'win32' | 'darwin' | 'linux', string>>;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type { Lang, LangPref } from './i18n/types';
import type { Lang, LangPref } from './i18n/types';
import type { IntegrationStatus } from './api';

export interface LocalSettings {
  configPath?: string;
  theme: ThemePref;
  accent: string;
  /** UI language; "system" follows the computer's display language. */
  language: LangPref;
  /** Pin this machine to a node id (overrides auto detection). */
  localNodeId?: string;
  recentRepos: string[];
  lastTargets: string[];
  lastOptions?: Partial<SendOptions>;
  sendDefaults?: Partial<SendOptions>;
  density: 'comfortable' | 'compact';
  gitLogPageSize: number;
  probeIntervalSec: number;
  confirmBeforeRun: boolean;
  closeRunPanelOnSuccess: boolean;
  updateAutoCheck: boolean;
  updateAutoDownload: boolean;
  /** Folder watches that send changes automatically (this machine only). */
  watches: WatchConfig[];
  /** Last run time of scheduled sync jobs on this machine (job id -> ms). */
  scheduleRuns: Record<string, number>;
  automationPaused: boolean;
  automation?: AutomationSettings;
  closeToTray: boolean;
  launchAtLogin: boolean;
  /** Explorer right-click menu (Windows); on in the installed app unless turned off. */
  explorerMenu?: boolean;
  /** Notepad++ tab menu and Run commands (Windows, when Notepad++ is installed); on in the installed app unless turned off. */
  notepadPlusPlus?: boolean;
  /** When the old wizard's profiles and last selection were imported, and from which file. */
  wizardImport?: { at: number; file: string };
  /** Saved sends, run with one click from the Send page, the tray, the command palette or `--quick <name>`. */
  quickSends?: QuickSend[];
}

/** What the import of the old wizard's state did. */
export interface WizardImportResult {
  file: string;
  /** The config path the imported entry was saved for. */
  configKey: string;
  lastTargets: string[];
  profilesAdded: string[];
  /** Profiles with a name that already exists here; they are left as they are. */
  profilesSkipped: string[];
  /** Machine ids in the file that this config does not have. */
  unknownTargets: string[];
  /** The profiles could not be saved (a read-only shared config, for instance). */
  profilesError?: string;
  settings: LocalSettings;
  config: AppConfig;
}

/** HEAD moves of a Git repository that can start an automatic send (read from the reflog). */
export type GitEvent = 'commit' | 'amend' | 'merge' | 'pull' | 'rebase' | 'pick' | 'reset' | 'checkout';

export interface WatchConfig {
  id: string;
  name: string;
  paths: string[];
  /** Machines from the configuration. */
  targetIds: string[];
  /** Plain folders (local, mounted or UNC), no configuration needed: each watched folder's content goes into them. */
  folders?: string[];
  /** Run this sync job on a change instead of sending (live sync). */
  syncJobId?: string;
  /** files (default): what changed on disk. git: what a commit, pull… changed in the repository paths[0]. */
  trigger?: 'files' | 'git';
  /** For trigger git; default commit, amend, merge and pull. */
  gitEvents?: GitEvent[];
  /** Send the differences that already exist when the watch starts. */
  syncOnStart?: boolean;
  options: SendOptions;
  /** Quiet period before a batch of changes is sent. */
  quietMs: number;
  enabled: boolean;
}

/** How automatic sends behave on this machine (Automation → Settings). */
export interface AutomationSettings {
  /** Unreachable targets keep their changes and get them again later. Off by default. */
  retryUnreachable: boolean;
  retryEveryMinutes: number;
  /** Desktop notification after automatic sends and scheduled syncs. */
  notify: 'never' | 'errors' | 'always';
  /** A watch that sees more changed files than this at once does not send them (0 = no limit). */
  maxFilesPerSend: number;
  /** A scheduled time that passed while the app was closed runs at start. */
  catchUpSchedules: boolean;
}

export type WatchStatus = 'watching' | 'pending' | 'sending' | 'paused' | 'error';

export interface WatchState {
  id: string;
  name: string;
  paths: string[];
  targetIds: string[];
  enabled: boolean;
  status: WatchStatus;
  pendingFiles: number;
  /** Targets that were unreachable and get their changes again later (retry on). */
  deferredTargets: string[];
  /** Targets the last send could not reach (retry off: they miss these changes). */
  unreachableTargets?: string[];
  trigger?: WatchConfig['trigger'];
  folders?: string[];
  syncJobId?: string;
  lastRunAt?: number;
  lastRunId?: string;
  lastStatus?: RunStatus | 'nothing';
  lastSummary?: string;
  sentFiles: number;
  runs: number;
  error?: string;
}

export interface ScheduleState {
  jobId: string;
  name: string;
  enabled: boolean;
  activeHere: boolean;
  reason?: string;
  running: boolean;
  nextAt?: number;
  lastAt?: number;
  lastStatus?: RunStatus | 'nothing';
  lastSummary?: string;
}

export interface AutomationState {
  paused: boolean;
  watches: WatchState[];
  schedules: ScheduleState[];
}

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'unsupported';

export interface UpdateState {
  phase: UpdatePhase;
  source: UpdateSource;
  currentVersion: string;
  version?: string;
  releaseDate?: string;
  notes?: string;
  percent?: number;
  bytesPerSecond?: number;
  error?: string;
  checkedAt?: number;
  detail?: string;
}

export interface LocalIdentity {
  node: NodeConfig | null;
  reason: string;
  method: 'override' | 'env' | 'ip' | 'name' | 'root' | 'none' | 'ambiguous';
  candidates: string[];
  hostname: string;
  addresses: string[];
}

/** What a launch from Explorer, Notepad++ or the command line asks for. */
export interface OpenRequest {
  paths: string[];
  /** --to: node ids, group:<name>, profile:<name or id>, all, or last (the last send's targets and options). */
  targets?: string[];
  /** --yes: send at once without the review (the one-click menu entries). */
  send?: boolean;
  /** --restore: show the backups of these items. */
  restore?: boolean;
  /** A quick send: its options and name come along. */
  options?: Partial<SendOptions>;
  label?: string;
}

/** A saved send: sources, targets and options under a name, run with one click (this machine only). */
export interface QuickSend {
  id: string;
  name: string;
  paths: string[];
  targetIds: string[];
  options?: Partial<SendOptions>;
  /** Open the review instead of sending at once. */
  review?: boolean;
  /** A system-wide key (Electron accelerator, e.g. "Ctrl+Alt+1") that runs it from anywhere. */
  hotkey?: string;
}

export interface Bootstrap {
  appVersion: string;
  platform: Platform;
  hostname: string;
  config: AppConfig;
  configPath: string;
  configWritable: boolean;
  configError?: string;
  settings: LocalSettings;
  identity: LocalIdentity;
  initialPaths: string[];
  /** --to group:Unit1,IG2 on the command line: preselect targets and open the review. */
  initialTargets: string[];
  userDataPath: string;
  isElectron: boolean;
  /** The computer's language, used when settings.language is "system". */
  systemLang: Lang;
  gitAvailable: boolean;
  gitVersion?: string;
  /** The GitHub repository the installed app updates from (https://github.com/owner/repo), when known. */
  repositoryUrl?: string;
}

export interface ProbeResult {
  nodeId: string;
  ok: boolean;
  latencyMs?: number;
  detail: string;
  root: string;
  checkedAt: number;
  /** For a machine marked as relay: whether SamSync there wrote its heartbeat lately, and when. */
  relayAlive?: boolean;
  relaySeenAt?: number;
}

/** A quick measurement of the link to a machine: a few MB written and read back. */
export interface SpeedTestResult {
  nodeId: string;
  /** Bytes used for the test. */
  bytes: number;
  writeMBps: number;
  readMBps: number;
  /** One small round trip (a stat of the root). */
  latencyMs: number;
  at: number;
}

/** What the relay service on this machine is doing (shown on this machine's card). */
export interface RelayState {
  /** SamSync here is the relay of its group. */
  active: boolean;
  group?: string;
  dir?: string;
  /** Jobs taken since the app started, and the last one. */
  jobs: number;
  lastJobAt?: number;
  lastOk?: boolean;
  lastLabel?: string;
}

// ---------------------------------------------------------------- sources & plans

export type SourceSpec =
  | { kind: 'fs'; path: string }
  | { kind: 'git'; repo: string; rev: string; path: string }
  | { kind: 'delete'; path: string };

export interface SourceInfo {
  path: string;
  exists: boolean;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  fileCount?: number;
  /** The folder was too large to count completely. */
  fileCountCapped?: boolean;
  /** Target relative path computed from the local roots. */
  rel: string;
  root?: string;
  outsideRoots: boolean;
  error?: string;
}

export interface SendRequest {
  sources: SourceSpec[];
  targetIds: string[];
  options: SendOptions;
  label?: string;
  origin: 'send' | 'git' | 'restore' | 'sync';
  /** Look at and write to every machine from here, even where a relay would take over (comparisons, checks). */
  direct?: boolean;
}

export type PlanCategory = 'new' | 'changed' | 'targetNewer' | 'extra' | 'deleted' | 'same';

export type SrcRef =
  | { kind: 'fs'; abs: string }
  | { kind: 'git'; repo: string; rev: string; path: string; blob?: string }
  | { kind: 'endpoint'; key: string; rel: string }
  /** A member of a pack file a sender left on this machine (the relay side). */
  | { kind: 'pack'; file: string; offset: number; length: number; method: 'gzip' | 'store' };

export interface PlanOp {
  id: string;
  kind: 'copy' | 'delete' | 'mkdir';
  rel: string;
  isDir: boolean;
  category: PlanCategory;
  src?: SrcRef;
  size: number;
  srcMtime?: number;
  dstMtime?: number;
  dstSize?: number;
  selected: boolean;
  sourceIndex: number;
  note?: string;
  /** The target holds a folder where a file goes (or the reverse); it is removed first. */
  replaceType?: boolean;
}

export type CategoryCounts = Record<PlanCategory, number>;

export interface TargetPlan {
  targetId: string;
  targetName: string;
  root: string;
  /** Mode and backup in effect on this target (the send options with this target's exceptions). */
  mode: SendMode;
  backup: boolean;
  reachable: boolean;
  /** The target answered, but reading it failed part way (the error says why). */
  failed?: boolean;
  error?: string;
  ops: PlanOp[];
  counts: CategoryCounts;
  bytes: number;
  freeBytes?: number;
  truncated?: boolean;
  /** The files reach this target through that relay machine (no plan of its own: the relay compares and sends). */
  via?: string;
  /** This machine is marked as relay but no SamSync answers there (stale heartbeat): it is written to directly. */
  relayDown?: boolean;
  /** Someone else is writing to this machine right now (a fresh lock from another computer). */
  lock?: { host: string; user: string; label: string; startedAt: number };
  /** The target's folders came from its manifest (written then) after a check, not from a walk over the network. */
  fromManifest?: number;
}

export interface SendPlan {
  id: string;
  createdAt: number;
  request: SendRequest;
  targets: TargetPlan[];
  sources: SourceInfo[];
  warnings: string[];
  durationMs: number;
}

// ---------------------------------------------------------------- runs

export type RunStatus = 'running' | 'ok' | 'failed' | 'partial' | 'cancelled';

export interface RunTargetState {
  key: string;
  title: string;
  root: string;
  total: number;
  done: number;
  failed: number;
  bytesTotal: number;
  bytesDone: number;
  current?: string;
  status: 'queued' | RunStatus;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  backupPath?: string;
  /** The files went through that relay machine. */
  via?: string;
  /** The relay never picked the job up (SamSync not running there): the sender may send directly instead. */
  relayUnanswered?: boolean;
}

export interface RunOpResult {
  key: string;
  opId: string;
  rel: string;
  kind: PlanOp['kind'];
  ok: boolean;
  error?: string;
  backedUp?: boolean;
}

export interface RunLogLine {
  t: number;
  level: 'info' | 'warn' | 'error' | 'ok';
  key?: string;
  message: string;
}

export interface RunSummary {
  id: string;
  label: string;
  origin: SendRequest['origin'];
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  dryRun: boolean;
  targets: RunTargetState[];
  opsTotal: number;
  opsOk: number;
  opsFailed: number;
  bytes: number;
  sources: string[];
  targetIds: string[];
  options?: Partial<SendOptions>;
}

export interface RunDetail extends RunSummary {
  results: RunOpResult[];
  log: RunLogLine[];
}

export type AppEvent =
  | { type: 'run-start'; run: RunSummary }
  | { type: 'run-progress'; runId: string; targets: RunTargetState[] }
  | { type: 'run-log'; runId: string; lines: RunLogLine[] }
  | { type: 'run-done'; run: RunSummary }
  | { type: 'task-progress'; taskId: string; message: string; done?: number; total?: number }
  | { type: 'open'; request: OpenRequest }
  | { type: 'integration'; status: IntegrationStatus }
  | { type: 'config-changed'; config: AppConfig }
  | { type: 'probe'; results: ProbeResult[] }
  | { type: 'relay'; state: RelayState }
  | { type: 'update'; state: UpdateState }
  | { type: 'automation'; state: AutomationState };

// ---------------------------------------------------------------- git

export interface GitRepoInfo {
  root: string;
  name: string;
  branch: string;
  head: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  dirty: number;
}

export type GitChangeKind = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';

export interface GitChange {
  path: string;
  oldPath?: string;
  kind: GitChangeKind;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  additions?: number;
  deletions?: number;
  binary?: boolean;
  /** Commits (short sha) among the selection that touched this file. */
  commits?: string[];
}

export interface GitCommit {
  sha: string;
  short: string;
  author: string;
  email: string;
  date: number;
  subject: string;
  body?: string;
  parents: string[];
  refs: string[];
}

export interface GitLogPage {
  commits: GitCommit[];
  hasMore: boolean;
}

export interface GitDiffSpec {
  repo: string;
  path: string;
  oldPath?: string;
  /** 'worktree' = HEAD..working tree, otherwise a commit range */
  mode: 'worktree' | 'commits';
  shas?: string[];
}

export interface DiffLine {
  t: 'ctx' | 'add' | 'del' | 'hunk' | 'skip';
  a?: number;
  b?: number;
  text: string;
}

export interface DiffResult {
  ok: boolean;
  binary?: boolean;
  tooLarge?: boolean;
  identical?: boolean;
  reason?: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  leftLabel?: string;
  rightLabel?: string;
  leftInfo?: { size: number; mtimeMs?: number; exists: boolean };
  rightInfo?: { size: number; mtimeMs?: number; exists: boolean };
}

// ---------------------------------------------------------------- folder compare / sync

export interface FileMeta {
  size: number;
  mtimeMs: number;
  isDir: boolean;
}

export interface CompareItem {
  key: string;
  rel: string;
  isDir: boolean;
  left?: FileMeta;
  right?: FileMeta;
  category: Category;
  action: SyncAction;
  defaultAction: SyncAction;
  conflict?: string;
}

export interface PairResult {
  pairId: string;
  leftLabel: string;
  rightLabel: string;
  leftOk: boolean;
  rightOk: boolean;
  error?: string;
  items: CompareItem[];
}

export interface CompareStats {
  byCategory: Record<Category, number>;
  byAction: Record<SyncAction, number>;
  bytesToCopy: number;
}

export interface CompareResult {
  id: string;
  jobId: string;
  createdAt: number;
  durationMs: number;
  pairs: PairResult[];
  stats: CompareStats;
}

// ---------------------------------------------------------------- backups

export interface BackupVersion {
  stamp: string;
  /** The backup folder at the target root: the configured one, or an older one found next to it. */
  folder: string;
  date: number;
  size: number;
  isDir: boolean;
}

export interface BackupLookup {
  targetId: string;
  targetName: string;
  reachable: boolean;
  error?: string;
  rel: string;
  versions: BackupVersion[];
  current?: { size: number; mtimeMs: number; isDir: boolean } | null;
}

export interface BackupSet {
  targetId: string;
  stamps: { stamp: string; date: number; folder: string }[];
}
