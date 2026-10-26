import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Loader2, Minimize2, X, Copy, FileSpreadsheet, Square, Clock, FlaskConical, AlertTriangle, CircleDashed, Activity, Pause, Play, RotateCcw, Lock, PowerOff } from 'lucide-react';
import type { HolderReport, NodeConfig, RunTargetState, RunLogLine } from '@shared/types';
import { useApp, type LiveRun } from '../store/app';
import { Button, Progress, SearchInput, Segmented, useEscapeLayer } from './ui';
import { Sparkline } from './charts';
import { MachineName } from './MachineName';
import { ErrorHint } from './ErrorHint';
import { api } from '../lib/api';
import { ratesPerSecond } from '../lib/rates';
import { bytes, cls, duration, num } from '../lib/format';
import { tx } from '../lib/i18n';
import { locale, t } from '@shared/i18n';
import { askConfirm } from './ConfirmDialog';

export function StatusIcon({ status, size = 16 }: { status: RunTargetState['status']; size?: number }) {
  if (status === 'running') return <Loader2 size={size} className="spin" color="var(--accent)" />;
  if (status === 'ok') return <CheckCircle2 size={size} color="var(--green)" />;
  if (status === 'failed') return <XCircle size={size} color="var(--red)" />;
  if (status === 'partial') return <AlertTriangle size={size} color="var(--amber)" />;
  if (status === 'cancelled') return <MinusCircle size={size} color="var(--text-3)" />;
  return <CircleDashed size={size} color="var(--text-3)" />;
}

/**
 * The programs that held the files a run could not replace, asked on each machine when the run window opens on it;
 * where SamSync there allows it (or on this machine), they can be closed and the files written again.
 */
