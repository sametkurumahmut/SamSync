import { create } from 'zustand';
import type {
  AppConfig,
  AppEvent,
  Bootstrap,
  LocalSettings,
  ProbeResult,
  RunLogLine,
  RunSummary,
  RunTargetState,
  SendOptions,
  SendPlan,
  SendRequest,
  SourceInfo,
  UpdateState,
  AutomationState,
  OpenRequest,
} from '@shared/types';
import type { IntegrationStatus } from '@shared/api';
import { api, newTaskId, onEvent } from '../lib/api';
import { resolveLang, setLang, systemLang, t, type Lang } from '@shared/i18n';

export type Page = 'send' | 'git' | 'sync' | 'automation' | 'targets' | 'backups' | 'history' | 'settings';
export const PAGES: Page[] = ['send', 'git', 'sync', 'automation', 'targets', 'backups', 'history', 'settings'];

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info' | 'warn';
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
}

export interface LiveRun {
  summary: RunSummary;
  targets: RunTargetState[];
  log: RunLogLine[];
  done: boolean;
}

export interface Review {
  plan: SendPlan;
  selected: Record<string, Set<string>>;
}

export const DEFAULT_OPTIONS: SendOptions = {
  mode: 'overwrite',
  compare: 'timeSize',
  backup: false,
  dryRun: false,
  verify: false,
  excludeFiles: [],
  excludeDirs: [],
  parallelTargets: 4,
  propagateDeletes: true,
  runPostCommand: true,
  notify: true,
};

interface State {
  boot: Bootstrap | null;
  bootError?: string;
  page: Page;
  collapsed: boolean;
  dark: boolean;
  probes: Record<string, ProbeResult>;
  probing: boolean;
  update: UpdateState | null;
  automation: AutomationState | null;
  toasts: Toast[];
  palette: boolean;
  /** UI language in effect; App re-mounts when it changes so every t() runs again. */
  lang: Lang;
  /** Explorer menu and Notepad++ integration (Windows). */
  integration: IntegrationStatus | null;
  /** "Restore from backup" from the Explorer or Notepad++ menu: the Backups page takes these items. */
  restoreRequest: { paths: string[]; seq: number } | null;

  sendPaths: string[];
  sendInfos: SourceInfo[];
  targets: string[];
  options: SendOptions;

  planning: { taskId: string; message: string; done?: number; total?: number } | null;
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

  addSendPaths(paths: string[]): Promise<void>;
  removeSendPath(p: string): void;
  clearSendPaths(): void;
  setTargets(ids: string[]): void;
  setOptions(patch: Partial<SendOptions>): void;

  startPlan(req: Omit<SendRequest, 'targetIds' | 'options'> & { targetIds?: string[]; options?: Partial<SendOptions> }): Promise<void>;
  cancelPlan(): void;
  closeReview(): void;
  setReviewSelection(targetId: string, ids: Set<string>): void;
  executeReview(dryRun?: boolean): Promise<void>;
  watchRun(runId: string): void;

  saveConfig(cfg: AppConfig): Promise<boolean>;
  saveSettings(patch: Partial<LocalSettings>): Promise<void>;
  setBoot(b: Bootstrap): void;
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
  page: PAGES.includes(location.hash.replace('#', '') as Page) ? (location.hash.replace('#', '') as Page) : 'send',
  collapsed: localStorage.getItem('samsync.collapsed') === '1',
  dark: true,
  probes: {},
  probing: false,
  update: null,
  automation: null,
  toasts: [],
  palette: false,
  lang: firstLang,
  integration: null,
  restoreRequest: null,
  sendPaths: [],
  sendInfos: [],
  targets: [],
  options: DEFAULT_OPTIONS,
  planning: null,
  review: null,
  runs: {},
  runPanel: false,
  historyVersion: 0,

