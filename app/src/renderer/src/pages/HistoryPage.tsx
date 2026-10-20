import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileSpreadsheet, Trash2, RotateCcw, Send, GitBranch, ArrowLeftRight, ArchiveRestore, FlaskConical, XCircle, CheckCircle2, Eraser, Undo2, Tag, Search } from 'lucide-react';
import type { RunDetail, RunSummary, ReleaseTag } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Empty, Field, ListSkeleton, Modal, SearchInput, Segmented } from '../components/ui';
import { FileTraceModal } from '../components/FileTrace';
import { StatusIcon } from '../components/RunPanel';
import { HistoryStats } from '../components/HistoryStats';
import { ago, bytes, cls, dateTime, duration, num, splitPath } from '../lib/format';
import { MachineName } from '../components/MachineName';
import { locale, t, tk } from '@shared/i18n';

type Range = 'all' | 'today' | '7d' | '30d';

function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The runs, newest first, bundled by calendar day for the separators in the list. */
function groupByDay(runs: RunSummary[]): { day: number; runs: RunSummary[] }[] {
  const out: { day: number; runs: RunSummary[] }[] = [];
  for (const r of runs) {
    const day = dayStart(r.startedAt);
    const last = out[out.length - 1];
    if (last && last.day === day) last.runs.push(r);
    else out.push({ day, runs: [r] });
  }
  return out;
}

function dayLabel(day: number): string {
  const today = dayStart(Date.now());
  if (day === today) return t('Bugün');
  if (day === today - 86400_000) return t('Dün');
  return new Date(day).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: day < today - 300 * 86400_000 ? 'numeric' : undefined });
}