function HoldersBox({ runId }: { runId: string }) {
  const toast = useApp((s) => s.toast);
  const [reports, setReports] = useState<HolderReport[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setReports(null);
    api
      .whoHolds(runId)
      .then((r) => alive && setReports(r))
      .catch(() => alive && setReports([]));
    return () => {
      alive = false;
    };
  }, [runId]);
  const closeAndRetry = async (r: HolderReport) => {
    const progs = r.programs.filter((p) => p.closable !== false);
    if (!progs.length) return;
    if (!(await askConfirm(t('{machine} makinesinde {names} kapatılsın ve kullanımdaki dosyalar yeniden yazılsın mı? O programlardaki kaydedilmemiş işler kaybolabilir.', { machine: r.title, names: progs.map((p) => p.name).join(', ') }), { danger: true }))) return;
    setClosing(r.key);
    try {
      const c = await api.closeHolders(runId, r.key, progs.map((p) => p.pid));
      if (c.failed.length) toast('warn', t('{n} program kapatılamadı', { n: c.failed.length }), c.failed.join('\n'));
      useApp.getState().watchRun(await api.retryInUse(runId));
    } catch (e) {
      toast('error', t('Kapat ve tekrar dene'), (e as Error).message);
    } finally {
      setClosing(null);
    }
  };
  return (
    <div className="holders-box">
      <div className="row" style={{ gap: 6, fontWeight: 600, fontSize: 12.5 }}>
        <Lock size={13} color="var(--amber)" />
        {t('Dosyaları açık tutan programlar')}
        {!reports && <Loader2 size={13} className="spin faint" />}
      </div>
      {reports?.map((r) => (
        <div key={r.key} className="holders-row">
          <MachineName name={r.title} size="sm" />
          <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
            {r.error ? (
              <span className="faint" style={{ fontSize: 12 }}>
                {r.error}
              </span>
            ) : r.programs.length ? (
              r.programs.map((p) => (
                <span key={p.pid} className="truncate" style={{ fontSize: 12 }} data-tip={[p.path, ...p.rels.slice(0, 12)].filter(Boolean).join('\n')}>
                  <b>{p.name}</b> <span className="faint">PID {p.pid} • {t('{n} dosya', { n: p.rels.length })}</span>
                </span>
              ))
            ) : (
              <span className="faint" style={{ fontSize: 12 }}>
                {t('Şu an hiçbir program tutmuyor; tekrar denemek yeter')}
              </span>
            )}
          </div>
          {r.programs.some((p) => p.closable !== false) && (
            <Button
              size="sm"
              icon={<PowerOff size={12} />}
              disabled={!r.canClose}
              loading={closing === r.key}
              tip={r.canClose ? t('Bu programları kapatır, sonra kullanımdaki dosyaları yeniden yazar') : t('O makinede Ayarlar › Ajan › Gönderenler dosyayı tutan programı kapatabilsin açık değil')}
              onClick={() => void closeAndRetry(r)}
            >
              {t('Kapat ve tekrar dene')}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** How the command after the copy (or after applying, on the machine) ended: a small health-check badge. */
export function CheckBadge({ check }: { check: NonNullable<RunTargetState['check']> }) {
  const tip = [`${check.label}${check.there ? ` (${t('makinede')})` : ''}: ${t('kod {code}', { code: String(check.code) })}`, check.output].filter(Boolean).join('\n');
  return (
    <span className={cls('badge', check.ok ? 'green' : 'red')} data-tip={tip}>
      {check.ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {t('denetim')}
    </span>
  );
}

/** The second stage of a staged send, waiting for a go (or stopped because a first machine did not go through). */
function StagedBox({ runId }: { runId: string }) {
  const staged = useApp((s) => s.staged[runId]);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // after a reload the event is gone: ask once
    if (!useApp.getState().staged[runId]) void api.stagedSend(runId).then((st) => st && useApp.setState((s) => ({ staged: { ...s.staged, [runId]: st } })));
  }, [runId]);
  if (!staged || (staged.status !== 'waiting' && staged.status !== 'stopped')) return null;
  const go = async () => {
    setBusy(true);
    try {
      useApp.getState().watchRun(await api.continueStaged(runId));
    } catch (e) {
      toast('error', t('Kalanlara gönderilemedi'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const names = staged.rest.map((r) => r.name).join(', ');
  return (
    <div className={cls('staged-box', staged.firstOk ? 'ok' : 'bad')}>
      <div className="grow">
        <b>{staged.firstOk ? t('İlk aşama tamam') : t('İlk aşama hatalı: gönderim durdu')}</b>
        <div className="faint" style={{ fontSize: 12 }} data-tip={names}>
          {t('Kalan {n} makine bekliyor: {names}', { n: staged.rest.length, names: staged.rest.slice(0, 4).map((r) => r.name).join(', ') + (staged.rest.length > 4 ? '…' : '') })}
        </div>
      </div>
      <Button onClick={() => void api.dropStaged(runId)}>{t('Vazgeç')}</Button>
      <Button variant={staged.firstOk ? 'primary' : 'danger'} icon={<Play size={13} />} loading={busy} onClick={() => void go()}>
        {staged.firstOk ? t('Kalanlara gönder') : t('Yine de kalanlara gönder')}
      </Button>
    </div>
  );
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

/** Bytes per second over a span, once enough has gone by to mean something. */
function rate(bytesDone: number, ms: number): number | undefined {
  return ms >= 800 && bytesDone > 0 ? (bytesDone / ms) * 1000 : undefined;
}

function speedText(bps: number | undefined): string {
  return bps == null ? '' : t('{speed}/sn', { speed: bytes(bps) });
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

/** The last minute of throughput: the line, and now / peak / average under it. */
function Throughput({ run, now }: { run: LiveRun; now: number }) {
  const end = run.done ? (run.summary.finishedAt ?? now) : now;
  const rates = useMemo(() => ratesPerSecond(run.samples, end, 60), [run.samples, end]);
  if (rates.length < 3) return null;
  const peak = Math.max(...rates);
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const current = rates[rates.length - 1];
  const stalled = !run.done && rates.length >= 5 && rates.slice(-5).every((r) => r === 0);
  return (
    <div className="run-chart">
      <div className="row" style={{ fontSize: 11.5, marginBottom: 4 }}>
        <span className="muted row" style={{ gap: 4 }}>
          <Activity size={12} /> {t('Hız, son {n} sn', { n: rates.length })}
        </span>
        <span className="spacer" />
        {stalled ? (
          <span className="badge amber">{t('bekliyor')}</span>
        ) : (
          <span className="tabular" style={{ fontWeight: 600 }}>
            {speedText(current)}
          </span>
        )}
        <span className="faint tabular" style={{ marginLeft: 10 }}>
          {t('tepe {speed}', { speed: speedText(peak) })} • {t('ort. {speed}', { speed: speedText(avg) })}
        </span>
      </div>
      <Sparkline values={rates} height={44} color={stalled ? 'var(--amber)' : 'var(--accent)'} />
    </div>
  );
}

/** Per group: how many of its machines are done, so "Lab-A 3/5" reads at a glance. */
function GroupChips({ run }: { run: LiveRun }) {
  const nodes = useApp((s) => s.boot?.config.nodes);
  const groups = useMemo(() => {
    const byId = new Map((nodes ?? []).map((n) => [n.id, n.group || '']));
    const m = new Map<string, { total: number; done: number; failed: number; running: number }>();
    for (const x of run.targets) {
      const g = byId.get(x.key) || '';
      if (!g) continue;
      const e = m.get(g) ?? { total: 0, done: 0, failed: 0, running: 0 };
      e.total++;
      if (x.status === 'ok') e.done++;
      else if (x.status === 'failed' || x.status === 'partial') e.failed++;
      else if (x.status === 'running') e.running++;
      m.set(g, e);
    }
    return [...m.entries()].filter(([, e]) => e.total > 1);
  }, [nodes, run.targets]);
  if (!groups.length) return null;
  return (
    <div className="run-groups">
      {groups.map(([g, e]) => (
        <span key={g} className={cls('chip static', e.failed ? 'bad' : e.done === e.total ? 'ok' : e.running ? 'hot' : '')}>
          <b>{g}</b>
          <span className="tabular">
            {e.done + e.failed}/{e.total}
          </span>
          {e.failed > 0 && <span style={{ color: 'var(--red)' }}>{t('{n} hata', { n: e.failed })}</span>}
        </span>
      ))}
    </div>
  );
}

const NO_NODES: NodeConfig[] = [];

/** node id -> its group, for the group name in front of each machine of a run */
export function useGroupOf(): Map<string, string> {
  const nodes = useApp((s) => s.boot?.config.nodes ?? NO_NODES);
  return useMemo(() => new Map(nodes.filter((n) => n.group).map((n) => [n.id, n.group!])), [nodes]);
}

export function RunPanel() {
  const groupOf = useGroupOf();
  const runs = useApp((s) => s.runs);
  const activeId = useApp((s) => s.activeRunId);
  const open = useApp((s) => s.runPanel);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const run = activeId ? runs[activeId] : undefined;
  const now = useNow(!!run && !run.done && open);
  const [logFilter, setLogFilter] = useState<'all' | 'errors'>('all');
  const [logQuery, setLogQuery] = useState('');
  /** The run a cancel was asked for: the button says so until the run ends (a relay may take a few seconds to stop). */
  const [cancelAsked, setCancelAsked] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEscapeLayer(() => useApp.setState({ runPanel: false }), open && !!run);
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [run?.log.length, logFilter]);

  if (!open || !run) return null;
  const s = run.summary;
  /** A run that was cancelled or went wrong can be tried again: the same sources to the failed machines (every one after a cancel), with the review first. */
  const canRetry = run.done && s.status !== 'ok' && (s.origin === 'send' || s.origin === 'git') && s.sources.length > 0;
  const retry = async () => {
    const st = useApp.getState();
    const failed = s.targets.filter((x) => x.status === 'failed' || x.status === 'partial').map((x) => x.key);
    const targets = s.status === 'cancelled' || !failed.length ? s.targetIds : failed;
    useApp.setState({ runPanel: false, activeRunId: undefined });
    st.setPage('send');
    await st.newWorkspace({ name: s.label, paths: s.sources, rels: s.sourceRels, targets });
    await useApp.getState().startPlan({ sources: useApp.getState().sendSources(), origin: 'send', targetIds: targets, label: s.label });
  };
  const tot = totals(run);
  const elapsed = (run.done ? s.finishedAt ?? now : now) - s.startedAt;
  // the pace so far and what it leaves: the network to the machines is often the slow part
  const pace = rate(tot.bd, elapsed);
  const remaining = !run.done && pace && tot.bt > tot.bd ? ((tot.bt - tot.bd) / pace) * 1000 : undefined;
  const titleFor = (key?: string) => (key ? run.targets.find((x) => x.key === key)?.title ?? key : '');
  const q = logQuery.trim().toLocaleLowerCase(locale());
  const log = run.log.filter((l) => (logFilter === 'all' || l.level === 'error' || l.level === 'warn') && (!q || l.message.toLocaleLowerCase(locale()).includes(q) || (!!l.key && titleFor(l.key).toLocaleLowerCase(locale()).includes(q))));

  const copyLog = () => {
    const text = run.log.map((l) => `${new Date(l.t).toLocaleTimeString(locale())} [${l.level}]${l.key ? ` [${titleFor(l.key)}]` : ''} ${l.message}`).join('\n');
    void navigator.clipboard.writeText(text);
    toast('ok', t('Günlük panoya kopyalandı'));
  };

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && useApp.setState({ runPanel: false })}>
      <aside className="drawer">
        <div className="drawer-head">
          <div className={cls('icon-tile lg', !run.done && 'accent')}>{run.done ? <StatusIcon status={s.status} size={19} /> : run.paused ? <Pause size={19} /> : <Loader2 size={19} className="spin" />}</div>
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
                  : run.paused
                    ? t('Duraklatıldı')
                    : t('Çalışıyor')}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <Clock size={12} /> {duration(elapsed)}
              </span>
              {pace != null && <span className="tabular">{speedText(pace)}</span>}
              {remaining != null && <span className="tabular">{t('kalan {time}', { time: duration(Math.round(remaining)) })}</span>}
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
          {!s.dryRun && <Throughput run={run} now={now} />}
          <GroupChips run={run} />
        </div>

        <div className="drawer-targets">
          {run.targets.map((x) => {
            const pct = x.bytesTotal > 0 ? (x.bytesDone / x.bytesTotal) * 100 : x.total ? (x.done / x.total) * 100 : x.status === 'ok' ? 100 : 0;
            // a running target shows its pace; a finished one its average, so a slow machine stands out
            const own = x.startedAt ? rate(x.bytesDone, (x.finishedAt ?? now) - x.startedAt) : undefined;
            return (
              <div key={x.key} className="run-target">
                <StatusIcon status={x.status} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row">
                    {groupOf.get(x.key) && <span className="run-group">{groupOf.get(x.key)}</span>}
                    <MachineName name={x.title} layout="inline" className="ellipsis" />
                    {x.deferred && (
                      <span className="badge amber" data-tip={t('Makine kapalıydı; röle açılınca teslim edecek')}>
                        <Clock size={10} /> {t('kuyrukta')}
                      </span>
                    )}
                    {x.check && <CheckBadge check={x.check} />}
                    <span className="spacer" />
                    <span className="faint tabular" style={{ fontSize: 11.5 }}>
                      {x.done}/{x.total}
                      {own != null && x.status !== 'queued' && ` • ${speedText(own)}`}
                      {x.failed > 0 && <span style={{ color: 'var(--red)' }}> • {t('{n} hata', { n: x.failed })}</span>}
                    </span>
                    {!run.done && !x.via && (x.status === 'running' || x.status === 'queued') && (
                      <Button variant="ghost" iconOnly size="sm" className="run-target-x" icon={<X size={12} />} tip={t('Bu hedefi çalıştırmadan çıkar; diğerleri sürer')} onClick={() => void api.cancelRunTarget(s.id, x.key)} />
                    )}
                  </div>
                  <div style={{ margin: '5px 0 3px' }}>
                    <Progress value={x.status === 'queued' ? 0 : pct} state={x.status === 'ok' ? 'ok' : x.status === 'failed' || x.status === 'partial' ? 'bad' : undefined} />
                  </div>
                  <div className="faint mono ellipsis" style={{ fontSize: 11 }} title={x.error ? x.error : x.current ? x.current : x.root}>
                    {x.error ? <span style={{ color: 'var(--red)' }}>{x.error}</span> : x.current ? x.current : x.backupPath ? t('yedek: {path}', { path: x.backupPath }) : x.via ? t('{relay} üzerinden', { relay: run.targets.find((y) => y.key === x.via && !y.via)?.title ?? x.via }) : x.root}
                  </div>
                  {(x.status === 'failed' || x.status === 'partial') && <ErrorHint error={x.error} />}
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
          <SearchInput value={logQuery} onChange={setLogQuery} placeholder={t('Günlükte ara')} style={{ width: 180 }} />
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

        {run.done && <StagedBox runId={s.id} />}
        {run.done && (s.inUseFailed ?? 0) > 0 && <HoldersBox runId={s.id} />}
        <div className="drawer-foot">
          {!run.done ? (
            <>
              <Button icon={run.paused ? <Play size={13} /> : <Pause size={13} />} disabled={cancelAsked === s.id} tip={run.paused ? undefined : t('Dosyalar arasında bekler; süren kopya da durur')} onClick={() => void api.pauseRun(s.id, !run.paused)}>
                {run.paused ? t('Sürdür') : t('Duraklat')}
              </Button>
              <Button
                variant="danger"
                icon={cancelAsked === s.id ? <Loader2 size={13} className="spin" /> : <Square size={13} />}
                disabled={cancelAsked === s.id}
                onClick={() => {
                  setCancelAsked(s.id);
                  void api.cancelRun(s.id);
                }}
              >
                {cancelAsked === s.id ? t('İptal ediliyor…') : t('İptal et')}
              </Button>
            </>
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
          {run.done && (s.inUseFailed ?? 0) > 0 && (
            <Button
              icon={<RotateCcw size={14} />}
              tip={t('Hedefte bir programın açık tuttuğu {n} dosyayı aynı makinelere yeniden yazar, inceleme olmadan. Önce programı kapatın.', { n: s.inUseFailed! })}
              onClick={async () => {
                try {
                  useApp.getState().watchRun(await api.retryInUse(s.id));
                } catch (e) {
                  toast('error', t('Kullanımdakileri tekrar dene'), (e as Error).message);
                }
              }}
            >
              {t('Kullanımdakileri tekrar dene')}
            </Button>
          )}
          {canRetry && (
            <Button variant="primary" icon={<RotateCcw size={14} />} tip={s.status === 'cancelled' ? t('Aynı kaynakları aynı makinelere yeniden planlar; zaten gitmiş olanlar atlanır') : t('Aynı kaynakları yalnızca hatalı biten makinelere yeniden planlar')} onClick={() => void retry()}>
              {t('Yeniden dene')}
            </Button>
          )}
          <Button variant={run.done && !canRetry ? 'primary' : 'default'} onClick={() => useApp.setState({ runPanel: false })}>
            {run.done ? t('Kapat') : t('Arka planda sürdür')}
          </Button>
        </div>
      </aside>
    </div>
  );
}
