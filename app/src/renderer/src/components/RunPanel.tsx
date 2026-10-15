import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Loader2, Minimize2, X, Copy, FileSpreadsheet, Square, Clock, FlaskConical, AlertTriangle, CircleDashed } from 'lucide-react';
import type { RunTargetState, RunLogLine } from '@shared/types';
import { useApp, type LiveRun } from '../store/app';
import { Button, Progress, Segmented, useEscapeLayer } from './ui';
import { api } from '../lib/api';
import { bytes, cls, duration, num } from '../lib/format';
import { tx } from '../lib/i18n';
import { locale, t } from '@shared/i18n';

export function StatusIcon({ status, size = 16 }: { status: RunTargetState['status']; size?: number }) {
  if (status === 'running') return <Loader2 size={size} className="spin" color="var(--accent)" />;
  if (status === 'ok') return <CheckCircle2 size={size} color="var(--green)" />;
  if (status === 'failed') return <XCircle size={size} color="var(--red)" />;
  if (status === 'partial') return <AlertTriangle size={size} color="var(--amber)" />;
  if (status === 'cancelled') return <MinusCircle size={size} color="var(--text-3)" />;
  return <CircleDashed size={size} color="var(--text-3)" />;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function totals(run: LiveRun) {
  let total = 0;
  let done = 0;
  let bt = 0;
  let bd = 0;
  let failed = 0;
  for (const x of run.targets) {
    total += x.total;
    done += x.done;
    bt += x.bytesTotal;
    bd += x.bytesDone;
    failed += x.failed;
  }
  const pct = bt > 0 ? (bd / bt) * 100 : total ? (done / total) * 100 : 0;
  return { total, done, bt, bd, failed, pct };
}

export function RunPill() {
  const runs = useApp((s) => s.runs);
  const activeId = useApp((s) => s.activeRunId);
  const panel = useApp((s) => s.runPanel);
  const run = activeId ? runs[activeId] : undefined;
  if (!run || panel) return null;
  const tot = totals(run);
  return (
    <button className="run-pill no-drag" onClick={() => useApp.setState({ runPanel: true })}>
      {run.done ? <StatusIcon status={run.summary.status} size={14} /> : <Loader2 size={14} className="spin" />}
      <span>{run.done ? (run.summary.status === 'ok' ? t('Tamamlandı') : t('Bitti')) : t('Gönderiliyor %{pct}', { pct: Math.round(tot.pct) })}</span>
      <div className="run-pill-bar">
        <div style={{ width: `${run.done ? 100 : tot.pct}%` }} />
      </div>
    </button>
  );
}

export function RunPanel() {
  const runs = useApp((s) => s.runs);
  const activeId = useApp((s) => s.activeRunId);
  const open = useApp((s) => s.runPanel);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const run = activeId ? runs[activeId] : undefined;
  const now = useNow(!!run && !run.done && open);
  const [logFilter, setLogFilter] = useState<'all' | 'errors'>('all');
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEscapeLayer(() => useApp.setState({ runPanel: false }), open && !!run);
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [run?.log.length, logFilter]);

  if (!open || !run) return null;
  const s = run.summary;
  const tot = totals(run);
  const elapsed = (run.done ? s.finishedAt ?? now : now) - s.startedAt;
  const log = logFilter === 'errors' ? run.log.filter((l) => l.level === 'error' || l.level === 'warn') : run.log;
  const titleFor = (key?: string) => (key ? run.targets.find((x) => x.key === key)?.title ?? key : '');

  const copyLog = () => {
    const text = run.log.map((l) => `${new Date(l.t).toLocaleTimeString(locale())} [${l.level}]${l.key ? ` [${titleFor(l.key)}]` : ''} ${l.message}`).join('\n');
    void navigator.clipboard.writeText(text);
    toast('ok', t('Günlük panoya kopyalandı'));
  };

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && useApp.setState({ runPanel: false })}>
      <aside className="drawer">
        <div className="drawer-head">
          <div className={cls('icon-tile lg', !run.done && 'accent')}>{run.done ? <StatusIcon status={s.status} size={19} /> : <Loader2 size={19} className="spin" />}</div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <b className="ellipsis" style={{ fontSize: 15 }}>
                {s.label}
              </b>
              {s.dryRun && (
                <span className="badge amber">
                  <FlaskConical size={11} /> {t('deneme')}
                </span>
              )}
            </div>
            <div className="muted row" style={{ gap: 10, fontSize: 12.5 }}>
              <span>
                {run.done
                  ? s.status === 'ok'
                    ? t('Başarıyla tamamlandı')
                    : s.status === 'cancelled'
                      ? t('İptal edildi')
                      : s.status === 'partial'
                        ? t('Bazı işlemler başarısız')
                        : t('Başarısız')
                  : t('Çalışıyor')}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <Clock size={12} /> {duration(elapsed)}
              </span>
            </div>
          </div>
          <Button variant="ghost" iconOnly size="sm" icon={<Minimize2 size={15} />} tip={t('Küçült')} onClick={() => useApp.setState({ runPanel: false })} />
          {run.done && <Button variant="ghost" iconOnly size="sm" icon={<X size={16} />} onClick={() => useApp.setState({ runPanel: false, activeRunId: undefined })} />}
        </div>

        <div className="drawer-section">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="tabular">
              {tx('{done} / {total} işlem', { done: <b>{num(tot.done)}</b> }, { total: num(tot.total) })}
              {tot.bt > 0 && (
                <span className="muted">
                  {' '}
                  • {bytes(tot.bd)} / {bytes(tot.bt)}
                </span>
              )}
            </span>
            <span className="spacer" />
            {tot.failed > 0 && <span className="badge red">{t('{n} hata', { n: tot.failed })}</span>}
            <b className="tabular">{t('%{pct}', { pct: Math.round(run.done ? 100 : tot.pct) })}</b>
          </div>
          <Progress value={run.done ? 100 : tot.pct} state={run.done ? (s.status === 'ok' ? 'ok' : s.status === 'cancelled' ? undefined : 'bad') : undefined} />
        </div>

        <div className="drawer-targets">
          {run.targets.map((x) => {
            const pct = x.bytesTotal > 0 ? (x.bytesDone / x.bytesTotal) * 100 : x.total ? (x.done / x.total) * 100 : x.status === 'ok' ? 100 : 0;
            return (
              <div key={x.key} className="run-target">
                <StatusIcon status={x.status} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row">
                    <span className="ellipsis" style={{ fontWeight: 580 }}>
                      {x.title}
                    </span>
                    <span className="spacer" />
                    <span className="faint tabular" style={{ fontSize: 11.5 }}>
                      {x.done}/{x.total}
                      {x.failed > 0 && <span style={{ color: 'var(--red)' }}> • {t('{n} hata', { n: x.failed })}</span>}
                    </span>
                  </div>
                  <div style={{ margin: '5px 0 3px' }}>
                    <Progress value={x.status === 'queued' ? 0 : pct} state={x.status === 'ok' ? 'ok' : x.status === 'failed' || x.status === 'partial' ? 'bad' : undefined} />
                  </div>
                  <div className="faint mono ellipsis" style={{ fontSize: 11 }}>
                    {x.error ? <span style={{ color: 'var(--red)' }}>{x.error}</span> : x.current ? x.current : x.backupPath ? t('yedek: {path}', { path: x.backupPath }) : x.root}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="drawer-log-head">
          <span className="section-title" style={{ margin: 0 }}>
            {t('Günlük')}
          </span>
          <span className="spacer" />
          <Segmented
            size="sm"
            value={logFilter}
            onChange={setLogFilter}
            options={[
              { value: 'all', label: t('Tümü') },
              { value: 'errors', label: t('Hata/uyarı {n}', { n: run.log.filter((l) => l.level === 'error' || l.level === 'warn').length }) },
            ]}
          />
        </div>
        <div
          ref={logRef}
          className="drawer-log selectable"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {log.map((l: RunLogLine, i) => (
            <div key={i} className={cls('log-line', l.level)}>
              <span className="lt">{new Date(l.t).toLocaleTimeString(locale())}</span>
              {l.key && <span className="lk">{titleFor(l.key)}</span>}
              <span className="lm">{l.message}</span>
            </div>
          ))}
        </div>

        <div className="drawer-foot">
          {!run.done ? (
            <Button variant="danger" icon={<Square size={13} />} onClick={() => void api.cancelRun(s.id)}>
              {t('İptal et')}
            </Button>
          ) : (
            <Button
              icon={<FileSpreadsheet size={14} />}
              onClick={async () => {
                const f = await api.exportRunCsv(s.id);
                if (f) {
                  await api.openPath(f).catch(() => undefined);
                  toast('ok', t('Rapor oluşturuldu'), f);
                }
              }}
            >
              {t('CSV rapor')}
            </Button>
          )}
          <Button icon={<Copy size={14} />} onClick={copyLog}>
            {t('Günlüğü kopyala')}
          </Button>
          <span className="spacer" />
          {run.done && (
            <Button
              onClick={() => {
                useApp.setState({ runPanel: false });
                setPage('history');
              }}
            >
              {t('Geçmişte aç')}
            </Button>
          )}
          <Button variant={run.done ? 'primary' : 'default'} onClick={() => useApp.setState({ runPanel: false })}>
            {run.done ? t('Kapat') : t('Arka planda sürdür')}
          </Button>
        </div>
      </aside>
    </div>
  );
}
