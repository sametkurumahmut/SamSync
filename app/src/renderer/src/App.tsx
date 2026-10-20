import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Send,
  GitBranch,
  ArrowLeftRight,
  Server,
  History,
  Settings,
  ArchiveRestore,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Moon,
  Sun,
  Download,
  RefreshCw,
  Upload,
  Loader2,
  AlertTriangle,
  Zap,
  GitCompare,
  LayoutDashboard,
  CircleHelp,
  Bot,
  LogOut,
} from 'lucide-react';
import { useApp, PAGES, stepUiScale, uiScaleOf, type Page } from './store/app';
import { ShortcutsModal } from './components/Shortcuts';
import { WhatsNewModal } from './components/WhatsNew';
import { UpdateDialog } from './components/UpdateDialog';
import { HelpBot } from './components/HelpBot';
import { NoticeBell, NotificationCenter } from './components/NotificationCenter';
import { ServerPicker } from './components/ServerPicker';
import { cls } from './lib/format';
import { pathForFile } from './lib/api';
import { Button, PageSkeleton } from './components/ui';
import { Toasts } from './components/Toasts';
import { PlanReview, PlanningOverlay } from './components/PlanReview';
import { RunPanel, RunPill } from './components/RunPanel';
import { CommandPalette } from './components/CommandPalette';
import { OverviewPage } from './pages/OverviewPage';
// the other pages load when first opened, so the first screen is up sooner
const SendPage = lazy(() => import('./pages/SendPage').then((m) => ({ default: m.SendPage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const GitPage = lazy(() => import('./pages/GitPage').then((m) => ({ default: m.GitPage })));
const SyncPage = lazy(() => import('./pages/SyncPage').then((m) => ({ default: m.SyncPage })));
const TargetsPage = lazy(() => import('./pages/TargetsPage').then((m) => ({ default: m.TargetsPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const BackupsPage = lazy(() => import('./pages/BackupsPage').then((m) => ({ default: m.BackupsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AutomationPage = lazy(() => import('./pages/AutomationPage').then((m) => ({ default: m.AutomationPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));
import { Welcome } from './pages/Welcome';
import iconUrl from '../../../resources/icon.png';
import { t, tk } from '@shared/i18n';

const NAV: { id: Page; label: string; icon: typeof Send; hint: string }[] = [
  { id: 'overview', label: tk('Genel bakış'), icon: LayoutDashboard, hint: tk('Makineler, son gönderimler ve otomasyon bir bakışta') },
  { id: 'send', label: tk('Gönder'), icon: Send, hint: tk('Dosya ve klasörleri makinelere gönder') },
  { id: 'compare', label: tk('Karşılaştır'), icon: GitCompare, hint: tk('Kaynakları hedeflerle karşılaştır, farklara bak') },
  { id: 'git', label: 'Git', icon: GitBranch, hint: tk('Commit ve yerel değişiklikleri gönder') },
  { id: 'sync', label: tk('Senkron'), icon: ArrowLeftRight, hint: tk('Klasörleri karşılaştır ve eşitle') },
  { id: 'automation', label: tk('Otomasyon'), icon: Zap, hint: tk('Değişince gönder, zamanlanmış senkron') },
  { id: 'targets', label: tk('Hedefler'), icon: Server, hint: tk('Makineler, gruplar, erişim') },
  { id: 'backups', label: tk('Yedekler'), icon: ArchiveRestore, hint: tk('Hedeflerdeki eski hâlleri geri al') },
  { id: 'history', label: tk('Geçmiş'), icon: History, hint: tk('Çalıştırmalar ve raporlar') },
  { id: 'help', label: tk('Yardım'), icon: CircleHelp, hint: tk('Sık sorulan sorular ve yardım botu') },
];

const TITLES: Record<Page, string> = {
  overview: tk('Genel bakış'),
  send: tk('Gönder'),
  compare: tk('Karşılaştır'),
  git: 'Git',
  sync: tk('Senkron'),
  automation: tk('Otomasyon'),
  targets: tk('Hedefler'),
  backups: tk('Yedekler'),
  history: tk('Geçmiş'),
  help: tk('Yardım'),
  settings: tk('Ayarlar'),
};

export function App() {
  const lang = useApp((s) => s.lang);
  return <Shell key={lang} />;
}

function Shell() {
  const boot = useApp((s) => s.boot);
  const bootError = useApp((s) => s.bootError);
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const collapsed = useApp((s) => s.collapsed);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const dark = useApp((s) => s.dark);
  const saveSettings = useApp((s) => s.saveSettings);
  const update = useApp((s) => s.update);
  const probes = useApp((s) => s.probes);
  const sendCount = useApp((s) => s.sendPaths.length);
  const automation = useApp((s) => s.automation);
  const autoActive = automation ? automation.watches.filter((w) => w.enabled).length + automation.schedules.filter((s) => s.enabled && s.activeHere).length : 0;
  const autoBusy = !!automation && (automation.watches.some((w) => w.status === 'sending') || automation.schedules.some((s) => s.running));
  const addSendPaths = useApp((s) => s.addSendPaths);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F1') {
        e.preventDefault();
        useApp.setState((s) => ({ helpBot: !s.helpBot }));
        return;
      }
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        useApp.setState((s) => ({ palette: !s.palette }));
      } else if (key === '/' || (key === '?' && e.shiftKey)) {
        e.preventDefault();
        useApp.setState((s) => ({ shortcuts: !s.shortcuts }));
      } else if (key === ',') {
        e.preventDefault();
        setPage('settings');
      } else if (/^[1-9]$/.test(key) && !e.shiftKey) {
        e.preventDefault();
        const p = PAGES[Number(key) - 1];
        if (p) setPage(p);
      } else if (key === '=' || key === '+' || key === '-' || key === '0') {
        // UI scale, like a browser's zoom; the value is saved so it survives a restart
        e.preventDefault();
        const st = useApp.getState();
        const cur = uiScaleOf(st.boot?.settings);
        const next = stepUiScale(cur, key === '0' ? 0 : key === '-' ? -1 : 1);
        if (next !== cur) void st.saveSettings({ uiScale: next });
      } else if (key === 'enter' && !e.shiftKey) {
        // Send page: review what is on it (the review itself handles Ctrl Enter while open)
        const st = useApp.getState();
        if (st.page === 'send' && !st.review && !st.planning && st.sendPaths.length && st.targets.length) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('samsync:review'));
        }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setPage]);

  // Dropping files anywhere in the window adds them to the send list.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if ((e as DragEvent & { samsyncHandled?: boolean }).samsyncHandled) return;
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => pathForFile(f)).filter((p): p is string => !!p);
      if (paths.length) {
        const st = useApp.getState();
        if (st.page !== 'send' && st.page !== 'backups') st.setPage('send');
        if (useApp.getState().page === 'send') await addSendPaths(paths);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [addSendPaths]);

  if (bootError) {
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <div className="empty-icon">
          <AlertTriangle />
        </div>
        <h3>{t('Uygulama başlatılamadı')}</h3>
        <p className="selectable">{bootError}</p>
      </div>
    );
  }
  if (!boot) {
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <div className="spinner lg" />
      </div>
    );
  }

  const needsSetup = boot.config.nodes.length === 0 || !!boot.configError;
  const reachable = Object.values(probes).filter((p) => p.ok).length;
  const totalTargets = boot.config.nodes.filter((n) => n.enabled && n.id !== boot.identity.node?.id).length;
  const updateHot = update && (update.phase === 'available' || update.phase === 'ready' || update.phase === 'downloading');

  return (
    <div className={cls('app', collapsed && 'collapsed')}>
      <header className="titlebar" role="banner">
        <div className="brand">
          <img src={iconUrl} alt="" />
          <span>SamSync</span>
          <span className="ver">v{boot.appVersion}</span>
        </div>
        <span className="crumb">/ {t(TITLES[page])}</span>
        <div className="spacer" />
        <button className="titlebar-search" onClick={() => useApp.setState({ palette: true })}>
          <Search size={14} />
          <span className="grow" style={{ textAlign: 'left' }}>
            {t('Komut ara…')}
          </span>
          <span className="kbd">Ctrl K</span>
        </button>
        <div className="spacer" />
        <NoticeBell />
        <button className="titlebar-btn no-drag" data-tip={t('Yardım botu (F1)')} data-tip-pos="bottom" aria-label={t('Yardım botu (F1)')} onClick={() => useApp.setState((s) => ({ helpBot: !s.helpBot }))}>
          <Bot size={15} />
          <span>{t('Bot')}</span>
        </button>
        <RunPill />
        {updateHot && (
          <Button
            size="sm"
            variant="primary"
            className="update-pill"
            icon={update.phase === 'downloading' ? <Loader2 size={14} className="spin" /> : update.phase === 'ready' ? <RefreshCw size={14} /> : <Download size={14} />}
            tip={update.phase === 'ready' ? t('v{version} indirildi; yeniden başlayınca kurulur', { version: update.version ?? '' }) : undefined}
            tipPos="bottom"
            onClick={() => {
              // downloaded: the dialog says what the version brings and restarts into it; otherwise the Settings page has the details
              if (update.phase === 'ready') useApp.setState({ updatePrompt: true });
              else setPage('settings');
            }}
          >
            {update.phase === 'ready' ? t('Yeniden başlat ve güncelle') : update.phase === 'downloading' ? t('İndiriliyor %{pct}', { pct: Math.round(update.percent ?? 0) }) : t('v{version} çıktı', { version: update.version ?? '' })}
          </Button>
        )}
        {boot.readOnly && (
          <span className="badge amber no-drag" data-tip={t('İzleyici parolasıyla girildi: her şey görünür, hiçbir şey değiştirilemez')} data-tip-pos="bottom">
            {t('salt okunur')}
          </span>
        )}
        {boot.remote && (
          <a className="titlebar-btn no-drag" href="/logout" data-tip={t('Tarayıcı oturumunu kapat')} data-tip-pos="bottom">
            <LogOut size={14} />
            <span>{t('Oturumu kapat')}</span>
          </a>
        )}
        <div
          className="chip static no-drag"
          data-tip={boot.identity.node ? `${t('Bu makine: {name}', { name: boot.identity.node.name })}\n${boot.identity.reason}` : boot.identity.reason}
          data-tip-pos="bottom"
          onClick={() => setPage('targets')}
          style={{ cursor: 'pointer' }}
        >
          <span className={cls('dot', boot.identity.node ? 'ok' : 'bad')} />
          {boot.identity.node ? boot.identity.node.id : t('Tanımsız makine')}
        </div>
      </header>

      <nav className="sidebar" aria-label={t('Sayfalar')}>
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <button key={n.id} className={cls('nav-item', page === n.id && 'active')} aria-current={page === n.id ? 'page' : undefined} aria-label={collapsed ? t(n.label) : undefined} onClick={() => setPage(n.id)} data-tip={collapsed ? t(n.label) : undefined} data-tip-pos="right">
              <Icon size={17} />
              <span>{t(n.label)}</span>
              {n.id === 'send' && sendCount > 0 && <span className="count hot">{sendCount}</span>}
              {n.id === 'automation' && autoActive > 0 && (
                <span className={cls('count', autoBusy && 'hot')} data-tip={automation?.paused ? t('Duraklatıldı') : undefined}>
                  {automation?.paused ? '❚❚' : autoActive}
                </span>
              )}
              {n.id === 'targets' && totalTargets > 0 && (
                <span className="count">
                  {reachable}/{totalTargets}
                </span>
              )}
            </button>
          );
        })}
        <div className="sidebar-foot">
          <button className={cls('nav-item', page === 'settings' && 'active')} onClick={() => setPage('settings')} data-tip={collapsed ? t('Ayarlar') : undefined} data-tip-pos="right">
            <Settings size={17} />
            <span>{t('Ayarlar')}</span>
            {updateHot && <span className="count hot">1</span>}
          </button>
          <button className="nav-item" aria-label={collapsed ? t('Tema') : undefined} onClick={() => void saveSettings({ theme: dark ? 'light' : 'dark' })} data-tip={collapsed ? t('Tema') : undefined} data-tip-pos="right">
            {dark ? <Sun size={17} /> : <Moon size={17} />}
            <span>{dark ? t('Açık tema') : t('Koyu tema')}</span>
          </button>
          <button className="nav-item" aria-label={collapsed ? t('Genişlet') : t('Daralt')} aria-expanded={!collapsed} onClick={toggleSidebar} data-tip={collapsed ? t('Genişlet') : undefined} data-tip-pos="right">
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>{t('Daralt')}</span>
          </button>
        </div>
      </nav>

      <main className="content" id="main">
        {needsSetup && page !== 'settings' && page !== 'targets' ? (
          <Welcome />
        ) : (
          <Suspense fallback={<PageSkeleton cards={page === 'settings' || page === 'help' ? 0 : 3} rows={5} />}>
            {page === 'overview' && <OverviewPage />}
            {page === 'send' && <SendPage />}
            {page === 'compare' && <ComparePage />}
            {page === 'git' && <GitPage />}
            {page === 'sync' && <SyncPage />}
            {page === 'automation' && <AutomationPage />}
            {page === 'targets' && <TargetsPage />}
            {page === 'backups' && <BackupsPage />}
            {page === 'history' && <HistoryPage />}
            {page === 'help' && <HelpPage />}
            {page === 'settings' && <SettingsPage />}
          </Suspense>
        )}
      </main>

      {dragging && (
        <div className="drag-overlay">
          <div className="card">
            <div className="icon-tile accent lg">
              <Upload size={18} />
            </div>
            {t('Göndermek için bırakın')}
          </div>
        </div>
      )}
      <PlanningOverlay />
      <PlanReview />
      <RunPanel />
      <CommandPalette />
      <ShortcutsModal />
      <WhatsNewModal />
      <UpdateDialog />
      <HelpBot />
      <NotificationCenter />
      <ServerPicker />
      <Toasts />
    </div>
  );
}
