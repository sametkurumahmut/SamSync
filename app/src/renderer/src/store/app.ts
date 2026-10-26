import { create } from 'zustand';
import type {
  AppConfig,
  AssistantStatus,
  ChangelogSection,
  AppEvent,
  Bootstrap,
  LocalSettings,
  ProbeResult,
  QuickSend,
  RelayState,
  PendingSend,
  StagedSend,
  ScheduledSend,
  RunLogLine,
  RunSummary,
  RunTargetState,
  SendOptions,
  SendPlan,
  SendRequest,
  SyncSchedule,
  SourceInfo,
  SourceSpec,
  PlanTargetProgress,
  UpdateState,
  AutomationState,
  OpenRequest,
} from '@shared/types';
import type { IntegrationStatus } from '@shared/api';
import { api, newTaskId, onEvent } from '../lib/api';
import { readStored, writeStored } from '../lib/persist';
import { playFinishSound } from '../lib/sounds';
import { fsSources, pathWithin, relsFor, samePath } from '@shared/sources';
import { pushSample, type Sample } from '../lib/rates';
import { APP_PAGES, type AppPage } from '@shared/pages';
import { answer, type HelpHit } from '@shared/help/search';
import { helpIndex, helpLang } from '../lib/help';
import { offlineReply } from '../components/HelpBot';
import { bytes as bytesText } from '../lib/format';
import { resolveLang, setLang, systemLang, t, type Lang } from '@shared/i18n';
import { DEFAULT_SEND_OPTIONS, baseSendOptions } from '@shared/options';
import { machineTitle } from '@shared/machine';
import { askConfirm } from '../components/ConfirmDialog';

export type Page = AppPage;

/** How many probes a machine's latency chart keeps. */
const LATENCY_KEEP = 48;

/** One line of the notification centre (the bell in the title bar). */
export interface Notice {
  id: string;
  at: number;
  kind: 'run' | 'machine' | 'update' | 'automation' | 'relay';
  level: 'ok' | 'warn' | 'error' | 'info';
  title: string;
  detail?: string;
  /** Where a click goes. */
  page?: Page;
  runId?: string;
  read: boolean;
  /** The same thing is not listed twice within an hour (a machine flapping, the same update seen again). */
  key?: string;
}
const NOTICE_KEEP = 100;
const NOTICE_DEDUPE_MS = 60 * 60_000;
let noticeSeq = Date.now();

/** New probe results into the store: the latest per machine, and its latency history (-1 for no answer). */
function mergeProbes(s: Pick<State, 'probes' | 'latency'>, results: ProbeResult[]): Pick<State, 'probes' | 'latency'> {
  const probes = { ...s.probes };
  const latency = { ...s.latency };
  for (const r of results) {
    const prev = probes[r.nodeId];
    probes[r.nodeId] = r;
    // the same result arriving twice (the renderer asked and the main process pushed) counts once
    if (prev && prev.checkedAt === r.checkedAt) continue;
    const list = latency[r.nodeId] ? [...latency[r.nodeId]] : [];
    list.push(r.ok ? (r.latencyMs ?? 0) : -1);
    latency[r.nodeId] = list.length > LATENCY_KEEP ? list.slice(-LATENCY_KEEP) : list;
  }
  return { probes, latency };
}
export const PAGES: Page[] = APP_PAGES;

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info' | 'warn';
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
}

/** A tab on the Send page: its own sources and targets. A right-click launch opens a new one. */
export interface Workspace {
  id: string;
  name: string;
  /** Kept for inactive tabs; the active tab's live values are sendPaths, sendRels and targets. */
  paths: string[];
  /** Target paths picked by hand (sources outside every local root), by path. */
  rels?: Record<string, string>;
  /** Sources kept in the list but left out of the send. */
  off?: string[];
  targets: string[];
  /** The list's own send options; without them the list uses the general ones. Kept for inactive tabs (the active tab's are in options). */
  options?: SendOptions;
}

export interface LiveRun {
  summary: RunSummary;
  targets: RunTargetState[];
  log: RunLogLine[];
  done: boolean;
  /** Held by the user; the panel shows Resume instead of Pause. */
  paused?: boolean;

  /** Bytes done over time (all targets together), for the throughput chart. */
  samples: Sample[];
}

export interface Review {
  plan: SendPlan;
  selected: Record<string, Set<string>>;
  /** A staged send: these machines first, the rest once they went through (by themselves with auto). */
  stages?: { first: string[]; auto: boolean };
}

export const DEFAULT_OPTIONS: SendOptions = DEFAULT_SEND_OPTIONS;

interface State {
  boot: Bootstrap | null;
  bootError?: string;
  page: Page;
  collapsed: boolean;
  dark: boolean;
  probes: Record<string, ProbeResult>;
  /** The last probes per machine, newest last: the latency in ms, or -1 when it did not answer (the small chart on its card). */
  latency: Record<string, number[]>;
  /** The notification centre: what happened, newest first; kept in this window's storage. */
  notices: Notice[];
  noticesOpen: boolean;
  addNotice(n: Omit<Notice, 'id' | 'at' | 'read'> & { at?: number; read?: boolean }): void;
  markNoticesRead(): void;
  clearNotices(): void;
  /** A run the History page should open when it loads (a click in the notification centre). */
  openRunId?: string;
  /** What the relay service on this machine is doing, when this machine is a relay. */
  relayState?: RelayState;
  /** Sends waiting on this computer for machines that were off. */
  pendingSends: PendingSend[];
  /** Staged sends by the run id of their first stage. */
  staged: Record<string, StagedSend>;
  /** Sends set for a time of their own (Send later). */
  scheduledSends: ScheduledSend[];
  probing: boolean;
  update: UpdateState | null;
  automation: AutomationState | null;
  toasts: Toast[];
  palette: boolean;
  /** The keyboard shortcuts list is open. */
  shortcuts: boolean;
  /** The "what's new" card for the version that just started. */
  whatsNew: ChangelogSection | null;
  /** The help bot drawer and its conversation (this window only). */
  helpBot: boolean;
  helpMessages: HelpMessage[];
  helpBusy: boolean;
  /** Ask Claude instead of the offline search (only when a key is set). */
  helpAi: boolean;
  assistant: AssistantStatus | null;
  askHelp(question: string): Promise<void>;
  setHelpAi(on: boolean): void;
  /** UI language in effect; App re-mounts when it changes so every t() runs again. */
  lang: Lang;
  /** Explorer menu and Notepad++ integration (Windows). */
  integration: IntegrationStatus | null;
  /** Forms with unsaved edits (key -> what it is); leaving the page or closing the app asks first. */
  unsaved: Record<string, string>;
  setUnsaved(key: string, label: string | null): void;
  /** "Restore from backup" from the Explorer or Notepad++ menu: the Backups page takes these items. */
  restoreRequest: { paths: string[]; seq: number } | null;

