import { useEffect, useState } from 'react';
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
  Upload,
  Loader2,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { useApp, PAGES, type Page } from './store/app';
import { cls } from './lib/format';
import { pathForFile } from './lib/api';
import { Button } from './components/ui';
import { Toasts } from './components/Toasts';
import { PlanReview, PlanningOverlay } from './components/PlanReview';
import { RunPanel, RunPill } from './components/RunPanel';
import { CommandPalette } from './components/CommandPalette';
import { SendPage } from './pages/SendPage';
import { GitPage } from './pages/GitPage';
import { SyncPage } from './pages/SyncPage';
import { TargetsPage } from './pages/TargetsPage';
import { HistoryPage } from './pages/HistoryPage';
import { BackupsPage } from './pages/BackupsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AutomationPage } from './pages/AutomationPage';
import { Welcome } from './pages/Welcome';
import iconUrl from '../../../resources/icon.png';

const NAV: { id: Page; label: string; icon: typeof Send; hint: string }[] = [
  { id: 'send', label: 'Gönder', icon: Send, hint: 'Dosya ve klasörleri makinelere gönder' },
  { id: 'git', label: 'Git', icon: GitBranch, hint: 'Commit ve yerel değişiklikleri gönder' },
  { id: 'sync', label: 'Senkron', icon: ArrowLeftRight, hint: 'Klasörleri karşılaştır ve eşitle' },
  { id: 'automation', label: 'Otomasyon', icon: Zap, hint: 'Değişince gönder, zamanlanmış senkron' },
  { id: 'targets', label: 'Hedefler', icon: Server, hint: 'Makineler, gruplar, erişim' },
  { id: 'backups', label: 'Yedekler', icon: ArchiveRestore, hint: 'Hedeflerdeki eski hâlleri geri al' },
  { id: 'history', label: 'Geçmiş', icon: History, hint: 'Çalıştırmalar ve raporlar' },
];

const TITLES: Record<Page, string> = {
  send: 'Gönder',
  git: 'Git',
  sync: 'Senkron',
  automation: 'Otomasyon',
  targets: 'Hedefler',
  backups: 'Yedekler',
  history: 'Geçmiş',
  settings: 'Ayarlar',
};

export function App() {
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useApp.setState((s) => ({ palette: !s.palette }));
      }
      if ((e.ctrlKey || e.metaKey) && /^[1-8]$/.test(e.key)) {
        e.preventDefault();
        setPage(PAGES[Number(e.key) - 1]);
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
        <h3>Uygulama başlatılamadı</h3>
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
      <header className="titlebar">
        <div className="brand">
          <img src={iconUrl} alt="" />
          <span>SamSync</span>
          <span className="ver">v{boot.appVersion}</span>
        </div>
        <span className="crumb">/ {TITLES[page]}</span>
        <div className="spacer" />
        <button className="titlebar-search" onClick={() => useApp.setState({ palette: true })}>
          <Search size={14} />
          <span className="grow" style={{ textAlign: 'left' }}>
            Komut ara…
          </span>
          <span className="kbd">Ctrl K</span>
        </button>
        <div className="spacer" />
        <RunPill />
        {updateHot && (
          <Button size="sm" variant="primary" icon={update.phase === 'downloading' ? <Loader2 size={14} className="spin" /> : <Download size={14} />} onClick={() => setPage('settings')}>
            {update.phase === 'ready' ? 'Güncellemeye hazır' : update.phase === 'downloading' ? `İndiriliyor %${Math.round(update.percent ?? 0)}` : `v${update.version} çıktı`}
          </Button>
        )}
        <div
          className="chip static no-drag"
          data-tip={boot.identity.node ? `Bu makine: ${boot.identity.node.name}\n${boot.identity.reason}` : boot.identity.reason}
          data-tip-pos="bottom"
          onClick={() => setPage('targets')}
          style={{ cursor: 'pointer' }}
        >
          <span className={cls('dot', boot.identity.node ? 'ok' : 'bad')} />
          {boot.identity.node ? boot.identity.node.id : 'Tanımsız makine'}
        </div>
      </header>

      <nav className="sidebar">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <button key={n.id} className={cls('nav-item', page === n.id && 'active')} onClick={() => setPage(n.id)} data-tip={collapsed ? n.label : undefined} data-tip-pos="right">
              <Icon size={17} />
              <span>{n.label}</span>
              {n.id === 'send' && sendCount > 0 && <span className="count hot">{sendCount}</span>}
              {n.id === 'automation' && autoActive > 0 && (
                <span className={cls('count', autoBusy && 'hot')} data-tip={automation?.paused ? 'Duraklatıldı' : undefined}>
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
          <button className={cls('nav-item', page === 'settings' && 'active')} onClick={() => setPage('settings')} data-tip={collapsed ? 'Ayarlar' : undefined} data-tip-pos="right">
            <Settings size={17} />
            <span>Ayarlar</span>
            {updateHot && <span className="count hot">1</span>}
          </button>
          <button className="nav-item" onClick={() => void saveSettings({ theme: dark ? 'light' : 'dark' })} data-tip={collapsed ? 'Tema' : undefined} data-tip-pos="right">
            {dark ? <Sun size={17} /> : <Moon size={17} />}
            <span>{dark ? 'Açık tema' : 'Koyu tema'}</span>
          </button>
          <button className="nav-item" onClick={toggleSidebar} data-tip={collapsed ? 'Genişlet' : undefined} data-tip-pos="right">
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>Daralt</span>
          </button>
        </div>
      </nav>

      <main className="content">
        {needsSetup && page !== 'settings' && page !== 'targets' ? (
          <Welcome />
        ) : (
          <>
            {page === 'send' && <SendPage />}
            {page === 'git' && <GitPage />}
            {page === 'sync' && <SyncPage />}
            {page === 'automation' && <AutomationPage />}
            {page === 'targets' && <TargetsPage />}
            {page === 'backups' && <BackupsPage />}
            {page === 'history' && <HistoryPage />}
            {page === 'settings' && <SettingsPage />}
          </>
        )}
      </main>

      {dragging && (
        <div className="drag-overlay">
          <div className="card">
            <div className="icon-tile accent lg">
              <Upload size={18} />
            </div>
            Göndermek için bırakın
          </div>
        </div>
      )}
      <PlanningOverlay />
      <PlanReview />
      <RunPanel />
      <CommandPalette />
      <Toasts />
    </div>
  );
}
