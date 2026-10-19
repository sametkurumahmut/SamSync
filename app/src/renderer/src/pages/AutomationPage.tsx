import { useState } from 'react';
import {
  Zap,
  Eye,
  Pause,
  Play,
  Plus,
  Trash2,
  Pencil,
  Clock,
  CalendarClock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CircleDashed,
  FolderOpen,
  FilePlus,
  X,
  Folder,
  File,
  History as HistoryIcon,
  WifiOff,
  MinusCircle,
  PanelBottomClose,
  ArrowRight,
  GitBranch,
  Settings2,
  Workflow,
  Send,
} from 'lucide-react';
import type { AutomationSettings, GitEvent, SendOptions, WatchConfig, WatchState, ScheduleState, SyncSchedule } from '@shared/types';
import { automationSettings, DEFAULT_GIT_EVENTS, DEFAULT_QUIET_MS } from '@shared/automation';
import { useApp, DEFAULT_OPTIONS } from '../store/app';
import { api } from '../lib/api';
import { Button, Checkbox, Empty, Field, Modal, PageSkeleton, Segmented, Switch, TagInput, ToggleRow } from '../components/ui';
import { TargetPicker, TargetSummary } from '../components/TargetPicker';
import { ago, baseName, cls, num } from '../lib/format';
import { t, tk, locale } from '@shared/i18n';
import { tx } from '../lib/i18n';
import { withoutMirror } from '@shared/options';
import { relsFor } from '@shared/sources';

function StatusPill({ status }: { status: WatchState['status'] }) {
  const map: Record<WatchState['status'], { label: string; cls: string; icon: React.ReactNode }> = {
    watching: { label: t('İzleniyor'), cls: 'green', icon: <Eye size={11} /> },
    pending: { label: t('Bekliyor'), cls: 'amber', icon: <Clock size={11} /> },
    sending: { label: t('Gönderiliyor'), cls: 'blue', icon: <Loader2 size={11} className="spin" /> },
    paused: { label: t('Duraklatıldı'), cls: '', icon: <Pause size={11} /> },
    error: { label: t('Hata'), cls: 'red', icon: <AlertTriangle size={11} /> },
  };
  const m = map[status];
  return (
    <span className={cls('badge', m.cls)}>
      {m.icon} {m.label}
    </span>
  );
}

function LastIcon({ s }: { s?: string }) {
  if (s === 'ok') return <CheckCircle2 size={14} color="var(--green)" />;
  if (s === 'failed' || s === 'partial') return <XCircle size={14} color="var(--red)" />;
  if (s === 'cancelled') return <MinusCircle size={14} className="faint" />;
  if (s === 'nothing') return <CheckCircle2 size={14} className="faint" />;
  return <CircleDashed size={14} className="faint" />;
}

export function describeSchedule(s?: SyncSchedule): string {
  if (!s) return t('Zamanlanmamış');
  if (s.mode === 'interval') return s.everyMinutes % 60 === 0 && s.everyMinutes >= 60 ? t('Her {n} saatte bir', { n: s.everyMinutes / 60 }) : t('Her {n} dakikada bir', { n: s.everyMinutes });
  return s.times.length ? t('Her gün {times}', { times: s.times.join(', ') }) : t('Saat seçilmedi');
}

function untilText(at0?: number): string {
  if (!at0) return '–';
  const d = at0 - Date.now();
  if (d <= 0) return t('şimdi');
  if (d < 60_000) return t('{n} sn sonra', { n: Math.ceil(d / 1000) });
  if (d < 3_600_000) return t('{n} dk sonra', { n: Math.round(d / 60_000) });
  const at = new Date(at0);
  const today = at.toDateString() === new Date().toDateString();
  const time = at.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return today ? t('bugün {time}', { time }) : t('yarın {time}', { time });
}