  sendPaths: string[];
  /** Where some of sendPaths go on the targets, picked by hand on the Send page (sources outside every local root). */
  sendRels: Record<string, string>;
  /** Sources kept in the list but turned off: they are not sent, compared, packed or watched. */
  sendOff: string[];
  sendInfos: SourceInfo[];
  targets: string[];
  workspaces: Workspace[];
  activeWorkspace: string;
  /** force: a new tab even when the open one is empty. */
  newWorkspace(opts?: { name?: string; paths?: string[]; rels?: Record<string, string>; targets?: string[]; force?: boolean; options?: Partial<SendOptions> }): Promise<void>;
  switchWorkspace(id: string): Promise<void>;
  closeWorkspace(id: string): Promise<void>;
  renameWorkspace(id: string, name: string): void;
  /** The options the Send page uses now: the active list's own ones, or the general ones. */
  options: SendOptions;
  /** The general options: every list without options of its own uses them (kept as lastOptions). */
  generalOptions: SendOptions;
  /** The active list has options of its own. */
  ownOptions: boolean;
  setOwnOptions(on: boolean): void;
  /** Back to the general options (the list keeps options of its own) or to the defaults from Settings. */
  resetOptions(to: 'general' | 'defaults'): void;

  planning: { taskId: string; message: string; done?: number; total?: number; targets?: PlanTargetProgress[] } | null;
  /** The downloaded update is offered for installing (the title-bar pill or Settings opened the dialog). */
  updatePrompt: boolean;
  review: Review | null;

  runs: Record<string, LiveRun>;
  activeRunId?: string;
  runPanel: boolean;
  historyVersion: number;

  init(): Promise<void>;
  setPage(p: Page): void;
  toggleSidebar(): void;
  toast(kind: Toast['kind'], title: string, message?: string, action?: Toast['action']): void;
  dismissToast(id: number): void;
  applyTheme(): void;
  probe(ids?: string[]): Promise<void>;

  /** `rels`: target paths picked earlier for some of them (a quick send, a run sent again). */
  addSendPaths(paths: string[], rels?: Record<string, string>): Promise<void>;
  /** Places a source outside every local root on the targets (null: back to the default place). */
  setSendRel(path: string, rel: string | null): Promise<void>;
  /** The Send page's list as send sources (the ones turned on), with the places picked by hand. */
  sendSources(): SourceSpec[];
  /** The sources that are turned on, in list order. */
  enabledSendPaths(): string[];
  /** Turns sources on or off without taking them out of the list. */
  setSendEnabled(paths: string[], on: boolean): void;
  removeSendPaths(paths: string[]): void;
  /** Adds a folder to this machine's local roots; the sources below it then follow it on their own. */
  addLocalRoot(folder: string): Promise<void>;
  /** Saved sends: run one, save the current list under a name, remove one. */
  runQuickSend(q: QuickSend): void;
  /** Saves the current list under a name, or (with `editId`) renames / reschedules an existing one, keeping its list. */
  saveQuickSend(name: string, review: boolean, hotkey?: string, schedule?: SyncSchedule, editId?: string): Promise<void>;
  removeQuickSend(id: string): Promise<void>;
  removeSendPath(p: string): void;
  clearSendPaths(): void;
  setTargets(ids: string[]): void;
  setOptions(patch: Partial<SendOptions>): void;

  startPlan(req: Omit<SendRequest, 'targetIds' | 'options'> & { targetIds?: string[]; options?: Partial<SendOptions> }): Promise<void>;
  cancelPlan(): void;
  /** Writes the Send list to a pack file in a folder the user picks (a release that travels on a disk). */
  writePack(password?: string, since?: { pack?: string; targetId?: string }): Promise<void>;
  /** Opens a password-protected pack among the sources; 'wrong' when the password does not fit. */
  unlockPack(path: string, password: string): Promise<'ok' | 'wrong'>;
  closeReview(): void;
  setReviewSelection(targetId: string, ids: Set<string>): void;
  setReviewStages(stages: Review['stages']): void;
  executeReview(dryRun?: boolean): Promise<void>;
  watchRun(runId: string): void;

  saveConfig(cfg: AppConfig): Promise<boolean>;
  saveSettings(patch: Partial<LocalSettings>): Promise<void>;
  setBoot(b: Bootstrap): void;
}

/** One line of the help bot's conversation. */
export interface HelpMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  /** The entry or README section the answer came from, and more that matched. */
  source?: HelpHit;
  hits?: HelpHit[];
  /** The search was not sure (the answer is a guess) or found nothing. */
  unsure?: boolean;
  /** Answered by Claude. */
  ai?: boolean;
  error?: string;
}

/** The UI scale steps Ctrl + / − walk through (percent). */
export const UI_SCALES = [70, 80, 90, 100, 110, 125, 150, 175];
export const uiScaleOf = (s?: { uiScale?: number } | null) => {
  const v = Number(s?.uiScale);
  return Number.isFinite(v) && v >= 50 && v <= 250 ? Math.round(v) : 100;
};
/** The next step up or down from the current scale, or 100 for a reset. */
export function stepUiScale(current: number, dir: 1 | -1 | 0): number {
  if (dir === 0) return 100;
  const next = dir > 0 ? UI_SCALES.find((v) => v > current) : [...UI_SCALES].reverse().find((v) => v < current);
  return next ?? current;
}

let toastSeq = 1;
let lastProbe = 0;
let optionsSaveTimer: ReturnType<typeof setTimeout> | null = null;
const media = window.matchMedia('(prefers-color-scheme: dark)');
// until the settings arrive, guess from the browser so the first screen is already in the right language
const firstLang = systemLang([...navigator.languages]);
setLang(firstLang);
document.documentElement.lang = firstLang;

