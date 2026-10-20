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
  /** Absolute remote root, e.g. /srv/release */
  root: string;
}

export interface NodeConfig {
  id: string;
  name: string;
  group?: string;
  address: string;
  localNames?: string[];
  localRoots: string[];
  /** Share relative root: "Share\\Release" -> \\address\Share\Release */
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
/** How a source outside every local root lands on the targets: by its own folder (default) or with its full path. */
export type OutsideRoots = 'own' | 'fullPath';
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
  /** A relay keeps the jobs of a machine that is off and tries it again this often (minutes; 0 = no queue). */
  relayQueueMinutes?: number;
  /** Queued jobs older than this are dropped. */
  relayQueueDays?: number;
  /** A manifest SamSync left on a target stands in for a walk over the network for this many days (0 = always walk). */
  manifestMaxDays?: number;
  postCommand?: string;
  postCommandTimeoutSeconds: number;
  /** Upper bound per transfer in MB/s (0 = unlimited), like robocopy /IPG in the PowerShell tool. */
  bandwidthMBps: number;
  excludeFiles: string[];
  excludeDirs: string[];
  /** Sources outside every local root: their own folder stands for the target root (default), or the full path is kept. */
  outsideRoots?: OutsideRoots;
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
  /** Walk every target folder over the network instead of trusting the manifest SamSync left there. */
  fullScan?: boolean;
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
/** keepBoth: a conflict resolved by giving each side the other's version next to its own ("name (sol).ext"). */
export type SyncAction = 'copyRight' | 'copyLeft' | 'deleteLeft' | 'deleteRight' | 'keepBoth' | 'none';

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
  /** UI scale in percent (100 = normal); Ctrl + / − / 0 change it. */
  uiScale?: number;
  gitLogPageSize: number;
  probeIntervalSec: number;
  confirmBeforeRun: boolean;
  closeRunPanelOnSuccess: boolean;
  /** A short sound when a run ends: never, only when something failed, or always (dry runs stay silent). */
  finishSound?: 'never' | 'errors' | 'always';
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
  /** The version whose "what's new" card was shown (or that was installed first). */
  lastSeenVersion?: string;
  /** Webhook / Telegram reports of finished runs. */
  notifications?: NotificationSettings;
  /** Server mode: this copy serves its window to browsers on the network (changed only through webUiConfigure). */
  webUi?: WebUiSettings;
}

export interface WebUiSettings {
  enabled: boolean;
  port: number;
  /** Reachable from the network (0.0.0.0) or from this computer only (127.0.0.1). */
  lan: boolean;
  /** scrypt hash of the password; never sent to a window (the settings it gets say hasPassword instead). */
  passwordHash?: string;
  hasPassword?: boolean;
}

export interface WebUiState {
  /** Server mode exists here (the desktop app); a browser or the development preview cannot serve. */
  available: boolean;
  enabled: boolean;
  running: boolean;
  port: number;
  lan: boolean;
  hasPassword: boolean;
  /** Where browsers reach it. */
  urls: string[];
  clients: number;
  sessions: number;
  error?: string;
}

/** One folder of this computer, for the file picker of a browser (server mode). */
export interface DirListing {
  /** null: the list of drives (Windows) or the root. */
  path: string | null;
  parent: string | null;
  entries: { name: string; path: string; isDir: boolean; size: number; mtimeMs: number }[];
  error?: string;
}

/** The help bot's conversation with Claude (the optional cloud half). */
export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  text: string;
  model: string;
  /** What the call cost in tokens, for the log line. */
  usage: { input: number; output: number; cached: number };
}

export interface AssistantStatus {
  /** A Claude API key is set on this machine. */
  configured: boolean;
  model: string;
}

/** One version's section of the changelog, for the card after an update. */
export interface ChangelogSection {
  version: string;
  date?: string;
  /** The section's bullet items, markdown as written (bold and code spans). */
  items: string[];
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
  /** Target paths picked by hand for some of the paths (a source outside every local root), by path. */
  rels?: Record<string, string>;
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
  /** Target paths picked by hand for some of the paths (a quick send brings them), by path. */
  rels?: Record<string, string>;
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
  /** Target paths picked by hand for some of the paths, by path. */
  rels?: Record<string, string>;
  targetIds: string[];
  options?: Partial<SendOptions>;
  /** Open the review instead of sending at once. */
  review?: boolean;
  /** A system-wide key (Electron accelerator, e.g. "Ctrl+Alt+1") that runs it from anywhere. */
  hotkey?: string;
  /** Runs by itself at these times (this machine only, like the rest of the quick send). */
  schedule?: SyncSchedule;
}

