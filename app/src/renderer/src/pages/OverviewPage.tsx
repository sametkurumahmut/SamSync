// The first screen: how the machines are, what was sent lately, what the automation is doing, and the
// quick sends, so the day's question ("did the release reach everyone?") is answered without a click.
import { useEffect, useMemo, useState } from 'react';
import { Server, Send, Zap, History, Boxes, Share2, Download, AlertTriangle, ArrowRight, Clock, Activity } from 'lucide-react';
import type { InventoryRow, RunSummary } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button } from '../components/ui';
import { StatusIcon } from '../components/RunPanel';
import { Topology } from '../components/Topology';
import { Sparkline } from '../components/charts';
import { ago, bytes, cls, num } from '../lib/format';
import { t } from '@shared/i18n';
import { machineTitle } from '@shared/machine';

const NO_QUICK: never[] = [];
const DAY = 86400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function OverviewPage() {
  const boot = useApp((s) => s.boot!);
  const probes = useApp((s) => s.probes);
  const automation = useApp((s) => s.automation);
  const relayState = useApp((s) => s.relayState);
  const update = useApp((s) => s.update);
  const quick = useApp((s) => s.boot?.settings.quickSends) ?? NO_QUICK;
  const runQuick = useApp((s) => s.runQuickSend);
  const setPage = useApp((s) => s.setPage);
  const historyVersion = useApp((s) => s.historyVersion);
  const live = useApp((s) => s.runs);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null);

  useEffect(() => {
    void api.runs().then(setRuns).catch(() => setRuns([]));
  }, [historyVersion]);
  useEffect(() => {
    // the manifests over the network, after the rest of the page is up
    const timer = setTimeout(() => void api.inventory().then(setInventory).catch(() => setInventory([])), 600);
    return () => clearTimeout(timer);
  }, [historyVersion]);

  const localId = boot.identity.node?.id;
  const machines = boot.config.nodes.filter((n) => n.enabled && n.id !== localId);
  const reachable = machines.filter((n) => probes[n.id]?.ok).length;
  const down = machines.filter((n) => probes[n.id] && !probes[n.id]!.ok);
  const active = Object.values(live).filter((r) => !r.done);

  const stats = useMemo(() => {
    const list = runs ?? [];
    const now = Date.now();
    const today = startOfDay(now);
    const todayRuns = list.filter((r) => r.startedAt >= today && !r.dryRun);
    const week = list.filter((r) => r.startedAt >= now - 7 * DAY && !r.dryRun);
    // bytes per day for the last 14 days, for the small chart
    const days: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const from = today - i * DAY;
      days.push(list.filter((r) => !r.dryRun && r.startedAt >= from && r.startedAt < from + DAY).reduce((a, r) => a + r.bytes, 0));
    }
    return {
      todayBytes: todayRuns.reduce((a, r) => a + r.bytes, 0),
      todayOps: todayRuns.reduce((a, r) => a + r.opsOk, 0),
      todayRuns: todayRuns.length,
      weekFailed: week.filter((r) => r.status === 'failed' || r.status === 'partial').length,
      weekRuns: week.length,
      days,
      last: list.slice(0, 8),
    };
  }, [runs]);

  const inv = useMemo(() => {
    if (!inventory) return null;
    const folders = new Map<string, { newest: number; by: Map<string, number> }>();
    for (const r of inventory) for (const e of r.entries) {
      const f = folders.get(e.rel) ?? { newest: 0, by: new Map() };
      f.newest = Math.max(f.newest, e.writtenAt);
      f.by.set(r.nodeId, e.writtenAt);
      folders.set(e.rel, f);
    }
    let behind = 0;
    let missing = 0;
    for (const f of folders.values()) for (const r of inventory) {
      if (!r.reachable) continue;
      const at = f.by.get(r.nodeId);
      if (at == null) missing++;
      else if (f.newest - at > 10 * 60_000) behind++;
    }
    return { folders: folders.size, behind, missing, unreachable: inventory.filter((r) => !r.reachable).length };
  }, [inventory]);

  const watches = automation?.watches ?? [];
  const schedules = automation?.schedules ?? [];
  const autoActive = watches.filter((w) => w.enabled).length + schedules.filter((s) => s.enabled && s.activeHere).length;
  const autoBusy = watches.some((w) => w.status === 'sending') || schedules.some((s) => s.running);
  const updateHot = update && (update.phase === 'available' || update.phase === 'ready' || update.phase === 'downloading');

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Genel bakış')}</h1>
          <div className="sub">{t('Makineler, son gönderimler, otomasyon ve röle: bir bakışta.')}</div>
        </div>
        <Button variant="primary" icon={<Send size={15} />} onClick={() => setPage('send')}>
          {t('Gönder')}
        </Button>
      </div>
      <div className="page-body">
        <div className="ov-tiles">
          <button className={cls('ov-tile', down.length > 0 && 'warn')} onClick={() => setPage('targets')}>
            <div className="ov-tile-head">
              <Server size={14} /> {t('Makineler')}
            </div>
            <div className="ov-tile-value">
              {reachable}
              <span className="faint">/{machines.length}</span>
            </div>
            <div className="ov-tile-sub ellipsis">{down.length ? t('erişilemeyen: {names}', { names: down.map((n) => machineTitle(n.name, n.address)).join(', ') }) : machines.length ? t('hepsi erişilebilir') : t('hedef tanımlı değil')}</div>
          </button>
          <button className="ov-tile" onClick={() => setPage('history')}>
            <div className="ov-tile-head">
              <Activity size={14} /> {t('Bugün')}
            </div>
            <div className="ov-tile-value">{bytes(stats.todayBytes)}</div>
            <div className="ov-tile-sub">{t('{runs} gönderim • {ops} işlem', { runs: stats.todayRuns, ops: num(stats.todayOps) })}</div>
            <Sparkline values={stats.days} height={26} baseline={false} className="ov-spark" />
          </button>
          <button className={cls('ov-tile', stats.weekFailed > 0 && 'bad')} onClick={() => setPage('history')}>
            <div className="ov-tile-head">
              <AlertTriangle size={14} /> {t('Son 7 gün')}
            </div>
            <div className="ov-tile-value">
              {stats.weekFailed}
              <span className="faint">/{stats.weekRuns}</span>
            </div>
            <div className="ov-tile-sub">{stats.weekFailed ? t('hatalı ya da kısmi gönderim') : t('hatasız')}</div>
          </button>
          <button className={cls('ov-tile', automation?.paused && 'warn', autoBusy && 'hot')} onClick={() => setPage('automation')}>
            <div className="ov-tile-head">
              <Zap size={14} /> {t('Otomasyon')}
            </div>
            <div className="ov-tile-value">{automation?.paused ? '❚❚' : autoActive}</div>
            <div className="ov-tile-sub">{automation?.paused ? t('duraklatıldı') : autoBusy ? t('şu an gönderiyor') : t('{w} izleme • {s} zamanlanmış', { w: watches.filter((w) => w.enabled).length, s: schedules.filter((s) => s.enabled && s.activeHere).length })}</div>
          </button>
          <button className={cls('ov-tile', !!inv && inv.behind + inv.missing > 0 && 'warn')} onClick={() => setPage('targets')}>
            <div className="ov-tile-head">
              <Boxes size={14} /> {t('Envanter')}
            </div>
            <div className="ov-tile-value">{inv ? (inv.behind || inv.missing ? inv.behind + inv.missing : '✓') : '…'}</div>
            <div className="ov-tile-sub">{inv ? (inv.folders ? (inv.behind || inv.missing ? t('{b} geride, {m} eksik', { b: inv.behind, m: inv.missing }) : t('{n} klasör, hepsi aynı', { n: inv.folders })) : t('manifest yok')) : t('okunuyor…')}</div>
          </button>
          {(relayState?.active || updateHot) && (
            <button className={cls('ov-tile', updateHot && 'hot')} onClick={() => setPage(updateHot ? 'settings' : 'targets')}>
              <div className="ov-tile-head">{updateHot ? <Download size={14} /> : <Share2 size={14} />} {updateHot ? t('Güncelleme') : t('Röle')}</div>
              <div className="ov-tile-value" style={{ fontSize: 18 }}>
                {updateHot ? `v${update!.version ?? ''}` : t('açık')}
              </div>
              <div className="ov-tile-sub">{updateHot ? (update!.phase === 'ready' ? t('kurulmaya hazır') : update!.phase === 'downloading' ? t('indiriliyor %{pct}', { pct: Math.round(update!.percent ?? 0) }) : t('yeni sürüm var')) : relayState?.pending?.length ? t('{n} makine kuyrukta', { n: relayState.pending.length }) : relayState?.jobs ? t('{n} iş, son {ago}', { n: relayState.jobs, ago: ago(relayState.lastJobAt) }) : t('henüz iş gelmedi')}</div>
            </button>
          )}
        </div>

        <div className="ov-grid">
          <div className="card ov-topology">
            <div className="card-head">
              <div className="icon-tile accent">
                <Share2 size={15} />
              </div>
              <h2>{t('Ağ görünümü')}</h2>
              <span className="faint" style={{ fontSize: 12 }}>
                {t('Tıkla: gönderim hedefi seç • Sürükle: gruba taşı')}
              </span>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={<ArrowRight size={13} />} onClick={() => setPage('targets')}>
                {t('Hedefler')}
              </Button>
            </div>
            <div className="card-body" style={{ padding: 10 }}>
              {machines.length ? <Topology /> : <div className="faint" style={{ padding: 12 }}>{t('Henüz makine tanımlı değil.')}</div>}
            </div>
          </div>

          <div className="card ov-runs">
            <div className="card-head">
              <div className="icon-tile">
                <History size={15} />
              </div>
              <h2>{t('Son gönderimler')}</h2>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={<ArrowRight size={13} />} onClick={() => setPage('history')}>
                {t('Geçmiş')}
              </Button>
            </div>
            <div className="ov-list">
              {active.map((r) => (
                <button key={r.summary.id} className="ov-run hot" onClick={() => useApp.setState({ activeRunId: r.summary.id, runPanel: true })}>
                  <StatusIcon status="running" size={15} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {r.summary.label}
                    </div>
                    <div className="faint" style={{ fontSize: 11.5 }}>
                      {t('sürüyor')} • {t('{n} hedef', { n: r.targets.length })}
                    </div>
                  </div>
                </button>
              ))}
              {stats.last.map((r) => (
                <button key={r.id} className="ov-run" onClick={() => setPage('history')}>
                  <StatusIcon status={r.status} size={15} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {r.label}
                      {r.dryRun && <span className="badge amber" style={{ marginLeft: 6 }}>{t('deneme')}</span>}
                    </div>
                    <div className="faint ellipsis" style={{ fontSize: 11.5 }}>
                      {r.targets.map((x) => machineTitle(x.title)).join(', ')}
                    </div>
                  </div>
                  <div className="faint tabular nowrap" style={{ fontSize: 11.5, textAlign: 'right' }}>
                    <div>{bytes(r.bytes)}</div>
                    <div>{ago(r.startedAt)}</div>
                  </div>
                </button>
              ))}
              {runs && !stats.last.length && !active.length && (
                <div className="faint" style={{ padding: 14, fontSize: 12.5 }}>
                  {t('Henüz gönderim yapılmadı.')}
                </div>
              )}
            </div>
          </div>

          <div className="card ov-quick">
            <div className="card-head">
              <div className="icon-tile">
                <Zap size={15} />
              </div>
              <h2>{t('Hızlı gönderimler')}</h2>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={<ArrowRight size={13} />} onClick={() => setPage('send')}>
                {t('Gönder')}
              </Button>
            </div>
            <div className="card-body">
              {quick.length ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {quick.map((q) => (
                    <button key={q.id} className="chip" onClick={() => runQuick(q)} data-tip={t('{n} kaynak → {targets} hedef{review}', { n: q.paths.length, targets: q.targetIds.length, review: q.review ? ` • ${t('inceleyerek')}` : '' })}>
                      <Send size={12} /> {q.name}
                      {q.hotkey && <span className="kbd">{q.hotkey}</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {t('Gönder sayfasında bir listeyi adıyla kaydedin; burada tek tıkla çalışır.')}
                </div>
              )}
            </div>
          </div>

          <div className="card ov-auto">
            <div className="card-head">
              <div className="icon-tile">
                <Clock size={15} />
              </div>
              <h2>{t('İzlemeler ve zamanlanmış işler')}</h2>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={<ArrowRight size={13} />} onClick={() => setPage('automation')}>
                {t('Otomasyon')}
              </Button>
            </div>
            <div className="ov-list">
              {watches.map((w) => (
                <div key={w.id} className="ov-run static">
                  <span className={cls('dot', w.status === 'sending' ? 'pending' : w.enabled ? (w.lastStatus === 'failed' || w.lastStatus === 'partial' ? 'bad' : 'ok') : '')} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {w.name}
                    </div>
                    <div className="faint ellipsis" style={{ fontSize: 11.5 }}>
                      {w.status === 'sending' ? t('gönderiyor') : w.pendingFiles ? t('{n} dosya bekliyor', { n: w.pendingFiles }) : w.lastRunAt ? `${t('son')}: ${ago(w.lastRunAt)}` : t('henüz çalışmadı')}
                    </div>
                  </div>
                </div>
              ))}
              {schedules.map((s) => (
                <div key={s.jobId} className="ov-run static">
                  <span className={cls('dot', s.running ? 'pending' : s.enabled && s.activeHere ? 'ok' : '')} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {s.name}
                    </div>
                    <div className="faint ellipsis" style={{ fontSize: 11.5 }}>
                      {s.running ? t('çalışıyor') : s.nextAt ? `${t('sıradaki')}: ${ago(s.nextAt)}` : s.reason || t('bu makinede değil')}
                    </div>
                  </div>
                </div>
              ))}
              {!watches.length && !schedules.length && (
                <div className="faint" style={{ padding: 14, fontSize: 12.5 }}>
                  {t('İzleme ya da zamanlanmış iş yok.')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
