import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { History, FileSpreadsheet, Trash2, RotateCcw, Send, GitBranch, ArrowLeftRight, ArchiveRestore, FlaskConical, XCircle, CheckCircle2, Eraser, Undo2 } from 'lucide-react';
import type { RunDetail, RunSummary } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Empty, SearchInput, Segmented } from '../components/ui';
import { StatusIcon } from '../components/RunPanel';
import { HistoryStats } from '../components/HistoryStats';
import { ago, bytes, cls, dateTime, duration, num, splitPath } from '../lib/format';
import { locale, t, tk } from '@shared/i18n';

const ORIGIN: Record<RunSummary['origin'], { label: string; icon: typeof Send }> = {
  send: { label: tk('Gönder'), icon: Send },
  git: { label: 'Git', icon: GitBranch },
  sync: { label: tk('Senkron'), icon: ArrowLeftRight },
  restore: { label: tk('Geri alma'), icon: ArchiveRestore },
};

export function HistoryPage() {
  const version = useApp((s) => s.historyVersion);
  const toast = useApp((s) => s.toast);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [origin, setOrigin] = useState<'all' | RunSummary['origin']>('all');
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string | null>(null);
  /** A day picked on the chart: only its runs are listed. */
  const [day, setDay] = useState<number | null>(null);

  const load = () => void api.runs().then(setRuns);
  useEffect(load, [version]);

  const ql = q.trim().toLowerCase();
  const list = (runs ?? []).filter((r) => (origin === 'all' || r.origin === origin) && (day == null || (r.startedAt >= day && r.startedAt < day + 86400_000)) && (!ql || `${r.label} ${r.targets.map((x) => x.title).join(' ')} ${r.sources.join(' ')}`.toLowerCase().includes(ql)));
  const current = list.find((r) => r.id === active) ?? list[0];

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Geçmiş')}</h1>
          <div className="sub">{t('Her çalıştırmanın hedef bazında sonucu, hataları ve günlüğü. Son 300 çalıştırma saklanır.')}</div>
        </div>
        {runs && runs.length > 0 && (
          <Button
            variant="ghost"
            icon={<Eraser size={14} />}
            onClick={async () => {
              if (!confirm(t('Bütün geçmiş silinsin mi?'))) return;
              await api.clearRuns();
              load();
              toast('ok', t('Geçmiş temizlendi'));
            }}
          >
            {t('Temizle')}
          </Button>
        )}
      </div>
      <div className="page-body fill">
        {runs && <HistoryStats runs={runs} day={day} onDay={setDay} />}
        <div className="history-layout">
          <div className="card history-list">
            <div className="pane-head" style={{ flexDirection: 'column', alignItems: 'stretch', height: 'auto', padding: 10, gap: 8 }}>
              <SearchInput value={q} onChange={setQ} placeholder={t('Ara: hedef, kaynak, etiket')} />
              <Segmented
                size="sm"
                full
                value={origin}
                onChange={setOrigin}
                options={[
                  { value: 'all', label: t('Tümü') },
                  { value: 'send', label: t('Gönder') },
                  { value: 'git', label: 'Git' },
                  { value: 'sync', label: t('Senkron') },
                  { value: 'restore', label: t('Geri al') },
                ]}
              />
            </div>
            <div className="pane-scroll">
              {!runs ? (
                <div className="empty">
                  <div className="spinner" />
                </div>
              ) : !list.length ? (
                <Empty icon={<History size={20} />} title={t('Kayıt yok')}>
                  {t('Gönderimler burada listelenir.')}
                </Empty>
              ) : (
                list.map((r) => {
                  const O = ORIGIN[r.origin];
                  return (
                    <button key={r.id} className={cls('history-item', current?.id === r.id && 'active')} onClick={() => setActive(r.id)}>
                      <StatusIcon status={r.status} />
                      <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="ellipsis" style={{ fontWeight: 580 }}>
                            {r.label}
                          </span>
                          {r.dryRun && <span className="badge amber">{t('deneme')}</span>}
                        </div>
                        <div className="row faint" style={{ fontSize: 11.5, gap: 6 }}>
                          <O.icon size={11} />
                          <span>{ago(r.startedAt)}</span>
                          <span>•</span>
                          <span>{t('{n} hedef', { n: r.targets.length })}</span>
                          <span>•</span>
                          <span className="tabular">
                            {num(r.opsOk)}
                            {r.opsFailed > 0 && <span style={{ color: 'var(--red)' }}> / {t('{n} hata', { n: num(r.opsFailed) })}</span>}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {current ? <RunDetailView key={current.id} summary={current} onDeleted={load} /> : <div className="card" />}
        </div>
      </div>
    </div>
  );
}

function RunDetailView({ summary, onDeleted }: { summary: RunSummary; onDeleted: () => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [tab, setTab] = useState<'targets' | 'errors' | 'log'>('targets');
  const toast = useApp((s) => s.toast);
  const st = useApp();
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void api.run(summary.id).then(setDetail);
  }, [summary.id]);

  const errors = useMemo(() => (detail?.results ?? []).filter((r) => !r.ok), [detail]);
  const titleOf = (key: string) => summary.targets.find((x) => x.key === key)?.title ?? key;
  const list = tab === 'errors' ? errors : [];
  const v = useVirtualizer({ count: tab === 'log' ? detail?.log.length ?? 0 : list.length, getScrollElement: () => parent.current, estimateSize: () => (tab === 'log' ? 22 : 40), overscan: 20 });
  const failedTargets = summary.targets.filter((x) => x.status === 'failed' || x.status === 'partial').map((x) => x.key);
  const O = ORIGIN[summary.origin];

  // undo: only a run that kept backups can be taken back (what it replaced is otherwise gone)
  const canUndo = !!summary.options?.backup && !summary.dryRun && summary.origin !== 'restore' && summary.opsOk > 0;
  const undo = async () => {
    const n = summary.targets.filter((x) => x.status === 'ok' || x.status === 'partial').length;
    if (!confirm(t('{n} makinede bu gönderimin değiştirdiği ve sildiği dosyalar yedeklerinden geri gelecek, eklediği yeni dosyalar silinecek. Şimdiki hâlleri de yedeklenir. Devam edilsin mi?', { n }))) return;
    try {
      const id = await api.restoreRun(summary.id, true);
      st.watchRun(id);
    } catch (e) {
      toast('error', t('Geri alınamadı'), (e as Error).message);
    }
  };
  const resend = async (onlyFailed: boolean) => {
    st.clearSendPaths();
    st.setTargets(onlyFailed ? failedTargets : summary.targetIds);
    st.setPage('send');
    await st.addSendPaths(summary.sources);
    toast('info', onlyFailed ? t('{n} hatalı hedef seçildi', { n: failedTargets.length }) : t('Kaynaklar ve hedefler yüklendi'), t('İnceleyip gönderin.'));
  };

  return (
    <div className="card history-detail">
      <div className="card-head" style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14 }}>
        <div className="icon-tile lg">
          <StatusIcon status={summary.status} size={19} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h2 className="ellipsis" style={{ fontSize: 15 }}>
              {summary.label}
            </h2>
            <span className="badge">
              <O.icon size={11} /> {t(O.label)}
            </span>
            {summary.dryRun && (
              <span className="badge amber">
                <FlaskConical size={11} /> {t('deneme')}
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {dateTime(summary.startedAt)} • {duration((summary.finishedAt ?? summary.startedAt) - summary.startedAt)} • {bytes(summary.bytes)}
          </div>
        </div>
        {(summary.origin === 'send' || summary.origin === 'git') && summary.sources.length > 0 && (
          <>
            {failedTargets.length > 0 && (
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => void resend(true)}>
                {t('Hatalılara yeniden gönder')}
              </Button>
            )}
            <Button size="sm" icon={<Send size={13} />} onClick={() => void resend(false)}>
              {t('Yeniden gönder')}
            </Button>
          </>
        )}
        {canUndo && (
          <Button size="sm" icon={<Undo2 size={13} />} tip={t('Bu gönderimi yedeklerinden geri al')} onClick={() => void undo()}>
            {t('Geri al')}
          </Button>
        )}
        <Button
          size="sm"
          icon={<FileSpreadsheet size={13} />}
          onClick={async () => {
            const f = await api.exportRunCsv(summary.id);
            if (f) {
              await api.openPath(f).catch(() => undefined);
              toast('ok', t('CSV rapor oluşturuldu'), f);
            }
          }}
        >
          CSV
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          icon={<Trash2 size={14} />}
          tip={t('Kaydı sil')}
          onClick={async () => {
            await api.deleteRun(summary.id);
            onDeleted();
          }}
        />
      </div>
      <div className="stat-grid" style={{ padding: 14 }}>
        <div className="stat">
          <div className="k">{t('Başarılı işlem')}</div>
          <div className="v" style={{ color: 'var(--green)' }}>
            {num(summary.opsOk)}
          </div>
        </div>
        <div className="stat">
          <div className="k">{t('Hatalı işlem')}</div>
          <div className="v" style={{ color: summary.opsFailed ? 'var(--red)' : undefined }}>
            {num(summary.opsFailed)}
          </div>
        </div>
        <div className="stat">
          <div className="k">{t('Hedef')}</div>
          <div className="v">{summary.targets.length}</div>
        </div>
        <div className="stat">
          <div className="k">{t('Aktarılan')}</div>
          <div className="v">{bytes(summary.bytes)}</div>
        </div>
      </div>
      <div className="row" style={{ padding: '0 14px 10px' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'targets', label: t('Hedefler') },
            { value: 'errors', label: errors.length ? t('Hatalar ({n})', { n: errors.length }) : t('Hatalar') },
            { value: 'log', label: t('Günlük') },
          ]}
        />
        <span className="spacer" />
        {summary.sources.length > 0 && (
          <span className="faint ellipsis mono" style={{ fontSize: 11.5, maxWidth: 420 }} title={summary.sources.join('\n')}>
            {summary.sources.length === 1
              ? summary.sources[0]
              : t('{n} kaynak: {names}…', {
                  n: summary.sources.length,
                  names: summary.sources
                    .slice(0, 2)
                    .map((s) => splitPath(s).name)
                    .join(', '),
                })}
          </span>
        )}
      </div>
      <div ref={parent} className="pane-scroll" style={{ borderTop: '1px solid var(--border)' }}>
        {tab === 'targets' &&
          summary.targets.map((tg) => (
            <div key={tg.key} className="list-row" style={{ height: 'auto', minHeight: 46, padding: '8px 14px' }}>
              <StatusIcon status={tg.status} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 580 }}>{tg.title}</div>
                <div className="faint mono ellipsis selectable" style={{ fontSize: 11.5 }}>
                  {tg.via ? t('{relay} üzerinden', { relay: summary.targets.find((y) => y.key === tg.via && !y.via)?.title ?? tg.via }) : tg.root}
                </div>
                {tg.error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{tg.error}</div>}
                {tg.backupPath && <div className="faint" style={{ fontSize: 11.5 }}>{t('yedek: {path}', { path: tg.backupPath })}</div>}
              </div>
              <span className="tabular faint nowrap" style={{ fontSize: 12 }}>
                {tg.done - tg.failed}/{tg.total}
                {tg.failed > 0 && <span style={{ color: 'var(--red)' }}> • {t('{n} hata', { n: tg.failed })}</span>}
              </span>
              <span className="faint tabular nowrap" style={{ fontSize: 12, width: 70, textAlign: 'right' }}>
                {tg.finishedAt && tg.startedAt ? duration(tg.finishedAt - tg.startedAt) : ''}
              </span>
            </div>
          ))}
        {tab === 'errors' &&
          (errors.length === 0 ? (
            <Empty icon={<CheckCircle2 size={20} color="var(--green)" />} title={t('Hata yok')} />
          ) : (
            <div style={{ height: v.getTotalSize(), position: 'relative' }}>
              {v.getVirtualItems().map((vi) => {
                const r = list[vi.index];
                return (
                  <div key={vi.key} className="list-row" style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size }}>
                    <XCircle size={14} color="var(--red)" />
                    <span className="badge" style={{ maxWidth: 140 }}>
                      <span className="ellipsis">{titleOf(r.key)}</span>
                    </span>
                    <span className="mono ellipsis" style={{ fontSize: 12, maxWidth: '40%' }} title={r.rel}>
                      {r.rel}
                    </span>
                    <span className="ellipsis selectable" style={{ color: 'var(--red)', fontSize: 12 }} title={r.error}>
                      {r.error}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        {tab === 'log' && detail && (
          <div style={{ height: v.getTotalSize(), position: 'relative' }} className="selectable">
            {v.getVirtualItems().map((vi) => {
              const l = detail.log[vi.index];
              return (
                <div key={vi.key} className={cls('log-line', l.level)} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size, padding: '0 14px' }}>
                  <span className="lt">{new Date(l.t).toLocaleTimeString(locale())}</span>
                  {l.key && <span className="lk">{titleOf(l.key)}</span>}
                  <span className="lm ellipsis">{l.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