/** Where a finished run is reported besides the desktop notification (this machine's settings). */
export interface NotificationSettings {
  /** Any HTTP endpoint that takes a JSON POST (a Teams/Slack workflow, a script of your own). */
  webhookUrl?: string;
  telegramToken?: string;
  telegramChatId?: string;
  onSuccess: boolean;
  onFailure: boolean;
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
  /** --to group:Lab-A,PC2 on the command line: preselect targets and open the review. */
  initialTargets: string[];
  userDataPath: string;
  isElectron: boolean;
  /** The computer's language, used when settings.language is "system". */
  systemLang: Lang;
  gitAvailable: boolean;
  gitVersion?: string;
  /** The GitHub repository the installed app updates from (https://github.com/owner/repo), when known. */
  repositoryUrl?: string;
  /** This window is a browser on another computer (server mode): dialogs, opening files and window control are not here. */
  remote?: boolean;
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

/** A machine the network scan found: what answered, its name when it has one, and the node it already is. */
export interface DiscoveredHost {
  address: string;
  hostname?: string;
  /** 445 (file sharing) and/or 22 (SSH). */
  ports: number[];
  /** Disk shares seen on it (Windows only; undefined when not asked, empty when none could be listed). */
  shares?: string[];
  nodeId?: string;
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
  /** Machines that were off when a job came: their jobs wait here until they answer. */
  pending?: RelayPending[];
}

/** One machine in a relay's delivery queue. */
export interface RelayPending {
  targetId: string;
  name: string;
  jobs: number;
  since: number;
  attempts: number;
  lastTry?: number;
  lastError?: string;
}

/** What a machine holds under one sent folder, as its manifest says (the last send or pack that reached it). */
export interface InventoryEntry {
  rel: string;
  label?: string;
  writtenAt: number;
  by?: { host?: string; user?: string; version?: string };
  files: number;
  dirs: number;
  size: number;
}

/** One machine in the inventory: its manifest read now, or why it could not be. */
export interface InventoryRow {
  nodeId: string;
  name: string;
  group?: string;
  reachable: boolean;
  error?: string;
  /** No manifest yet: nothing was ever sent there with this version, or the file was removed. */
  manifest: boolean;
  entries: InventoryEntry[];
  checkedAt: number;
}

// ---------------------------------------------------------------- sources & plans

/** `rel`: where the item goes on the targets, picked by hand; without it the local roots decide. */
export type SourceSpec =
  | { kind: 'fs'; path: string; rel?: string }
  | { kind: 'git'; repo: string; rev: string; path: string }
  | { kind: 'delete'; path: string; rel?: string };

/** A place a source outside every local root can take on the targets. */
export interface SourcePlace {
  rel: string;
  /** The local folder that stands for the target root. */
  base?: string;
  /** The whole path with the drive as a folder (the old way). */
  full?: boolean;
  /** Its path below this local root (the place a source under a root gets by default). */
  root?: string;
}

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
  /** Outside every root: the local folder that stands for the target root, or the full path is kept. */
  base?: string;
  full?: boolean;
  /** Where else it can go (the Send page offers these, and a path typed by hand). */
  places?: SourcePlace[];
  /** Where it goes when no place is picked by hand. */
  defaultRel?: string;
  error?: string;
  /** The source is a pack file (.samsync-pack): what it carries and where it was made. */
  pack?: { label: string; createdAt: number; from: string; files: number; size: number; subtrees: string[]; encrypted?: boolean };
  /** A password-protected pack that is still closed: no password yet, or a wrong one. */
  locked?: 'password' | 'wrong';
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

/** How far the review has got on one target (the planning window lists them while it works). */
export interface PlanTargetProgress {
  id: string;
  name: string;
  phase: 'wait' | 'probe' | 'scan' | 'compare' | 'done' | 'failed';
  /** Entries listed on the target so far (its folders are walked over the network). */
  listed?: number;
  /** Source files looked at so far, out of all of them. */
  done: number;
  total: number;
  /** Bytes read for comparisons by content so far, both sides together. */
  read?: number;
}

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
  /** This machine itself: written on its own disk, in its first local root (shown as `root`). */
  self?: boolean;
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

/** What writing a pack file produced. */
export interface PackWriteResult {
  file: string;
  files: number;
  /** Original bytes, and the pack's size on disk. */
  size: number;
  packed: number;
  warnings: string[];
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
  /** The machine was off: the relay queued the job and delivers it when the machine answers again. */
  deferred?: boolean;
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
  /** Where the sources outside every local root went on the targets, by path. */
  sourceRels?: Record<string, string>;
  targetIds: string[];
  options?: Partial<SendOptions>;
  /** The run is held (Pause in the run panel); its targets keep their state until it is resumed. */
  paused?: boolean;
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
  | { type: 'run-paused'; runId: string; paused: boolean }
  | { type: 'task-progress'; taskId: string; message: string; done?: number; total?: number; targets?: PlanTargetProgress[] }
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
