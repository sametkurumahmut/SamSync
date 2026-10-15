import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Send,
  GitBranch,
  ArrowLeftRight,
  Server,
  History,
  Settings,
  ArchiveRestore,
  FilePlus,
  FolderPlus,
  GitCommit,
  FileDiff,
  Wifi,
  Moon,
  Bookmark,
  FileText,
  Download,
  Search,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { useApp } from '../store/app';
import { useGit } from '../store/git';
import { api } from '../lib/api';
import { cls } from '../lib/format';
import { useEscapeLayer } from './ui';

interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
}

function score(text: string, q: string): number {
  if (!q) return 1;
  const t = text.toLocaleLowerCase('tr');
  const s = q.toLocaleLowerCase('tr');
  if (t.includes(s)) return 2 + (t.startsWith(s) ? 1 : 0);
  let i = 0;
  for (const ch of t) if (ch === s[i]) i++;
  return i === s.length ? 1 : 0;
}

export function CommandPalette() {
  const open = useApp((s) => s.palette);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const st = useApp();

  const close = () => {
    useApp.setState({ palette: false });
    setQ('');
    setIdx(0);
  };

  const cmds: Cmd[] = useMemo(() => {
    if (!st.boot) return [];
    const go = (p: Parameters<typeof st.setPage>[0]) => () => st.setPage(p);
    const list: Cmd[] = [
      { id: 'p-send', group: 'Sayfalar', label: 'Gönder', hint: 'Ctrl 1', icon: <Send size={15} />, run: go('send') },
      { id: 'p-git', group: 'Sayfalar', label: 'Git', hint: 'Ctrl 2', icon: <GitBranch size={15} />, run: go('git') },
      { id: 'p-sync', group: 'Sayfalar', label: 'Senkron', hint: 'Ctrl 3', icon: <ArrowLeftRight size={15} />, run: go('sync') },
      { id: 'p-automation', group: 'Sayfalar', label: 'Otomasyon', hint: 'Ctrl 4', icon: <Zap size={15} />, run: go('automation') },
      { id: 'p-targets', group: 'Sayfalar', label: 'Hedefler', hint: 'Ctrl 5', icon: <Server size={15} />, run: go('targets') },
      { id: 'p-backups', group: 'Sayfalar', label: 'Yedekler', hint: 'Ctrl 6', icon: <ArchiveRestore size={15} />, run: go('backups') },
      { id: 'p-history', group: 'Sayfalar', label: 'Geçmiş', hint: 'Ctrl 7', icon: <History size={15} />, run: go('history') },
      { id: 'p-settings', group: 'Sayfalar', label: 'Ayarlar', hint: 'Ctrl 8', icon: <Settings size={15} />, run: go('settings') },
      {
        id: 'a-pause',
        group: 'Eylemler',
        label: st.automation?.paused ? 'Otomasyonu sürdür' : 'Otomasyonu duraklat',
        icon: <Zap size={15} />,
        run: async () => {
          const a = await api.automationPause(!st.automation?.paused);
          useApp.setState({ automation: a });
        },
      },
      {
        id: 'a-files',
        group: 'Eylemler',
        label: 'Dosya seç ve gönder…',
        icon: <FilePlus size={15} />,
        run: async () => {
          const p = await api.pick({ files: true, multi: true, title: 'Gönderilecek dosyalar' });
          if (p.length) {
            st.setPage('send');
            await st.addSendPaths(p);
          }
        },
      },
      {
        id: 'a-folder',
        group: 'Eylemler',
        label: 'Klasör seç ve gönder…',
        icon: <FolderPlus size={15} />,
        run: async () => {
          const p = await api.pick({ folders: true, multi: true, title: 'Gönderilecek klasörler' });
          if (p.length) {
            st.setPage('send');
            await st.addSendPaths(p);
          }
        },
      },
      {
        id: 'a-last-commit',
        group: 'Git',
        label: 'Son commit’i gönder',
        icon: <GitCommit size={15} />,
        run: () => {
          useGit.setState({ pendingAction: 'lastCommit' });
          st.setPage('git');
        },
      },
      {
        id: 'a-worktree',
        group: 'Git',
        label: 'Yerel değişiklikleri gönder',
        icon: <FileDiff size={15} />,
        run: () => {
          useGit.setState({ pendingAction: 'worktree' });
          st.setPage('git');
        },
      },
      { id: 'a-probe', group: 'Eylemler', label: 'Hedeflere erişimi sına', icon: <Wifi size={15} />, run: () => void st.probe() },
      { id: 'a-theme', group: 'Eylemler', label: st.dark ? 'Açık temaya geç' : 'Koyu temaya geç', icon: <Moon size={15} />, run: () => void st.saveSettings({ theme: st.dark ? 'light' : 'dark' }) },
      { id: 'a-log', group: 'Eylemler', label: 'Günlük dosyasını aç', icon: <FileText size={15} />, run: () => void api.openLog() },
      {
        id: 'a-repeat',
        group: 'Eylemler',
        label: 'Son gönderimin kaynaklarını ve hedeflerini yükle',
        icon: <RotateCcw size={15} />,
        run: async () => {
          const runs = await api.runs();
          const last = runs.find((r) => r.origin === 'send');
          if (!last) return st.toast('info', 'Henüz gönderim yok');
          st.clearSendPaths();
          st.setTargets(last.targetIds);
          st.setPage('send');
          await st.addSendPaths(last.sources);
        },
      },
      {
        id: 'a-update',
        group: 'Eylemler',
        label: 'Güncellemeleri denetle',
        icon: <Download size={15} />,
        run: async () => {
          const u = await api.updateCheck();
          st.toast('info', 'Güncelleme', u.phase === 'none' ? 'Güncel sürümü kullanıyorsunuz.' : u.phase === 'available' ? `v${u.version} mevcut` : u.detail ?? u.error ?? u.phase);
        },
      },
      ...st.boot.config.profiles.map((p) => ({
        id: `prof-${p.id}`,
        group: 'Profiller',
        label: `${p.name} — hedefleri seç`,
        hint: `${p.targetIds.length} hedef`,
        icon: <Bookmark size={15} />,
        run: () => {
          st.setTargets(p.targetIds);
          st.toast('ok', `${p.name} profili uygulandı`, `${p.targetIds.length} hedef seçildi`);
        },
      })),
    ];
    return list;
  }, [st]);

  const filtered = cmds
    .map((c) => ({ c, s: score(`${c.label} ${c.group}`, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);

  useEscapeLayer(close, open);
  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.focus')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;
  let lastGroup = '';
  return createPortal(
    <div className="scrim" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette">
        <div className="palette-input">
          <Search size={17} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Bir komut veya sayfa yazın…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && filtered[idx]) {
                const c = filtered[idx];
                close();
                void c.run();
              }
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.map((c, i) => {
            const header = !q && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="menu-label">{header}</div>}
                <button
                  className={cls('menu-item', i === idx && 'focus')}
                  onMouseMove={() => setIdx(i)}
                  onClick={() => {
                    close();
                    void c.run();
                  }}
                >
                  <span className="faint">{c.icon}</span>
                  <span className="ellipsis">{c.label}</span>
                  {c.hint && <span className="hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
          {!filtered.length && <div className="faint" style={{ padding: 18, textAlign: 'center' }}>Eşleşen komut yok</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