export function AutomationPage() {
  const automation = useApp((s) => s.automation);
  const boot = useApp((s) => s.boot!);
  const saveSettings = useApp((s) => s.saveSettings);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const [editing, setEditing] = useState<WatchConfig | 'new' | null>(null);

  if (!automation) return <PageSkeleton cards={0} rows={4} />;

  const configs = boot.settings.watches ?? [];
  const jobs = boot.config.syncJobs;
  const scheduled = automation.schedules;
  const unscheduled = jobs.filter((j) => !j.schedule);
  const anything = automation.watches.length + scheduled.length > 0;
  const settings = automationSettings(boot.settings);

  const pause = async (p: boolean) => {
    const a = await api.automationPause(p);
    useApp.setState({ automation: a });
    await saveSettings({ automationPaused: p });
  };
  const setWatch = async (id: string, patch: Partial<WatchConfig>) => {
    const a = await api.watchUpdate(id, patch);
    useApp.setState({ automation: a });
    await saveSettings({});
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Otomasyon')}</h1>
          <div className="sub">{t('Klasörleri izleyip değişiklikleri kendiliğinden gönderin; senkron işlerini belirli aralıklarla ya da saatlerde çalıştırın.')}</div>
        </div>
        {anything && (
          <Button size="lg" variant={automation.paused ? 'primary' : 'default'} icon={automation.paused ? <Play size={15} /> : <Pause size={15} />} onClick={() => void pause(!automation.paused)}>
            {automation.paused ? t('Otomasyonu sürdür') : t('Hepsini duraklat')}
          </Button>
        )}
      </div>
      <div className="page-body">
        {boot.isElectron && !boot.settings.closeToTray && anything && (
          <div className="alert info" style={{ marginBottom: 14 }}>
            <PanelBottomClose size={16} />
            <div className="grow">
              {t('Otomasyon yalnızca uygulama açıkken çalışır. Pencere kapanınca da sürmesi için uygulamayı sistem tepsisinde tutun.')}
            </div>
            <Button size="sm" onClick={() => void saveSettings({ closeToTray: true })}>
              {t('Tepside çalışmaya devam et')}
            </Button>
          </div>
        )}
        {automation.paused && anything && (
          <div className="alert warn" style={{ marginBottom: 14 }}>
            <Pause size={16} /> {t('Otomasyon duraklatıldı: izlemeler değişiklik toplamıyor, zamanlanmış işler çalışmıyor.')}
          </div>
        )}

        <div className="auto-section-head">
          <div className="icon-tile accent">
            <Eye size={15} />
          </div>
          <div className="grow">
            <h2>{t('Canlı izleme')}</h2>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {t('Dosya kaydedildiğinde ya da Git’te commit veya pull olduğunda birkaç saniye bekler, sonra yalnızca değişenleri seçili makinelere ya da klasörlere gönderir; istenirse bir senkron işini çalıştırır.')}
            </div>
          </div>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>
            {t('Yeni izleme')}
          </Button>
        </div>
        {automation.watches.length === 0 ? (
          <div className="card">
            <Empty art="watch" title={t('İzleme yok')} hint={tx('Örnek: {src} kaydedilince birkaç saniye sonra {grp} makinelerine gider', { src: <code>D:\Release\Config</code>, grp: <code>Lab-A</code> })} action={<Button icon={<Plus size={15} />} onClick={() => setEditing('new')}>{t('İzleme ekle')}</Button>}>
              {tx('Gönder sayfasında kaynakları ve hedefleri seçip {watch}’ye basabilir ya da buradan ekleyebilirsiniz.', { watch: <b>{t('İzle')}</b> })}
            </Empty>
          </div>
        ) : (
          <div className="auto-grid">
            {automation.watches.map((w) => {
              const cfg = configs.find((c) => c.id === w.id);
              return (
                <div key={w.id} className={cls('card auto-card', !w.enabled && 'disabled')}>
                  <div className="row" style={{ gap: 10 }}>
                    <StatusPill status={w.status} />
                    <b className="ellipsis grow" style={{ fontSize: 14 }}>
                      {w.name}
                    </b>
                    <Switch on={w.enabled} onChange={(v) => void setWatch(w.id, { enabled: v })} />
                  </div>
                  <div className="auto-paths">
                    {w.paths.slice(0, 4).map((p) => (
                      <div key={p} className="row mono ellipsis" style={{ fontSize: 11.5, gap: 6 }} title={p}>
                        <Folder size={12} className="faint" /> <span className="ellipsis">{p}</span>
                      </div>
                    ))}
                    {w.paths.length > 4 && <div className="faint" style={{ fontSize: 11.5 }}>{t('… ve {n} yol daha', { n: w.paths.length - 4 })}</div>}
                  </div>
                  {w.trigger === 'git' && (
                    <div className="row muted" style={{ fontSize: 12, gap: 6 }}>
                      <GitBranch size={13} /> {(cfg?.gitEvents ?? DEFAULT_GIT_EVENTS).map((e) => t(GIT_EVENTS[e])).join(', ')}
                    </div>
                  )}
                  <div className="row muted" style={{ fontSize: 12.5, gap: 6, flexWrap: 'wrap' }}>
                    <ArrowRight size={13} />
                    {w.syncJobId ? (
                      <span className="row" style={{ gap: 4 }}>
                        <Workflow size={13} /> {jobs.find((j) => j.id === w.syncJobId)?.name ?? w.syncJobId}
                      </span>
                    ) : (
                      <>
                        {w.targetIds.length > 0 && <TargetSummary value={w.targetIds} />}
                        {(w.folders ?? []).map((d) => (
                          <span key={d} className="mono ellipsis" style={{ fontSize: 11.5 }} title={d}>
                            {d}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                  {w.error && (
                    <div className="alert error" style={{ fontSize: 12 }}>
                      <AlertTriangle size={14} /> <span className="selectable">{w.error}</span>
                    </div>
                  )}
                  {w.deferredTargets.length > 0 && (
                    <div className="alert warn" style={{ fontSize: 12 }}>
                      <WifiOff size={14} /> {t('{n} hedef erişilemedi; değişiklikler {m} dakikada bir yeniden denenecek.', { n: w.deferredTargets.length, m: settings.retryEveryMinutes })}
                    </div>
                  )}
                  {(w.unreachableTargets?.length ?? 0) > 0 && (
                    <div className="alert warn" style={{ fontSize: 12 }}>
                      <WifiOff size={14} /> {t('Son gönderimde erişilemedi: {names}. Yeniden deneme kapalı, bu değişiklikleri almadılar.', { names: w.unreachableTargets!.join(', ') })}
                    </div>
                  )}
                  <div className="auto-foot">
                    <LastIcon s={w.lastStatus} />
                    <span className="grow ellipsis faint" style={{ fontSize: 12 }}>
                      {w.lastRunAt ? `${ago(w.lastRunAt)} • ${w.lastSummary ?? ''}` : w.pendingFiles ? t('{n} değişiklik bekliyor', { n: w.pendingFiles }) : t('Henüz değişiklik olmadı')}
                    </span>
                    {w.runs > 0 && <span className="badge">{t('{n} işlem', { n: num(w.sentFiles) })}</span>}
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={<Send size={13} />}
                      disabled={w.status === 'sending'}
                      tip={w.syncJobId ? t('Şimdi çalıştır: senkron işini hemen çalıştırır') : t('Şimdi gönder: izlenen dosya ve klasörlerde hedeften farklı olanları hemen gönderir')}
                      onClick={() => void api.watchRunNow(w.id).catch((e) => toast('error', t('Gönderilemedi'), (e as Error).message))}
                    />
                    <Button size="sm" variant="ghost" iconOnly icon={<HistoryIcon size={13} />} tip={t('Geçmiş')} onClick={() => setPage('history')} />
                    <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} tip={t('Düzenle')} onClick={() => cfg && setEditing(cfg)} />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={<Trash2 size={13} />}
                      tip={t('Kaldır')}
                      onClick={async () => {
                        if (!confirm(t('“{name}” izlemesi kaldırılsın mı?', { name: w.name }))) return;
                        useApp.setState({ automation: await api.watchRemove(w.id) });
                        await saveSettings({});
                        toast('ok', t('İzleme kaldırıldı'));
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="auto-section-head" style={{ marginTop: 26 }}>
          <div className="icon-tile accent">
            <CalendarClock size={15} />
          </div>
          <div className="grow">
            <h2>{t('Zamanlanmış senkron')}</h2>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {t('Senkron işleri seçtiğiniz aralıkta ya da saatlerde karşılaştırılıp önerilen işlemlerle eşitlenir; çakışmalara dokunulmaz.')}
            </div>
          </div>
          <Button icon={<Plus size={15} />} onClick={() => setPage('sync')}>
            {t('Senkron işine zamanlama ekle')}
          </Button>
        </div>
        {scheduled.length === 0 ? (
          <div className="card">
            <Empty art="schedule" title={t('Zamanlanmış iş yok')} hint={t('Örnek: her gece 02:00’de yedek sunucusuyla eşitle')} action={<Button onClick={() => setPage('sync')}>{t('Senkron sayfasına git')}</Button>}>
              {jobs.length ? t('{n} senkron işinizden birini açıp “Zamanla”yı etkinleştirin.', { n: jobs.length }) : t('Önce Senkron sayfasında bir iş oluşturun.')}
            </Empty>
          </div>
        ) : (
          <div className="card">
            {scheduled.map((s: ScheduleState) => {
              const quick = s.jobId.startsWith('quick:') ? (boot.settings.quickSends ?? []).find((q) => q.id === s.jobId.slice(6)) : undefined;
              const job = quick ? undefined : jobs.find((j) => j.id === s.jobId);
              const sched = quick ? quick.schedule : job?.schedule;
              return (
                <div key={s.jobId} className="list-row" style={{ height: 'auto', minHeight: 58, padding: '10px 14px', gap: 14 }}>
                  <div className={cls('icon-tile', s.enabled && s.activeHere && 'accent')}>{s.running ? <Loader2 size={15} className="spin" /> : <Clock size={15} />}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <b className="ellipsis">{s.name}</b>
                      {quick && <span className="badge accent">{t('hızlı gönderim')}</span>}
                      {!s.activeHere && <span className="badge">{s.reason}</span>}
                    </div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {describeSchedule(sched)}
                      {quick ? ` • ${t('{n} kaynak → {targets} hedef', { n: quick.paths.length, targets: quick.targetIds.length })}` : ''}
                      {sched?.machineId ? ` • ${t('{machine} makinesinde', { machine: sched.machineId })}` : ''}
                    </div>
                  </div>
                  <div className="col" style={{ gap: 2, alignItems: 'flex-end', minWidth: 170 }}>
                    <span style={{ fontSize: 12.5 }}>{s.running ? t('Çalışıyor…') : s.enabled && s.activeHere ? t('Sonraki: {time}', { time: untilText(s.nextAt) }) : t('Kapalı')}</span>
                    <span className="row faint" style={{ fontSize: 11.5, gap: 5 }}>
                      <LastIcon s={s.lastStatus} />
                      {s.lastAt ? `${ago(s.lastAt)}${s.lastSummary ? ` • ${s.lastSummary}` : ''}` : t('hiç çalışmadı')}
                    </span>
                  </div>
                  <Button size="sm" icon={<Play size={13} />} disabled={s.running || !s.activeHere} onClick={() => void api.scheduleRunNow(s.jobId)}>
                    {t('Şimdi çalıştır')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={<Pencil size={13} />}
                    tip={quick ? t('Gönder sayfasında aç') : t('İşi aç')}
                    onClick={() => {
                      if (quick) return setPage('send');
                      localStorage.setItem('samsync.sync.job', s.jobId);
                      setPage('sync');
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
        {unscheduled.length > 0 && scheduled.length > 0 && (
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            {t('Zamanlanmamış {n} iş daha var: {names}', { n: unscheduled.length, names: unscheduled.map((j) => j.name).join(', ') })}
          </div>
        )}

        <AutomationSettingsCard value={settings} onChange={(automation) => void saveSettings({ automation })} />
      </div>
      {editing && <WatchEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Opens the editor pre-filled from the Send page selection. */
export function useStartWatchFromSend() {
  const st = useApp();
  return async () => {
    if (!st.sendPaths.length || !st.targets.length) {
      st.toast('warn', t('Kaynak ve hedef seçin'), t('İzlemek için en az bir dosya/klasör ve bir hedef gerekli.'));
      return;
    }
    const name = st.sendPaths.length === 1 ? baseName(st.sendPaths[0]) : `${baseName(st.sendPaths[0])} +${st.sendPaths.length - 1}`;
    const { dryRun: _d, ...rest } = st.options;
    const a = await api.watchAdd({ name, paths: st.sendPaths, rels: relsFor(st.sendPaths, st.sendRels), targetIds: st.targets, options: { ...rest, dryRun: false, mode: rest.mode === 'mirror' ? 'overwrite' : rest.mode, propagateDeletes: false, perTarget: withoutMirror(rest.perTarget) }, quietMs: DEFAULT_QUIET_MS, enabled: true });
    useApp.setState({ automation: a });
    await st.saveSettings({});
    st.toast('ok', t('İzleme başladı'), t('{name} → {n} hedef. Değişiklikler kendiliğinden gönderilecek.', { name, n: st.targets.length }), { label: t('Otomasyonu aç'), run: () => st.setPage('automation') });
  };
}

function WatchEditor({ initial, onClose }: { initial: WatchConfig | null; onClose: () => void }) {
  const st = useApp();
  const isElectron = st.boot!.isElectron;
  const [name, setName] = useState(initial?.name ?? '');
  const [paths, setPaths] = useState<string[]>(initial?.paths ?? st.sendPaths);
  const [targets, setTargets] = useState<string[]>(initial?.targetIds ?? st.targets);
  const [opts, setOpts] = useState<SendOptions>(initial?.options ?? { ...DEFAULT_OPTIONS, ...st.options, dryRun: false, propagateDeletes: false, mode: st.options.mode === 'mirror' ? 'overwrite' : st.options.mode, perTarget: withoutMirror(st.options.perTarget) });
  const [quiet, setQuiet] = useState((initial?.quietMs ?? DEFAULT_QUIET_MS) / 1000);
  const jobs = st.boot!.config.syncJobs;
  const [trigger, setTrigger] = useState<'files' | 'git'>(initial?.trigger ?? 'files');
  const [events, setEvents] = useState<GitEvent[]>(initial?.gitEvents ?? DEFAULT_GIT_EVENTS);
  const [action, setAction] = useState<'send' | 'sync'>(initial?.syncJobId ? 'sync' : 'send');
  const [folders, setFolders] = useState<string[]>(initial?.folders ?? []);
  const [jobId, setJobId] = useState(initial?.syncJobId ?? jobs[0]?.id ?? '');
  const [syncOnStart, setSyncOnStart] = useState(!!initial?.syncOnStart);
  const [folderInput, setFolderInput] = useState('');
  const sendTargets = action === 'send' ? targets : [];
  const sendFolders = action === 'send' ? folders : [];
  const ready = paths.length > 0 && (trigger !== 'git' || (paths.length === 1 && events.length > 0)) && (action === 'send' ? sendTargets.length + sendFolders.length > 0 : !!jobId);
  const [manual, setManual] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<SendOptions>) => setOpts((o) => ({ ...o, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      const cfg = {
        name: name.trim() || baseName(paths[0] ?? t('İzleme')),
        paths,
        // places picked on the Send page come along for the paths that are still in the list
        rels: relsFor(paths, initial ? initial.rels : st.sendRels),
        targetIds: sendTargets,
        folders: sendFolders,
        syncJobId: action === 'sync' ? jobId : undefined,
        trigger,
        gitEvents: trigger === 'git' ? events : undefined,
        syncOnStart,
        options: opts,
        quietMs: Math.max(200, Math.round(quiet * 1000)),
        enabled: initial?.enabled ?? true,
      };
      const a = initial ? await api.watchUpdate(initial.id, cfg) : await api.watchAdd(cfg);
      useApp.setState({ automation: a });
      await st.saveSettings({});
      st.toast('ok', initial ? t('İzleme güncellendi') : t('İzleme başladı'), cfg.name);
      onClose();
    } catch (e) {
      st.toast('error', t('Kaydedilemedi'), (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="medium"
      title={initial ? t('İzlemeyi düzenle') : t('Yeni izleme')}
      icon={
        <div className="icon-tile accent">
          <Zap size={16} />
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ fontSize: 12 }}>
            {t('{n} yol', { n: paths.length })} → {action === 'sync' ? jobs.find((j) => j.id === jobId)?.name ?? '' : t('{n} hedef', { n: sendTargets.length + sendFolders.length })}
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" loading={saving} disabled={!ready} onClick={() => void save()}>
            {initial ? t('Kaydet') : t('İzlemeyi başlat')}
          </Button>
        </>
      }
    >
      <Field label={t('Ad')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={paths[0] ? baseName(paths[0]) : t('ör. Senaryolar')} autoFocus />
      </Field>
      <Field label={t('Ne zaman')} style={{ marginTop: 14 }}>
        <Segmented
          value={trigger}
          onChange={setTrigger}
          options={[
            { value: 'files', label: t('Dosya kaydedilince'), icon: <Eye size={14} /> },
            { value: 'git', label: t('Git’te commit ya da pull olunca'), icon: <GitBranch size={14} /> },
          ]}
        />
      </Field>
      {trigger === 'git' && (
        <div className="card flat" style={{ padding: '10px 12px', marginTop: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: '6px 16px' }}>
            {(Object.keys(GIT_EVENTS) as GitEvent[]).map((e) => (
              <label key={e} className="row" style={{ gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                <Checkbox checked={events.includes(e)} onChange={(v) => setEvents(v ? [...events, e] : events.filter((x) => x !== e))} />
                {t(GIT_EVENTS[e])}
              </label>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            {t('HEAD bu yollardan biriyle ilerleyince o commit’lerin değiştirdiği dosyalar gönderilir (diskteki hâlleriyle). Dal değiştirmek varsayılan olarak bir şey göndermez. Aşağıya deponun klasörünü (ya da içindeki bir alt klasörü) ekleyin.')}
          </div>
        </div>
      )}
      <div className="section-title" style={{ marginTop: 16 }}>
        {trigger === 'git' ? t('Git deposu') : t('İzlenecek dosya ve klasörler')}
      </div>
      <div className="card flat" style={{ maxHeight: 170, overflow: 'auto' }}>
        {paths.map((p) => (
          <div key={p} className="list-row">
            <Folder size={13} className="faint" />
            <span className="mono ellipsis grow" style={{ fontSize: 12 }} title={p}>
              {p}
            </span>
            <Button size="sm" variant="ghost" iconOnly icon={<X size={13} />} onClick={() => setPaths(paths.filter((x) => x !== p))} />
          </div>
        ))}
        {!paths.length && <div className="faint" style={{ padding: 12, fontSize: 12.5 }}>{t('Henüz yol yok.')}</div>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          className="input sm mono grow"
          value={manual}
          placeholder={t('Yol yapıştırıp Enter’a basın')}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && manual.trim()) {
              setPaths([...new Set([...paths, manual.trim().replace(/^"|"$/g, '')])]);
              setManual('');
            }
          }}
        />
        <Button size="sm" icon={<FolderOpen size={13} />} disabled={!isElectron} onClick={async () => setPaths([...new Set([...paths, ...(await api.pick({ folders: true, multi: true }))])])}>
          {t('Klasör')}
        </Button>
        <Button size="sm" icon={<FilePlus size={13} />} disabled={!isElectron || trigger === 'git'} onClick={async () => setPaths([...new Set([...paths, ...(await api.pick({ files: true, multi: true }))])])}>
          {t('Dosya')}
        </Button>
      </div>

      <Field label={t('Ne yapılsın')} style={{ marginTop: 16 }}>
        <Segmented
          value={action}
          onChange={setAction}
          options={[
            { value: 'send', label: t('Makinelere ya da klasörlere gönder'), icon: <ArrowRight size={14} /> },
            { value: 'sync', label: t('Senkron işini çalıştır'), icon: <Workflow size={14} />, tip: t('Canlı senkron: değişince işin bütün çiftleri işin kipiyle eşitlenir') },
          ]}
        />
      </Field>
      {action === 'sync' ? (
        <Field label={t('Senkron işi')} style={{ marginTop: 10 }} help={t('İzlenen yolda bir değişiklik olunca bu iş, kendi kipiyle (iki yönlü, ayna, güncelle…) çalışır.')}>
          {jobs.length ? (
            <select className="select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="faint" style={{ fontSize: 12.5 }}>{t('Önce Senkron sayfasında bir iş oluşturun.')}</div>
          )}
        </Field>
      ) : (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>
            {t('Makineler')}
          </div>
          <div className="card flat" style={{ display: 'flex', flexDirection: 'column' }}>
            <TargetPicker value={targets} onChange={setTargets} maxHeight={240} />
          </div>
          <div className="section-title" style={{ marginTop: 16 }}>
            {t('Klasörler (yapılandırma gerekmez)')}
          </div>
          <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
            {t('Yerel, bağlı ya da ağ (\\\\sunucu\\paylaşım) klasörü. İzlenen her klasörün içeriği buraya, kendi içindeki yoluyla yazılır.')}
          </div>
          {folders.map((d) => (
            <div key={d} className="list-row">
              <Folder size={13} className="faint" />
              <span className="mono ellipsis grow" style={{ fontSize: 12 }} title={d}>
                {d}
              </span>
              <Button size="sm" variant="ghost" iconOnly icon={<X size={13} />} onClick={() => setFolders(folders.filter((x) => x !== d))} />
            </div>
          ))}
          <div className="row" style={{ marginTop: 6 }}>
            <input
              className="input sm mono grow"
              value={folderInput}
              placeholder={t('Hedef klasör yolunu yapıştırıp Enter’a basın')}
              onChange={(e) => setFolderInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && folderInput.trim()) {
                  setFolders([...new Set([...folders, folderInput.trim().replace(/^"|"$/g, '')])]);
                  setFolderInput('');
                }
              }}
            />
            <Button size="sm" icon={<FolderOpen size={13} />} disabled={!isElectron} onClick={async () => setFolders([...new Set([...folders, ...(await api.pick({ folders: true, multi: true }))])])}>
              {t('Klasör')}
            </Button>
          </div>
        </>
      )}

      <div className="section-title" style={{ marginTop: 16 }}>
        {t('Davranış')}
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('Kip')}>
          <Segmented
            value={opts.mode === 'mirror' ? 'overwrite' : opts.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'overwrite', label: t('Üzerine yaz') },
              { value: 'update', label: t('Yalnızca yeni'), tip: t('Hedefte daha yeni olan dosyaya dokunmaz') },
            ]}
          />
        </Field>
        <Field label={t('Bekleme (sn)')} help={t('Son değişiklikten sonra')}>
          <input className="input" type="number" min={0.2} step={0.1} value={quiet} onChange={(e) => setQuiet(Number(e.target.value) || DEFAULT_QUIET_MS / 1000)} style={{ width: 90 }} />
        </Field>
      </div>
      <ToggleRow icon={<Play size={16} className="faint" />} title={t('Başlarken mevcut farkları da gönder')} desc={t('İzleme açılınca, hedefte eksik ya da farklı olanlar önce bir kez gönderilir')} on={syncOnStart} onChange={setSyncOnStart} />
      <ToggleRow icon={<HistoryIcon size={16} className="faint" />} title={t('Yedek al')} desc={t('Üzerine yazılan dosyanın eski hâli hedefte saklanır')} on={opts.backup} onChange={(v) => set({ backup: v })} />
      <ToggleRow icon={<Trash2 size={16} className="faint" />} title={t('Silinen dosyaları hedefte de sil')} desc={t('Kapalıyken yalnızca yeni ve değişen dosyalar gider')} on={opts.propagateDeletes} onChange={(v) => set({ propagateDeletes: v })} />
      <div className="form-grid" style={{ marginTop: 8 }}>
        <Field label={t('Hariç dosyalar')}>
          <TagInput value={opts.excludeFiles} onChange={(v) => set({ excludeFiles: v })} placeholder="*.tmp" />
        </Field>
        <Field label={t('Hariç klasörler')}>
          <TagInput value={opts.excludeDirs} onChange={(v) => set({ excludeDirs: v })} placeholder="Logs" />
        </Field>
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        <File size={12} style={{ verticalAlign: -2 }} /> {t('Geçici dosyalar (~$…, .tmp, .swp) ve .git klasörü her zaman yok sayılır.')}
      </div>
    </Modal>
  );
}

const GIT_EVENTS: Record<GitEvent, string> = {
  commit: tk('Commit'),
  amend: tk('Commit düzeltme (amend)'),
  merge: tk('Merge'),
  pull: tk('Pull'),
  rebase: tk('Rebase'),
  pick: tk('Cherry-pick, revert'),
  reset: tk('Reset'),
  checkout: tk('Dal değiştirme (checkout)'),
};

/** How automatic sends behave on this machine. */
function AutomationSettingsCard({ value, onChange }: { value: AutomationSettings; onChange: (v: AutomationSettings) => void }) {
  const set = (p: Partial<AutomationSettings>) => onChange({ ...value, ...p });
  return (
    <>
      <div className="auto-section-head" style={{ marginTop: 26 }}>
        <div className="icon-tile accent">
          <Settings2 size={15} />
        </div>
        <div className="grow">
          <h2>{t('Otomasyon ayarları')}</h2>
          <div className="faint" style={{ fontSize: 12.5 }}>
            {t('Bu bilgisayardaki bütün izlemeler ve zamanlanmış işler için geçerlidir.')}
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: '6px 16px 14px' }}>
        <ToggleRow
          icon={<WifiOff size={16} className="faint" />}
          title={t('Erişilemeyen makinelere yeniden dene')}
          desc={t('Kapalıyken erişilemeyen makine o değişiklikleri almaz; açıkken değişiklikler saklanır ve makine erişilebilir olunca gönderilir')}
          on={value.retryUnreachable}
          onChange={(v) => set({ retryUnreachable: v })}
        />
        {value.retryUnreachable && (
          <Field label={t('Yeniden deneme aralığı (dk)')} style={{ margin: '4px 0 6px 30px', maxWidth: 220 }}>
            <input className="input" type="number" min={1} max={1440} value={value.retryEveryMinutes} onChange={(e) => set({ retryEveryMinutes: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
          </Field>
        )}
        <div className="divider" />
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('Bildirim')}>
            <Segmented
              value={value.notify}
              onChange={(notify) => set({ notify })}
              options={[
                { value: 'never', label: t('Hiç') },
                { value: 'errors', label: t('Yalnızca hatalarda') },
                { value: 'always', label: t('Her gönderimde') },
              ]}
            />
          </Field>
          <Field label={t('Tek seferde en çok dosya')} help={t('Fazlası birden değişirse (ör. dal değişince) gönderilmez; 0 = sınırsız')}>
            <input className="input" type="number" min={0} value={value.maxFilesPerSend} onChange={(e) => set({ maxFilesPerSend: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 140 }} />
          </Field>
        </div>
        <div className="divider" />
        <ToggleRow
          icon={<Clock size={16} className="faint" />}
          title={t('Kaçırılan zamanlamaları açılışta çalıştır')}
          desc={t('Uygulama kapalıyken saati geçen senkron işi, uygulama açılınca çalışır')}
          on={value.catchUpSchedules}
          onChange={(v) => set({ catchUpSchedules: v })}
        />
      </div>
    </>
  );
}