function rangeStart(range: Range): number {
  const today = dayStart(Date.now());
  return range === 'today' ? today : range === '7d' ? today - 6 * 86400_000 : range === '30d' ? today - 29 * 86400_000 : 0;
}

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
  const [range, setRange] = useState<Range>('all');
  const [active, setActive] = useState<string | null>(null);
  /** A day picked on the chart: only its runs are listed. */
  const [day, setDay] = useState<number | null>(null);
  const [trace, setTrace] = useState(false);
  const tags = useApp((s) => s.boot?.settings.releaseTags ?? NO_TAGS);
  const tagOf = (id: string) => tags.find((x) => x.runId === id);

  const openRunId = useApp((s) => s.openRunId);
  const load = () => void api.runs().then(setRuns);
  useEffect(load, [version]);
  useEffect(() => {
    if (!openRunId || !runs) return;
    setActive(openRunId);
    setOrigin('all');
    setRange('all');
    setDay(null);
    useApp.setState({ openRunId: undefined });
  }, [openRunId, runs]);

  const ql = q.trim().toLowerCase();
  const since = rangeStart(range);
  const list = (runs ?? []).filter((r) => (origin === 'all' || r.origin === origin) && r.startedAt >= since && (day == null || (r.startedAt >= day && r.startedAt < day + 86400_000)) && (!ql || `${r.label} ${r.targets.map((x) => x.title).join(' ')} ${r.sources.join(' ')}`.toLowerCase().includes(ql)));
  const current = list.find((r) => r.id === active) ?? list[0];

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Geçmiş')}</h1>
          <div className="sub">{t('Her çalıştırmanın hedef bazında sonucu, hataları ve günlüğü. Son 300 çalıştırma saklanır.')}</div>
        </div>
        <Button icon={<Search size={14} />} onClick={() => setTrace(true)} tip={t('Bir dosyanın hangi gönderimle hangi makineye gittiğini bul')}>
          {t('Dosya izi')}
        </Button>
        {trace && (
          <FileTraceModal
            onClose={() => setTrace(false)}
            onOpen={(id) => {
              setTrace(false);
              setOrigin('all');
              setRange('all');
              setDay(null);
              setQ('');
              setActive(id);
            }}
          />
        )}
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
              <Segmented
                size="sm"
                full
                value={range}
                onChange={setRange}
                options={[
                  { value: 'all', label: t('Hepsi') },
                  { value: 'today', label: t('Bugün') },
                  { value: '7d', label: t('7 gün') },
                  { value: '30d', label: t('30 gün') },
                ]}
              />
            </div>
            <div className="pane-scroll" tabIndex={0} role="region" aria-label={t('Çalıştırmalar')}>
              {!runs ? (
                <ListSkeleton rows={6} />
              ) : !list.length ? (
                <Empty art="history" title={runs.length ? t('Eşleşen kayıt yok') : t('Kayıt yok')}>
                  {runs.length ? t('Arama ya da filtreyi genişletin.') : t('Her gönderim, Git gönderimi, senkron ve geri alma burada hedef hedef listelenir.')}
                </Empty>
              ) : (
                groupByDay(list).map((g) => (
                  <div key={g.day} className="history-group">
                    <div className="history-day">{dayLabel(g.day)}</div>
                    {g.runs.map((r) => {
                  const O = ORIGIN[r.origin];
                  return (
                    <button key={r.id} className={cls('history-item', current?.id === r.id && 'active')} onClick={() => setActive(r.id)}>
                      <StatusIcon status={r.status} />
                      <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="ellipsis" style={{ fontWeight: 580 }}>
                            {r.label}
                          </span>
                          {tagOf(r.id) && (
                            <span className="badge violet" data-tip={t('Sürüm noktası: makineler bu duruma geri getirilebilir')}>
                              <Tag size={10} /> {tagOf(r.id)!.name}
                            </span>
                          )}
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
                })}
                  </div>
                ))
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
    await st.addSendPaths(summary.sources, summary.sourceRels);
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
        {(summary.origin === 'send' || summary.origin === 'git') && !summary.dryRun && summary.opsOk > 0 && (
          <ReleasePointActions summary={summary} />
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
      <div ref={parent} className="pane-scroll" tabIndex={0} role="region" aria-label={summary.label} style={{ borderTop: '1px solid var(--border)' }}>
        {tab === 'targets' &&
          summary.targets.map((tg) => (
            <div key={tg.key} className="list-row" style={{ height: 'auto', minHeight: 46, padding: '8px 14px' }}>
              <StatusIcon status={tg.status} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <MachineName name={tg.title} layout="inline" />
                  {tg.deferred && <span className="badge amber">{t('kuyrukta')}</span>}
                </div>
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

const NO_TAGS: ReleaseTag[] = [];

/**
 * A run named as a release point, and the way back to it: every later send to its machines is undone from the
 * backups, newest first. The names live in this machine's settings, next to the history they belong to.
 */
function ReleasePointActions({ summary }: { summary: RunSummary }) {
  const tags = useApp((s) => s.boot?.settings.releaseTags ?? NO_TAGS);
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const tag = tags.find((x) => x.runId === summary.id);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [back, setBack] = useState<{ later: RunSummary[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    await saveSettings({ releaseTags: [...tags.filter((x) => x.runId !== summary.id), { runId: summary.id, name: n, at: Date.now() }] });
    setNaming(false);
    toast('ok', t('Sürüm noktası kaydedildi'), n);
  };
  const remove = async () => {
    await saveSettings({ releaseTags: tags.filter((x) => x.runId !== summary.id) });
  };
  const askBack = async () => {
    const all = await api.runs();
    const machines = new Set(summary.targetIds);
    const later = all.filter((r) => r.startedAt > summary.startedAt && (r.origin === 'send' || r.origin === 'git') && !r.dryRun && r.targetIds.some((id) => machines.has(id)));
    setBack({ later });
  };
  const goBack = async () => {
    setBusy(true);
    try {
      const r = await api.restoreToTag(summary.id, true);
      setBack(null);
      if (r.skipped.length) toast('warn', t('{n} gönderim geri alındı, {skipped} atlandı', { n: r.restored, skipped: r.skipped.length }), r.skipped.join('\n'));
      else toast('ok', t('{name} noktasına dönüldü', { name: tag?.name ?? summary.label }), t('{n} gönderim geri alındı', { n: r.restored }));
    } catch (e) {
      toast('error', t('Geri dönülemedi'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {tag ? (
        <>
          <span className="badge violet" data-tip={t('Sürüm noktası, {ago} işaretlendi', { ago: ago(tag.at) })}>
            <Tag size={10} /> {tag.name}
          </span>
          <Button size="sm" icon={<RotateCcw size={13} />} tip={t('Bu makinelere bundan sonra giden her gönderimi yedeklerinden geri alır, en yenisinden başlayarak')} onClick={() => void askBack()}>
            {t('Bu noktaya dön…')}
          </Button>
          <Button size="sm" variant="ghost" iconOnly icon={<XCircle size={13} />} tip={t('Sürüm noktasını kaldır')} onClick={() => void remove()} />
        </>
      ) : (
        <Button size="sm" icon={<Tag size={13} />} tip={t('Bu gönderimi sürüm noktası olarak adlandır; makineler sonradan bu duruma geri getirilebilir')} onClick={() => setNaming(true)}>
          {t('Sürüm noktası…')}
        </Button>
      )}
      {naming && (
        <Modal
          title={t('Sürüm noktası')}
          icon={<Tag size={16} />}
          onClose={() => setNaming(false)}
          footer={
            <>
              <Button onClick={() => setNaming(false)}>{t('Vazgeç')}</Button>
              <Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>
                {t('Kaydet')}
              </Button>
            </>
          }
        >
          <Field label={t('Ad')} help={t('Örneğin bir sürüm numarası ya da tarih. Geri dönüş bu gönderimin yedeklerine ve sonrakilerin yedeklerine dayanır; yedek alınmadan yapılan gönderimler geri alınamaz.')}>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder={summary.label} />
          </Field>
        </Modal>
      )}
      {back && (
        <Modal
          title={t('{name} noktasına dön', { name: tag?.name ?? summary.label })}
          icon={<RotateCcw size={16} />}
          onClose={() => setBack(null)}
          closeOnScrim={!busy}
          footer={
            <>
              <Button onClick={() => setBack(null)} disabled={busy}>
                {t('Vazgeç')}
              </Button>
              <Button variant="danger" loading={busy} disabled={!back.later.length} onClick={() => void goBack()}>
                {t('{n} gönderimi geri al', { n: back.later.length })}
              </Button>
            </>
          }
        >
          {back.later.length ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {t('Bu makinelere bu noktadan sonra giden gönderimler, en yenisinden başlayarak yedeklerinden geri alınır. Şimdiki hâller de yedeklenir. Yedek almadan yapılmış bir gönderim atlanır ve sonuçta belirtilir.')}
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                {back.later.slice(0, 12).map((r) => (
                  <li key={r.id}>
                    {r.label} • {ago(r.startedAt)} • {t('{n} hedef', { n: r.targetIds.length })}
                    {!r.options?.backup && <span className="badge amber" style={{ marginLeft: 6 }}>{t('yedeksiz')}</span>}
                  </li>
                ))}
                {back.later.length > 12 && <li>…</li>}
              </ul>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{t('Bu noktadan sonra bu makinelere giden bir gönderim yok; makineler zaten bu durumda.')}</p>
          )}
        </Modal>
      )}
    </>
  );
}