  async init() {
    onEvent((e) => handleEvent(e));
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
      set({ boot, options, targets: s.lastTargets.filter((id) => known.has(id)) });
      get().applyTheme();
      // the web preview passes SAMSYNC_PATHS here; Electron sends its launches as 'open' events
      if (boot.initialPaths.length) pendingOpen.unshift({ paths: boot.initialPaths, targets: boot.initialTargets.length ? boot.initialTargets : undefined });
      for (const r of pendingOpen.splice(0)) await handleOpen(r);
      void get().probe();
      // keep the reachability dots fresh while the window is in use
      setInterval(() => {
        const st = get();
        const every = (st.boot?.settings.probeIntervalSec ?? 45) * 1000;
        if (document.visibilityState === 'visible' && !st.probing && Date.now() - lastProbe >= every) void st.probe();
      }, 5000);
      void api.updateState().then((u) => set({ update: u }));
      void api.automationState().then((a) => set({ automation: a }));
    } catch (e) {
      set({ bootError: (e as Error).message });
    }
  },

  setPage(p) {
    location.hash = p;
    set({ page: p });
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
    const cs = getComputedStyle(root);
    void api.setChrome({ theme: pref, bg: cs.getPropertyValue('--bg').trim() || (dark ? '#0c0e13' : '#f4f5f8'), fg: dark ? '#c9ced8' : '#3b414d' }).catch(() => undefined);
  },

  async probe(ids) {
    if (!ids) lastProbe = Date.now();
    set({ probing: true });
    try {
      const res = await api.probe(ids);
      set((s) => {
        const probes = { ...s.probes };
        for (const r of res) probes[r.nodeId] = r;
        return { probes };
      });
    } catch (e) {
      get().toast('error', t('Erişim yoklaması başarısız'), (e as Error).message);
    } finally {
      set({ probing: false });
    }
  },

  async addSendPaths(paths) {
    const cur = get().sendPaths;
    const lower = new Set(cur.map((p) => p.toLowerCase()));
    const add = paths.filter((p) => !lower.has(p.toLowerCase()));
    if (!add.length) return;
    const next = [...cur, ...add];
    set({ sendPaths: next });
    const infos = await api.describeSources(next);
    set({ sendInfos: infos });
  },
  removeSendPath(p) {
    set((s) => ({ sendPaths: s.sendPaths.filter((x) => x !== p), sendInfos: s.sendInfos.filter((x) => x.path !== p) }));
  },
  clearSendPaths() {
    set({ sendPaths: [], sendInfos: [] });
  },
  setTargets(ids) {
    set({ targets: ids });
  },
  setOptions(patch) {
    const options = { ...get().options, ...patch };
    set({ options });
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
  async executeReview(dryRun) {
    const r = get().review;
    if (!r) return;
    const selected: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(r.selected)) selected[k] = [...v];
    // mirror deletes on the targets: ask once more, with the total, before anything is written
    const deletes = r.plan.targets.reduce((n, tp) => n + tp.ops.filter((o) => o.kind === 'delete' && r.selected[tp.targetId]?.has(o.id)).length, 0);
    const dry = dryRun ?? r.plan.request.options.dryRun;
    if (r.plan.request.options.mode === 'mirror' && deletes && !dry && !confirm(t('Ayna kipi hedeflerde toplam {n} öğe silecek. Gönderim sürsün mü?', { n: deletes }))) return;
    try {
      const runId = await api.executePlan(r.plan.id, selected, dryRun != null ? { dryRun } : undefined);
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
    if ('theme' in patch || 'accent' in patch || 'density' in patch) get().applyTheme();
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
    case 'run-start':
      useApp.setState((s) => ({ runs: { ...s.runs, [e.run.id]: { summary: e.run, targets: e.run.targets, log: [], done: false } } }));
      break;
    case 'run-progress':
      useApp.setState((s) => {
        const r = s.runs[e.runId];
        if (!r) return {};
        return { runs: { ...s.runs, [e.runId]: { ...r, targets: e.targets } } };
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
    case 'run-done': {
      useApp.setState((s) => {
        const r = s.runs[e.run.id];
        return {
          historyVersion: s.historyVersion + 1,
          runs: { ...s.runs, [e.run.id]: { summary: e.run, targets: e.run.targets, log: r?.log ?? [], done: true } },
        };
      });
      const r = e.run;
      if (r.status === 'ok') {
        st.toast('ok', r.dryRun ? t('Deneme tamamlandı') : t('Gönderim tamamlandı'), `${t('{n} işlem', { n: r.opsOk })} • ${t('{n} hedef', { n: r.targets.length })}`);
        if (st.boot?.settings.closeRunPanelOnSuccess && st.activeRunId === r.id) useApp.setState({ runPanel: false });
      } else if (r.status === 'cancelled') st.toast('warn', t('İptal edildi'), t('{n} işlem tamamlanmıştı', { n: r.opsOk }));
      else st.toast('error', r.status === 'partial' ? t('Kısmen başarılı') : t('Gönderim başarısız'), t('{ok} başarılı, {failed} hatalı', { ok: r.opsOk, failed: r.opsFailed }));
      break;
    }
    case 'task-progress':
      useApp.setState((s) => (s.planning?.taskId === e.taskId ? { planning: { ...s.planning, message: e.message, done: e.done, total: e.total } } : {}));
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
    case 'probe':
      useApp.setState((s) => {
        const probes = { ...s.probes };
        for (const r of e.results) probes[r.nodeId] = r;
        return { probes };
      });
      break;
    case 'update':
      useApp.setState({ update: e.state });
      break;
    case 'automation':
      useApp.setState({ automation: e.state });
      break;
  }
}

/** Launches that arrive before the bootstrap; handled right after it. */
const pendingOpen: OpenRequest[] = [];

/** Send options before the user changes anything: config defaults plus the defaults from Settings. */
function baseOptions(boot: Bootstrap): SendOptions {
  return {
    ...DEFAULT_OPTIONS,
    excludeFiles: boot.config.copy.excludeFiles,
    excludeDirs: boot.config.copy.excludeDirs,
    parallelTargets: boot.config.copy.parallelTargets,
    verify: boot.config.copy.verify,
    ...(boot.settings.sendDefaults ?? {}),
    dryRun: false,
  };
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
      options = { ...options, ...(boot.settings.lastOptions ?? {}) };
      label = t('Son ayar');
    } else if (k.startsWith('group:')) cfg.nodes.filter((n) => n.group?.toLowerCase() === k.slice(6)).forEach((n) => ids.add(n.id));
    else if (k.startsWith('profile:')) {
      const p = cfg.profiles.find((x) => x.name.toLowerCase() === k.slice(8) || x.id.toLowerCase() === k.slice(8));
      p?.targetIds.forEach((id) => ids.add(id));
      if (p) {
        options = { ...options, ...(p.options ?? {}) };
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
    await st.addSendPaths(r.paths);
    return;
  }
  const to = resolveTargets(r.targets);
  if (!to || !r.paths.length) return;
  if (r.send) return sendNow(r.paths, to);
  st.setPage('send');
  // a launch with --to is its own send; it does not mix with what was already on the list
  st.clearSendPaths();
  await st.addSendPaths(r.paths);
  st.setTargets(to.targets);
  if (to.options) st.setOptions(to.options);
  await st.startPlan({ sources: r.paths.map((p) => ({ kind: 'fs', path: p })), origin: 'send', targetIds: to.targets, label: to.label });
}

/**
 * The one-click menu entries: plan and send at once, like the old tool's menu did. The Send page list is left
 * alone. A plan that would delete on a target (mirror from a profile or the last settings) opens the review.
 */
async function sendNow(paths: string[], to: ResolvedTargets) {
  const st = useApp.getState();
  const boot = st.boot!;
  const options: SendOptions = { ...baseOptions(boot), ...(to.options ?? {}), dryRun: false };
  const taskId = newTaskId();
  useApp.setState({ planning: { taskId, message: t('Hazırlanıyor…') } });
  try {
    const plan = await api.planSend({ sources: paths.map((p) => ({ kind: 'fs', path: p })), origin: 'send', targetIds: to.targets, options, label: to.label }, taskId);
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