export const useApp = create<State>((set, get) => ({
  boot: null,
  page: initialPage(),
  collapsed: localStorage.getItem('samsync.collapsed') === '1',
  dark: true,
  probes: {},
  latency: {},
  notices: readStored<Notice[]>('samsync.notices', []),
  noticesOpen: false,
  addNotice(n) {
    set((s) => {
      const now = n.at ?? Date.now();
      if (n.key && s.notices.some((x) => x.key === n.key && now - x.at < NOTICE_DEDUPE_MS)) return {};
      const notice: Notice = { ...n, id: `n${++noticeSeq}`, at: now, read: n.read ?? false };
      const notices = [notice, ...s.notices].slice(0, NOTICE_KEEP);
      writeStored('samsync.notices', notices);
      return { notices };
    });
  },
  markNoticesRead() {
    set((s) => {
      if (!s.notices.some((x) => !x.read)) return {};
      const notices = s.notices.map((x) => (x.read ? x : { ...x, read: true }));
      writeStored('samsync.notices', notices);
      return { notices };
    });
  },
  clearNotices() {
    writeStored('samsync.notices', null);
    set({ notices: [] });
  },
  probing: false,
  pendingSends: [],
  staged: {},
  scheduledSends: [],
  update: null,
  automation: null,
  toasts: [],
  palette: false,
  shortcuts: false,
  whatsNew: null,
  helpBot: false,
  helpMessages: [],
  helpBusy: false,
  helpAi: readStored<boolean>('samsync.help.ai', true),
  assistant: null,
  lang: firstLang,
  integration: null,
  restoreRequest: null,
  unsaved: {},
  setUnsaved(key, label) {
    const cur = get().unsaved;
    if ((cur[key] ?? null) === label) return;
    const next = { ...cur };
    if (label) next[key] = label;
    else delete next[key];
    set({ unsaved: next });
  },
  sendPaths: [],
  sendRels: {},
  sendOff: [],
  sendInfos: [],
  targets: [],
  workspaces: [{ id: 'w1', name: '', paths: [], targets: [] }],
  activeWorkspace: 'w1',
  options: DEFAULT_OPTIONS,
  generalOptions: DEFAULT_OPTIONS,
  ownOptions: false,
  planning: null,
  updatePrompt: false,
  review: null,
  runs: {},
  runPanel: false,
  historyVersion: 0,

  async init() {
    onEvent((e) => handleEvent(e));
    // closing the window with unsaved edits asks (Electron shows its own dialog for this)
    window.addEventListener('beforeunload', (e) => {
      if (Object.keys(get().unsaved).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    media.addEventListener('change', () => get().applyTheme());
    window.addEventListener('hashchange', () => {
      const p = location.hash.replace('#', '') as Page;
      if (p && p !== get().page && PAGES.includes(p)) set({ page: p });
    });
    try {
      const boot = await api.bootstrap();
      const s = boot.settings;
      const options: SendOptions = { ...baseOptions(boot), ...(s.lastOptions ?? {}), dryRun: false };
      const known = new Set(boot.config.nodes.map((n) => n.id));
      // the Send tabs come back with their sources and targets, even if nothing was sent
      const tabs = readStored<{ active: string; list: Workspace[] } | null>('samsync.workspaces', null);
      const active = tabs?.list.find((w) => w.id === tabs.active) ?? tabs?.list[0];
      const targets = active?.targets ?? s.lastTargets;
      // a list that came back with options of its own starts with them
      const own = active?.options ? { ...options, ...active.options, dryRun: false } : null;
      set({ boot, options: own ?? options, generalOptions: options, ownOptions: !!own, targets: targets.filter((id) => known.has(id)), ...(tabs && active ? { workspaces: tabs.list, activeWorkspace: active.id } : {}) });
      void api.relayState().then((relayState) => set({ relayState })).catch(() => undefined);
      void api.pendingSends().then((pendingSends) => set({ pendingSends })).catch(() => undefined);
      void api.scheduledSends().then((scheduledSends) => set({ scheduledSends })).catch(() => undefined);
      get().applyTheme();
      // the web preview passes SAMSYNC_PATHS here; Electron sends its launches as 'open' events
      if (boot.initialPaths.length) pendingOpen.unshift({ paths: boot.initialPaths, targets: boot.initialTargets.length ? boot.initialTargets : undefined });
      if (active?.paths.length) {
        set({ sendOff: active.off ?? [] });
        await get().addSendPaths(active.paths, active.rels);
      }
      for (const r of pendingOpen.splice(0)) await handleOpen(r);
      void get().probe();
      // keep the reachability dots fresh while the window is in use
      setInterval(() => {
        const st = get();
        const every = (st.boot?.settings.probeIntervalSec ?? 45) * 1000;
        if (document.visibilityState === 'visible' && !st.probing && Date.now() - lastProbe >= every) void st.probe();
      }, 5000);
      void api.updateState().then((u) => set({ update: u }));
      void api.whatsNew().then((w) => w && set({ whatsNew: w })).catch(() => undefined);
      void api.assistantStatus().then((assistant) => set({ assistant })).catch(() => undefined);
      void api.automationState().then((a) => set({ automation: a }));
    } catch (e) {
      set({ bootError: (e as Error).message });
    }
  },

  async setPage(p) {
    const open = Object.values(get().unsaved);
    if (p !== get().page && open.length && !(await askConfirm(t('Kaydedilmemiş değişiklikler var: {what}. Sayfadan çıkılsın mı? Bu değişiklikler kaybolur.', { what: open.join(', ') }), { danger: true }))) return;
    location.hash = p;
    set({ page: p });
    writeStored('samsync.page', p);
  },

  toggleSidebar() {
    const c = !get().collapsed;
    localStorage.setItem('samsync.collapsed', c ? '1' : '0');
    set({ collapsed: c });
  },

  toast(kind, title, message, action) {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, title, message, action }].slice(-5) }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },

  applyTheme() {
    const s = get().boot?.settings;
    const pref = s?.theme ?? 'dark';
    const dark = pref === 'dark' || (pref === 'system' && media.matches);
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.density = s?.density ?? 'comfortable';
    const accent = s?.accent || '#2f7cf6';
    root.style.setProperty('--accent', accent);
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(accent);
    if (m) root.style.setProperty('--accent-rgb', `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`);
    set({ dark });
    const zoom = uiScaleOf(s) / 100;
    // Electron scales the whole page (the title bar overlay follows in the main process); the web preview uses CSS zoom
    if (!window.samsync) root.style.zoom = zoom === 1 ? '' : String(zoom);
    const cs = getComputedStyle(root);
    void api.setChrome({ theme: pref, bg: cs.getPropertyValue('--bg').trim() || (dark ? '#0c0e13' : '#f4f5f8'), fg: dark ? '#c9ced8' : '#3b414d', zoom }).catch(() => undefined);
  },

  async probe(ids) {
    if (!ids) lastProbe = Date.now();
    set({ probing: true });
    try {
      const res = await api.probe(ids);
      const before = get().probes;
      set((s) => mergeProbes(s, res));
      probeNotices(before, res);
    } catch (e) {
      get().toast('error', t('Erişim yoklaması başarısız'), (e as Error).message);
    } finally {
      set({ probing: false });
    }
  },

  async addSendPaths(paths, rels) {
    const cur = get().sendPaths;
    const lower = new Set(cur.map((p) => p.toLowerCase()));
    const add = paths.filter((p) => !lower.has(p.toLowerCase()));
    if (!add.length) return;
    const next = [...cur, ...add];
    const picked = relsFor(add, rels);
    const nextRels = picked ? { ...get().sendRels, ...picked } : get().sendRels;
    set({ sendPaths: next, sendRels: nextRels });
    // only the new ones are read (a big folder is counted once, not again with every addition); the rows wait meanwhile
    try {
      const infos = await api.describeSources(add, true, undefined, nextRels);
      set((s) => ({ sendInfos: mergeInfos(s.sendInfos, infos, s.sendPaths) }));
    } catch (e) {
      get().toast('error', t('Kaynaklar okunamadı'), (e as Error).message);
    }
  },
  async setSendRel(path, rel) {
    const st = get();
    const key = st.sendPaths.find((p) => p === path) ?? st.sendPaths.find((p) => p.toLowerCase() === path.toLowerCase()) ?? path;
    const rels = { ...st.sendRels };
    if (rel === null) delete rels[key];
    else rels[key] = rel;
    set({ sendRels: rels });
    try {
      const [info] = await api.describeSources([key], true, undefined, rels);
      set((s) => ({ sendInfos: s.sendInfos.map((i) => (i.path === info.path || i.path === key ? info : i)) }));
    } catch (e) {
      st.toast('error', t('Hedef yolu değiştirilemedi'), (e as Error).message);
    }
  },
  sendSources() {
    const st = get();
    return fsSources(st.enabledSendPaths(), st.sendRels);
  },
  enabledSendPaths() {
    const st = get();
    return st.sendOff.length ? st.sendPaths.filter((p) => !st.sendOff.some((o) => samePath(o, p))) : st.sendPaths;
  },
  setSendEnabled(paths, on) {
    set((s) => {
      const rest = s.sendOff.filter((o) => !paths.some((p) => samePath(o, p)));
      return { sendOff: on ? rest : [...rest, ...paths] };
    });
  },
  removeSendPaths(paths) {
    set((s) => {
      const gone = (p: string) => paths.some((x) => samePath(x, p));
      return {
        sendPaths: s.sendPaths.filter((p) => !gone(p)),
        sendRels: Object.fromEntries(Object.entries(s.sendRels).filter(([p]) => !gone(p))),
        sendOff: s.sendOff.filter((p) => !gone(p)),
        sendInfos: s.sendInfos.filter((i) => !gone(i.path)),
      };
    });
  },
  async addLocalRoot(folder) {
    const st = get();
    const boot = st.boot!;
    const id = boot.identity.node?.id;
    if (!id) {
      st.toast('warn', t('Bu bilgisayar yapılandırmada yok'), t('Yerel kök eklemek için bu bilgisayar Hedefler sayfasında bir makine olarak tanımlı olmalı.'));
      return;
    }
    const cfg = { ...boot.config, nodes: boot.config.nodes.map((n) => (n.id === id && !n.localRoots.some((r) => samePath(r, folder)) ? { ...n, localRoots: [...n.localRoots, folder] } : n)) };
    if (!(await st.saveConfig(cfg))) return;
    // what is below the new root follows it now; the places picked by hand there are dropped
    const rels = Object.fromEntries(Object.entries(get().sendRels).filter(([p]) => !pathWithin(p, folder)));
    set({ sendRels: rels });
    const paths = get().sendPaths;
    const infos = await api.describeSources(paths, true, undefined, rels);
    set((s) => ({ sendInfos: mergeInfos(s.sendInfos, infos, s.sendPaths) }));
    st.toast('ok', t('Yerel kök eklendi'), t('{path} artık bu makinenin yerel kökü; içindekiler hedeflerde aynı göreli yolla yer alır.', { path: folder }));
  },
  runQuickSend(q) {
    void handleOpen({ paths: q.paths, rels: q.rels, targets: q.targetIds, send: !q.review, options: q.options, label: q.name });
  },
  async saveQuickSend(name, review, hotkey, schedule, editId) {
    const st = get();
    const { dryRun: _d, ...options } = st.options;
    const all = st.boot?.settings.quickSends ?? [];
    const old = editId ? all.find((q) => q.id === editId) : undefined;
    const existing = all.filter((q) => q.id !== editId && q.name.toLowerCase() !== name.toLowerCase());
    const q: QuickSend = old
      ? { ...old, name, review, hotkey: hotkey?.trim() || undefined, schedule }
      : { id: `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, paths: [...st.enabledSendPaths()], rels: relsFor(st.enabledSendPaths(), st.sendRels), targetIds: [...st.targets], options, review, hotkey: hotkey?.trim() || undefined, schedule };
    await st.saveSettings({ quickSends: [...existing, q] });
    st.toast('ok', old ? t('Hızlı gönderim güncellendi') : t('Hızlı gönderim kaydedildi'), t('{name}: {n} kaynak → {targets} hedef', { name, n: q.paths.length, targets: q.targetIds.length }));
  },
  async removeQuickSend(id) {
    const st = get();
    await st.saveSettings({ quickSends: (st.boot?.settings.quickSends ?? []).filter((q) => q.id !== id) });
  },
  removeSendPath(p) {
    get().removeSendPaths([p]);
  },
  clearSendPaths() {
    set({ sendPaths: [], sendRels: {}, sendOff: [], sendInfos: [] });
  },
  async newWorkspace(opts = {}) {
    const st = get();
    const cur = st.workspaces.find((w) => w.id === st.activeWorkspace);
    // an empty tab is used as it is instead of piling up empty ones
    if (cur && !st.sendPaths.length && !opts.force) {
      set({ workspaces: st.workspaces.map((w) => (w.id === cur.id ? { ...w, name: opts.name ?? w.name } : w)), targets: opts.targets ?? st.targets, ...(opts.options ? { options: { ...st.generalOptions, ...opts.options, dryRun: false }, ownOptions: true } : {}) });
      if (opts.paths?.length) await get().addSendPaths(opts.paths, opts.rels);
      return;
    }
    const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const kept = st.workspaces.map((w) => (w.id === st.activeWorkspace ? { ...w, paths: st.sendPaths, rels: relsFor(st.sendPaths, st.sendRels), off: st.sendOff.length ? st.sendOff : undefined, targets: st.targets, options: ownOf(st) } : w));
    const targets = opts.targets ?? st.targets;
    // a new list uses the general options unless it brings its own (a quick send, a profile from the command line)
    const own = opts.options ? { ...st.generalOptions, ...opts.options, dryRun: false } : null;
    set({ workspaces: [...kept, { id, name: opts.name ?? '', paths: [], targets }], activeWorkspace: id, sendPaths: [], sendRels: {}, sendOff: [], sendInfos: [], targets, options: own ?? st.generalOptions, ownOptions: !!own });
    if (opts.paths?.length) await get().addSendPaths(opts.paths, opts.rels);
  },
  async switchWorkspace(id) {
    const st = get();
    if (id === st.activeWorkspace) return;
    const next = st.workspaces.find((w) => w.id === id);
    if (!next) return;
    const kept = st.workspaces.map((w) => (w.id === st.activeWorkspace ? { ...w, paths: st.sendPaths, rels: relsFor(st.sendPaths, st.sendRels), off: st.sendOff.length ? st.sendOff : undefined, targets: st.targets, options: ownOf(st) } : w));
    set({ workspaces: kept, activeWorkspace: id, sendPaths: [], sendRels: {}, sendOff: next.off ?? [], sendInfos: [], targets: next.targets, options: next.options ? { ...st.generalOptions, ...next.options, dryRun: false } : st.generalOptions, ownOptions: !!next.options });
    await get().addSendPaths(next.paths, next.rels);
  },
  async closeWorkspace(id) {
    const st = get();
    if (st.workspaces.length === 1) {
      set({ sendPaths: [], sendRels: {}, sendOff: [], sendInfos: [], options: st.generalOptions, ownOptions: false, workspaces: st.workspaces.map((w) => ({ ...w, name: '', paths: [], rels: undefined, off: undefined, options: undefined })) });
      return;
    }
    const i = st.workspaces.findIndex((w) => w.id === id);
    if (id === st.activeWorkspace) await get().switchWorkspace(st.workspaces[i + 1]?.id ?? st.workspaces[i - 1].id);
    set((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) }));
  },
  renameWorkspace(id, name) {
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() } : w)) }));
  },
  setTargets(ids) {
    set({ targets: ids });
  },
  setOwnOptions(on) {
    const st = get();
    if (on === st.ownOptions) return;
    // on: the list starts from the general options as they are; off: it uses the general ones again
    set(on ? { ownOptions: true } : { ownOptions: false, options: { ...st.generalOptions, dryRun: st.options.dryRun } });
  },
  resetOptions(to) {
    const st = get();
    if (to === 'general') return set({ options: { ...st.generalOptions, dryRun: false } });
    if (!st.boot) return;
    const d: SendOptions = { ...baseOptions(st.boot), dryRun: false };
    if (st.ownOptions) return set({ options: d });
    set({ options: d, generalOptions: d });
    const { dryRun: _d, ...rest } = d;
    void st.saveSettings({ lastOptions: rest });
  },
  setOptions(patch) {
    const options = { ...get().options, ...patch };
    // a list with options of its own keeps the change to itself (saved with the tabs); otherwise it is the general one
    if (get().ownOptions) return set({ options });
    set({ options, generalOptions: options });
    if (optionsSaveTimer) clearTimeout(optionsSaveTimer);
    optionsSaveTimer = setTimeout(() => {
      const { dryRun: _d, ...rest } = get().options;
      void get().saveSettings({ lastOptions: rest });
    }, 800);
  },

  async startPlan(req) {
    const taskId = newTaskId();
    const st = get();
    const full: SendRequest = {
      ...req,
      targetIds: req.targetIds ?? st.targets,
      options: { ...st.options, ...(req.options ?? {}) },
    };
    if (!full.targetIds.length) {
      st.toast('warn', t('Hedef seçilmedi'), t('Göndermek için en az bir makine seçin.'));
      return;
    }
    if (!full.sources.length) {
      st.toast('warn', t('Kaynak yok'), t('Gönderilecek dosya veya klasör seçin.'));
      return;
    }
    set({ planning: { taskId, message: t('Hazırlanıyor…') } });
    try {
      const plan = await api.planSend(full, taskId);
      if (get().planning?.taskId !== taskId) return; // cancelled
      const selected: Record<string, Set<string>> = {};
      for (const tp of plan.targets) selected[tp.targetId] = new Set(tp.ops.filter((o) => o.selected).map((o) => o.id));
      set({ review: { plan, selected }, planning: null });
    } catch (e) {
      set({ planning: null });
      if (!(e as Error).message.includes(t('İptal edildi'))) st.toast('error', t('İnceleme başarısız'), (e as Error).message);
    }
  },
  setHelpAi(on) {
    writeStored('samsync.help.ai', on);
    set({ helpAi: on });
  },
  async askHelp(question) {
    const q = question.trim();
    if (!q || get().helpBusy) return;
    const lang = helpLang();
    const user: HelpMessage = { id: `u${Date.now().toString(36)}`, role: 'user', text: q };
    set((s) => ({ helpMessages: [...s.helpMessages, user], helpBusy: true, helpBot: true }));
    const st = get();
    const useAi = st.helpAi && !!st.assistant?.configured;
    const offline = answer(helpIndex(lang), q);
    let reply: HelpMessage;
    if (useAi && offline.intent === 'question') {
      try {
        const turns = [...st.helpMessages, user].slice(-10).map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.text }));
        const r = await api.assistantAsk(turns, lang);
        // the offline search still supplies the page to open and the related entries
        reply = { id: `b${Date.now().toString(36)}`, role: 'bot', text: r.text, ai: true, source: offline.confidence !== 'none' ? offline.hits[0] : undefined, hits: offline.hits.slice(offline.confidence !== 'none' ? 1 : 0, 3) };
      } catch (e) {
        const o = offlineReply(offline, lang);
        reply = { id: `b${Date.now().toString(36)}`, role: 'bot', ...o, error: t('Claude yanıt veremedi ({error}); çevrimdışı yanıt gösteriliyor.', { error: (e as Error).message }) };
      }
    } else {
      reply = { id: `b${Date.now().toString(36)}`, role: 'bot', ...offlineReply(offline, lang) };
    }
    set((s) => ({ helpMessages: [...s.helpMessages, reply].slice(-60), helpBusy: false }));
  },
  async unlockPack(path, password) {
    const [info] = await api.describeSources([path], true, { [path]: password });
    set((s) => ({ sendInfos: s.sendInfos.map((i) => (i.path === info.path || i.path === path ? info : i)) }));
    return info.locked ? 'wrong' : 'ok';
  },
  async writePack(password, since) {
    const st = get();
    if (!st.enabledSendPaths().length) return st.toast('warn', t('Kaynak yok'), t('Pakete yazılacak dosya veya klasör seçin.'));
    const [dir] = await api.pick({ folders: true, title: t('Paket nereye yazılsın?') });
    if (!dir) return;
    const taskId = newTaskId();
    const label = st.sendPaths.length === 1 ? st.sendPaths[0].replace(/[\\/]+$/, '').split(/[\\/]/).pop() || t('Gönderim') : t('{n} öğe', { n: st.sendPaths.length });
    const req: SendRequest = { sources: st.sendSources(), targetIds: [], options: { ...st.options, dryRun: false }, origin: 'send', label };
    set({ planning: { taskId, message: t('Paket hazırlanıyor…') } });
    try {
      const r = await api.writePack(req, dir, taskId, password, since);
      set({ planning: null });
      for (const w of r.warnings) get().toast('warn', t('Paket'), w);
      const skipped = r.skipped ? ` • ${t('{n} dosya hedefte zaten var sayıldı', { n: r.skipped })}` : '';
      get().toast('ok', t('Paket yazıldı'), `${t('{n} dosya', { n: r.files })} • ${t('{size} → {packed}', { size: bytesText(r.size), packed: bytesText(r.packed) })}${skipped}`, { label: t('Klasörde göster'), run: () => void api.showInFolder(r.file) });
    } catch (e) {
      set({ planning: null });
      if (!(e as Error).message.includes(t('İptal edildi'))) get().toast('error', t('Paket yazılamadı'), (e as Error).message);
    }
  },
  cancelPlan() {
    const p = get().planning;
    if (p) void api.cancelTask(p.taskId);
    set({ planning: null });
  },
  closeReview() {
    set({ review: null });
  },
  setReviewSelection(targetId, ids) {
    const r = get().review;
    if (!r) return;
    set({ review: { ...r, selected: { ...r.selected, [targetId]: ids } } });
  },
  setReviewStages(stages) {
    const r = get().review;
    if (r) set({ review: { ...r, stages } });
  },
  async executeReview(dryRun) {
    const r = get().review;
    if (!r) return;
    const selected: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(r.selected)) selected[k] = [...v];
    // mirror deletes on the targets: ask once more, with the total, before anything is written
    const mirrors = r.plan.targets.filter((tp) => tp.mode === 'mirror');
    const deletes = mirrors.reduce((n, tp) => n + tp.ops.filter((o) => o.kind === 'delete' && r.selected[tp.targetId]?.has(o.id)).length, 0);
    const dry = dryRun ?? r.plan.request.options.dryRun;
    if (deletes && !dry && !(await askConfirm(t('Ayna kipi hedeflerde toplam {n} öğe silecek. Gönderim sürsün mü?', { n: deletes }), { danger: true }))) return;
    try {
      const runId = await api.executePlan(r.plan.id, selected, { ...(dryRun != null ? { dryRun } : {}), ...(r.stages?.first.length && !dry ? { stages: r.stages } : {}) });
      set({ review: null });
      get().watchRun(runId);
    } catch (e) {
      get().toast('error', t('Gönderim başlatılamadı'), (e as Error).message);
    }
  },
  watchRun(runId) {
    set({ activeRunId: runId, runPanel: true });
  },

  async saveConfig(cfg) {
    try {
      const r = await api.saveConfig(cfg);
      const boot = get().boot!;
      set({ boot: { ...boot, config: r.config, identity: r.identity, configError: undefined } });
      return true;
    } catch (e) {
      get().toast('error', t('Yapılandırma kaydedilemedi'), (e as Error).message);
      return false;
    }
  },
  async saveSettings(patch) {
    const settings = await api.saveSettings(patch);
    const boot = get().boot;
    if (boot) set({ boot: { ...boot, settings } });
    if ('theme' in patch || 'accent' in patch || 'density' in patch || 'uiScale' in patch) get().applyTheme();
    if ('localNodeId' in patch) {
      const b = await api.bootstrap();
      set({ boot: { ...b, initialPaths: [] } });
    }
  },
  setBoot(b) {
    set({ boot: b });
    get().applyTheme();
  },
}));

/** Source rows as the Send page lists them: the fresh ones replace the old, in the list's order, gone ones dropped. */
function mergeInfos(cur: SourceInfo[], fresh: SourceInfo[], order: string[]): SourceInfo[] {
  const at = (p: string) => order.findIndex((o) => samePath(o, p));
  const all = [...cur.filter((i) => !fresh.some((f) => samePath(f.path, i.path))), ...fresh];
  return all.filter((i) => at(i.path) >= 0).sort((a, b) => at(a.path) - at(b.path));
}

// a development run can reach the store from the page (the web preview, a screenshot script): never in a packaged build
if (import.meta.env.DEV) (window as unknown as { __samsync?: typeof useApp }).__samsync = useApp;

useApp.subscribe((s, prev) => {
  if (!s.boot || (s.sendPaths === prev.sendPaths && s.sendRels === prev.sendRels && s.sendOff === prev.sendOff && s.targets === prev.targets && s.workspaces === prev.workspaces && s.activeWorkspace === prev.activeWorkspace && s.options === prev.options && s.ownOptions === prev.ownOptions)) return;
  const list = s.workspaces.map((w) => (w.id === s.activeWorkspace ? { ...w, paths: s.sendPaths, rels: relsFor(s.sendPaths, s.sendRels), off: s.sendOff.length ? s.sendOff : undefined, targets: s.targets, options: ownOf(s) } : w));
  writeStored('samsync.workspaces', { active: s.activeWorkspace, list });
});

useApp.subscribe((s) => {
  if (!s.boot) return;
  const lang = resolveLang(s.boot.settings.language, s.boot.systemLang);
  if (lang === s.lang) return;
  setLang(lang);
  document.documentElement.lang = lang;
  useApp.setState({ lang });
});

const MAX_LOG = 4000;

function handleEvent(e: AppEvent) {
  const st = useApp.getState();
  switch (e.type) {
    case 'relay':
      useApp.setState({ relayState: e.state });
      break;
    case 'pending-sends':
      useApp.setState({ pendingSends: e.items });
      break;
    case 'scheduled-sends':
      useApp.setState({ scheduledSends: e.items });
      break;
    case 'staged':
      useApp.setState((s) => ({ staged: { ...s.staged, [e.state.runId]: e.state } }));
      // the second stage started by itself: the run panel follows it
      if (e.state.status === 'continued' && e.state.nextRunId && st.activeRunId === e.state.runId) st.watchRun(e.state.nextRunId);
      break;
    case 'run-start':
      useApp.setState((s) => ({ runs: { ...s.runs, [e.run.id]: { summary: e.run, targets: e.run.targets, log: [], done: false, paused: e.run.paused, samples: [{ t: Date.now(), b: 0 }] } } }));
      break;
    case 'run-paused':
      useApp.setState((s) => {
        const r = s.runs[e.runId];
        return r ? { runs: { ...s.runs, [e.runId]: { ...r, paused: e.paused } } } : {};
      });
      break;
    case 'run-progress':
      useApp.setState((s) => {
        const r = s.runs[e.runId];
        if (!r) return {};
        let b = 0;
        for (const x of e.targets) b += x.bytesDone;
        return { runs: { ...s.runs, [e.runId]: { ...r, targets: e.targets, samples: pushSample(r.samples, { t: Date.now(), b }) } } };
      });
      break;
    case 'run-log':
      useApp.setState((s) => {
        const r = s.runs[e.runId];
        if (!r) return {};
        const log = [...r.log, ...e.lines];
        return { runs: { ...s.runs, [e.runId]: { ...r, log: log.length > MAX_LOG ? log.slice(-MAX_LOG) : log } } };
      });
      break;
    case 'history-changed':
      useApp.setState((s) => ({ historyVersion: s.historyVersion + 1 }));
      break;
    case 'run-done': {
      useApp.setState((s) => {
        const r = s.runs[e.run.id];
        return {
          historyVersion: s.historyVersion + 1,
          runs: { ...s.runs, [e.run.id]: { summary: e.run, targets: e.run.targets, log: r?.log ?? [], done: true, samples: r?.samples ?? [] } },
        };
      });
      const r = e.run;
      // every finished run is listed; only the ones that went wrong wait as unread
      st.addNotice({
        kind: 'run',
        level: r.status === 'ok' ? 'ok' : r.status === 'cancelled' ? 'warn' : 'error',
        title: r.status === 'ok' ? (r.dryRun ? t('{label}: deneme tamamlandı', { label: r.label }) : t('{label} tamamlandı', { label: r.label })) : r.status === 'cancelled' ? t('{label} iptal edildi', { label: r.label }) : r.status === 'partial' ? t('{label} kısmen başarılı', { label: r.label }) : t('{label} başarısız', { label: r.label }),
        detail: `${t('{ok} başarılı, {failed} hatalı', { ok: r.opsOk, failed: r.opsFailed })} • ${t('{n} hedef', { n: r.targets.length })}`,
        page: 'history',
        runId: r.id,
        read: r.status === 'ok',
      });
      // a sound says how it ended, so the window can stay in the background; a dry run and a cancel stay silent
      const sound = st.boot?.settings.finishSound ?? 'always';
      if (!r.dryRun && r.status !== 'cancelled' && sound !== 'never' && (sound === 'always' || r.status !== 'ok')) playFinishSound(r.status === 'ok' ? 'ok' : 'error');
      if (r.status === 'ok') {
        st.toast('ok', r.dryRun ? t('Deneme tamamlandı') : t('Gönderim tamamlandı'), `${t('{n} işlem', { n: r.opsOk })} • ${t('{n} hedef', { n: r.targets.length })}`);
        if (st.boot?.settings.closeRunPanelOnSuccess && st.activeRunId === r.id) useApp.setState({ runPanel: false });
      } else if (r.status === 'cancelled') st.toast('warn', t('İptal edildi'), t('{n} işlem tamamlanmıştı', { n: r.opsOk }));
      else st.toast('error', r.status === 'partial' ? t('Kısmen başarılı') : t('Gönderim başarısız'), t('{ok} başarılı, {failed} hatalı', { ok: r.opsOk, failed: r.opsFailed }));
      break;
    }
    case 'task-progress':
      useApp.setState((s) => (s.planning?.taskId === e.taskId ? { planning: { ...s.planning, message: e.message, done: e.done, total: e.total, targets: e.targets ?? s.planning.targets } } : {}));
      break;
    case 'open':
      if (st.boot) void handleOpen(e.request);
      else pendingOpen.push(e.request);
      break;
    case 'integration':
      useApp.setState({ integration: e.status });
      break;
    case 'config-changed': {
      const boot = st.boot;
      if (boot) useApp.setState({ boot: { ...boot, config: e.config } });
      break;
    }
    case 'probe': {
      const before = st.probes;
      useApp.setState((s) => mergeProbes(s, e.results));
      probeNotices(before, e.results);
      break;
    }
    case 'update':
      useApp.setState({ update: e.state });
      if (e.state.phase === 'available' || e.state.phase === 'ready') {
        st.addNotice({
          kind: 'update',
          level: 'info',
          key: `update:${e.state.phase}:${e.state.version ?? ''}`,
          title: e.state.phase === 'ready' ? t('v{version} indirildi; yeniden başlayınca kurulur', { version: e.state.version ?? '' }) : t('v{version} çıktı', { version: e.state.version ?? '' }),
          page: 'settings',
        });
      }
      break;
    case 'automation':
      useApp.setState({ automation: e.state });
      for (const w of e.state.watches) {
        if (w.status === 'error' && w.error) st.addNotice({ kind: 'automation', level: 'error', key: `watch:${w.id}:${w.error}`, title: t('{name} izlemesi durdu', { name: w.name }), detail: w.error, page: 'automation' });
        else if (w.lastStatus === 'failed' || w.lastStatus === 'partial') st.addNotice({ kind: 'automation', level: 'error', key: `watch-run:${w.id}:${w.lastRunAt ?? 0}`, title: t('{name}: otomatik gönderim hatalı bitti', { name: w.name }), detail: w.lastSummary, page: 'history', runId: w.lastRunId });
      }
      for (const sc of e.state.schedules) {
        if ((sc.lastStatus === 'failed' || sc.lastStatus === 'partial') && sc.lastAt) st.addNotice({ kind: 'automation', level: 'error', key: `sched:${sc.jobId}:${sc.lastAt}`, title: t('{name}: zamanlanmış iş hatalı bitti', { name: sc.name }), detail: sc.lastSummary, page: 'automation' });
      }
      break;
  }
}

/** Machines that went away or came back since the last probe: a line each in the notification centre. */
function probeNotices(before: Record<string, ProbeResult>, results: ProbeResult[]): void {
  const st = useApp.getState();
  const nodes = st.boot?.config.nodes ?? [];
  for (const r of results) {
    const prev = before[r.nodeId];
    if (!prev || prev.ok === r.ok) continue;
    const node = nodes.find((n) => n.id === r.nodeId);
    const name = node ? machineTitle(node.name, node.address) : r.nodeId;
    if (r.ok) st.addNotice({ kind: 'machine', level: 'ok', key: `up:${r.nodeId}`, title: t('{name} yeniden erişilebilir', { name }), page: 'targets', read: true });
    else st.addNotice({ kind: 'machine', level: 'warn', key: `down:${r.nodeId}`, title: t('{name} erişilemez oldu', { name }), detail: r.detail, page: 'targets' });
  }
}

/** The page from the address (palette, reload) or the one open when the app was closed. */
function initialPage(): Page {
  const fromHash = location.hash.replace('#', '') as Page;
  if (PAGES.includes(fromHash)) return fromHash;
  const kept = readStored<Page | null>('samsync.page', null);
  return kept && PAGES.includes(kept) ? kept : 'overview';
}

/** A tab named after what came from the menu: the first item, and how many more. */
function tabName(paths: string[]): string {
  const first = paths[0]?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return paths.length > 1 ? `${first} +${paths.length - 1}` : first;
}

/** Launches that arrive before the bootstrap; handled right after it. */
const pendingOpen: OpenRequest[] = [];

/** The active list's own options as a tab keeps them (no dry run), or undefined when it uses the general ones. */
function ownOf(s: { ownOptions: boolean; options: SendOptions }): SendOptions | undefined {
  return s.ownOptions ? { ...s.options, dryRun: false } : undefined;
}

/** Send options before the user changes anything: config defaults plus the defaults from Settings. */
function baseOptions(boot: Bootstrap): SendOptions {
  return baseSendOptions(boot.config.copy, boot.settings.sendDefaults);
}

interface ResolvedTargets {
  targets: string[];
  /** Options saved with a profile or with the last send. */
  options?: Partial<SendOptions>;
  label?: string;
}

/** --to tokens: node ids, group:<name>, profile:<name or id>, all, last. Only enabled machines other than this one. */
function resolveTargets(raw: string[]): ResolvedTargets | null {
  const st = useApp.getState();
  const boot = st.boot;
  if (!boot) return null;
  const cfg = boot.config;
  const ids = new Set<string>();
  let options: Partial<SendOptions> | undefined;
  let label: string | undefined;
  for (const r of raw) {
    const k = r.toLowerCase();
    if (k === 'all') cfg.nodes.forEach((n) => ids.add(n.id));
    else if (k === 'last') {
      boot.settings.lastTargets.forEach((id) => ids.add(id));
      options = { ...options, ...(boot.settings.lastOptions ?? {}), perTarget: { ...options?.perTarget, ...boot.settings.lastOptions?.perTarget } };
      label = t('Son ayar');
    } else if (k.startsWith('group:')) cfg.nodes.filter((n) => n.group?.toLowerCase() === k.slice(6)).forEach((n) => ids.add(n.id));
    else if (k.startsWith('profile:')) {
      const p = cfg.profiles.find((x) => x.name.toLowerCase() === k.slice(8) || x.id.toLowerCase() === k.slice(8));
      p?.targetIds.forEach((id) => ids.add(id));
      if (p) {
        // the profile's own per target exceptions replace whatever the Send page had
        options = { ...options, ...(p.options ?? {}), perTarget: { ...options?.perTarget, ...p.options?.perTarget } };
        label = t('Profil: {name}', { name: p.name });
      }
    } else {
      const n = cfg.nodes.find((x) => x.id.toLowerCase() === k);
      if (n) ids.add(n.id);
    }
  }
  const local = boot.identity.node?.id;
  const targets = cfg.nodes.filter((n) => ids.has(n.id) && n.enabled && n.id !== local).map((n) => n.id);
  if (!targets.length) {
    if (raw.some((r) => r.toLowerCase() === 'last')) st.toast('warn', t('Son gönderim ayarı yok'), t('Önce bir kez “İncele ve gönder” ile gönderin; sonra aynı hedefler ve seçenekler tek tıkla kullanılır.'));
    else st.toast('warn', t('Komut satırındaki hedefler bulunamadı'), raw.join(', '));
    return null;
  }
  return { targets, options, label };
}

/** Opens what Explorer, Notepad++ or the command line asked for. */
async function handleOpen(r: OpenRequest) {
  const st = useApp.getState();
  if (r.restore) {
    st.setPage('backups');
    useApp.setState((s) => ({ restoreRequest: { paths: r.paths, seq: (s.restoreRequest?.seq ?? 0) + 1 } }));
    return;
  }
  if (!r.targets?.length) {
    st.setPage('send');
    // the menu's items get a tab of their own; the lists already open stay as they are
    await st.newWorkspace({ name: tabName(r.paths), paths: r.paths, rels: r.rels });
    return;
  }
  const to = resolveTargets(r.targets);
  if (!to || !r.paths.length) return;
  // a quick send brings its own options and name
  if (r.options) to.options = { ...(to.options ?? {}), ...r.options };
  if (r.label) to.label = r.label;
  if (r.send) return sendNow(r.paths, to, r.rels);
  st.setPage('send');
  // a launch with --to is its own send in its own tab
  // its options (a quick send's, a profile's) stay with its own list; the general ones do not change
  await st.newWorkspace({ name: tabName(r.paths), paths: r.paths, rels: r.rels, targets: to.targets, options: to.options });
  await st.startPlan({ sources: fsSources(r.paths, r.rels), origin: 'send', targetIds: to.targets, label: to.label });
}

/**
 * The one-click menu entries: plan and send at once, like the old tool's menu did. The Send page list is left
 * alone. A plan that would delete on a target (mirror from a profile or the last settings) opens the review.
 */
async function sendNow(paths: string[], to: ResolvedTargets, rels?: Record<string, string>) {
  const st = useApp.getState();
  const boot = st.boot!;
  const options: SendOptions = { ...baseOptions(boot), ...(to.options ?? {}), dryRun: false };
  const taskId = newTaskId();
  useApp.setState({ planning: { taskId, message: t('Hazırlanıyor…') } });
  try {
    const plan = await api.planSend({ sources: fsSources(paths, rels), origin: 'send', targetIds: to.targets, options, label: to.label }, taskId);
    if (useApp.getState().planning?.taskId !== taskId) return; // cancelled
    useApp.setState({ planning: null });
    const selected: Record<string, string[]> = {};
    let deletes = 0;
    for (const tp of plan.targets) {
      const ops = tp.ops.filter((o) => o.selected);
      selected[tp.targetId] = ops.map((o) => o.id);
      deletes += ops.filter((o) => o.kind === 'delete').length;
    }
    if (deletes) {
      const sel: Record<string, Set<string>> = {};
      for (const [k, v] of Object.entries(selected)) sel[k] = new Set(v);
      useApp.setState({ review: { plan, selected: sel } });
      st.toast('warn', t('Gönderim hedefte silme yapacak'), t('{n} öğe silinecek; göndermeden önce gözden geçirin.', { n: deletes }));
      return;
    }
    const runId = await api.executePlan(plan.id, selected, { remember: false });
    st.watchRun(runId);
  } catch (e) {
    useApp.setState({ planning: null });
    if (!(e as Error).message.includes(t('İptal edildi'))) st.toast('error', t('Gönderim başlatılamadı'), (e as Error).message);
  }
}

/** Selectors */
export const useConfig = () => useApp((s) => s.boot!.config);
export const useLocalNodeId = () => useApp((s) => s.boot?.identity.node?.id);
