// The bell in the title bar and the drawer behind it: what happened while nobody was looking. Failed and partial
// sends, machines that went away or came back, a new version, an automation that stopped with an error. A toast
// is gone in seconds; this list stays until it is cleared, and a click goes to the page that explains it.
import { useMemo } from 'react';
import { Bell, CheckCheck, CheckCircle2, AlertTriangle, XCircle, Info, Trash2, X } from 'lucide-react';
import { useApp, type Notice } from '../store/app';
import { Button, Empty, useEscapeLayer } from './ui';
import { ago, cls } from '../lib/format';
import { locale, t } from '@shared/i18n';

export function NoticeBell() {
  const unread = useApp((s) => s.notices.reduce((a, n) => a + (n.read ? 0 : 1), 0));
  return (
    <button
      className="titlebar-btn no-drag bell"
      data-tip={t('Bildirimler')}
      data-tip-pos="bottom"
      aria-label={unread ? t('Bildirimler ({n} okunmamış)', { n: unread }) : t('Bildirimler')}
      onClick={() => useApp.setState((s) => ({ noticesOpen: !s.noticesOpen }))}
    >
      <Bell size={15} />
      {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(day: number): string {
  const today = dayStart(Date.now());
  if (day === today) return t('Bugün');
  if (day === today - 86400_000) return t('Dün');
  return new Date(day).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

function LevelIcon({ level }: { level: Notice['level'] }) {
  if (level === 'ok') return <CheckCircle2 size={16} color="var(--green)" />;
  if (level === 'warn') return <AlertTriangle size={16} color="var(--amber)" />;
  if (level === 'error') return <XCircle size={16} color="var(--red)" />;
  return <Info size={16} color="var(--accent)" />;
}

export function NotificationCenter() {
  const open = useApp((s) => s.noticesOpen);
  const notices = useApp((s) => s.notices);
  const close = () => {
    // what was seen is read
    useApp.getState().markNoticesRead();
    useApp.setState({ noticesOpen: false });
  };
  useEscapeLayer(close, open);
  const groups = useMemo(() => {
    const out: { day: number; items: Notice[] }[] = [];
    for (const n of notices) {
      const day = dayStart(n.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(n);
      else out.push({ day, items: [n] });
    }
    return out;
  }, [notices]);
  if (!open) return null;
  const unread = notices.filter((n) => !n.read).length;
  const go = (n: Notice) => {
    const st = useApp.getState();
    useApp.setState({ notices: st.notices.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
    if (n.runId) useApp.setState({ openRunId: n.runId });
    if (n.page) st.setPage(n.page);
    useApp.setState({ noticesOpen: false });
  };
  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="drawer notice-drawer" role="dialog" aria-label={t('Bildirimler')}>
        <div className="drawer-head">
          <div className="icon-tile accent lg">
            <Bell size={19} />
          </div>
          <div className="grow" style={{ minWidth: 0 }}>
            <b style={{ fontSize: 15 }}>{t('Bildirimler')}</b>
            <div className="muted" style={{ fontSize: 12 }}>
              {unread ? t('{n} okunmamış', { n: unread }) : notices.length ? t('Hepsi okundu') : t('Gönderim sonuçları, erişim değişiklikleri ve güncellemeler burada birikir.')}
            </div>
          </div>
          <Button variant="ghost" iconOnly size="sm" icon={<CheckCheck size={15} />} tip={t('Tümünü okundu say')} disabled={!unread} onClick={() => useApp.getState().markNoticesRead()} />
          <Button variant="ghost" iconOnly size="sm" icon={<Trash2 size={15} />} tip={t('Temizle')} disabled={!notices.length} onClick={() => useApp.getState().clearNotices()} />
          <Button variant="ghost" iconOnly size="sm" icon={<X size={16} />} tip={t('Kapat')} onClick={close} />
        </div>
        <div className="notice-list">
          {!notices.length ? (
            <Empty art="inbox" title={t('Bildirim yok')}>
              {t('Bir gönderim bitince, bir makine erişilemez olunca ya da yeni sürüm çıkınca burada görünür.')}
            </Empty>
          ) : (
            groups.map((g) => (
              <div key={g.day}>
                <div className="history-day">{dayLabel(g.day)}</div>
                {g.items.map((n) => (
                  <button key={n.id} className={cls('notice-row', !n.read && 'unread')} onClick={() => go(n)}>
                    <LevelIcon level={n.level} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="notice-title ellipsis">{n.title}</div>
                      {n.detail && <div className="notice-detail">{n.detail}</div>}
                    </div>
                    <span className="notice-time">{ago(n.at)}</span>
                    {!n.read && <span className="notice-dot" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
