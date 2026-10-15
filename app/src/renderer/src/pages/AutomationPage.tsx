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
} from 'lucide-react';
import type { SendOptions, WatchConfig, WatchState, ScheduleState, SyncSchedule } from '@shared/types';
import { useApp, DEFAULT_OPTIONS } from '../store/app';
import { api } from '../lib/api';
import { Button, Empty, Field, Modal, Segmented, Switch, TagInput, ToggleRow } from '../components/ui';
import { TargetPicker, TargetSummary } from '../components/TargetPicker';
import { ago, baseName, cls, num } from '../lib/format';

function StatusPill({ status }: { status: WatchState['status'] }) {
  const map: Record<WatchState['status'], { label: string; cls: string; icon: React.ReactNode }> = {
    watching: { label: 'İzleniyor', cls: 'green', icon: <Eye size={11} /> },
    pending: { label: 'Bekliyor', cls: 'amber', icon: <Clock size={11} /> },
    sending: { label: 'Gönderiliyor', cls: 'blue', icon: <Loader2 size={11} className="spin" /> },
    paused: { label: 'Duraklatıldı', cls: '', icon: <Pause size={11} /> },
    error: { label: 'Hata', cls: 'red', icon: <AlertTriangle size={11} /> },
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
  if (!s) return 'Zamanlanmamış';
  if (s.mode === 'interval') return s.everyMinutes % 60 === 0 && s.everyMinutes >= 60 ? `Her ${s.everyMinutes / 60} saatte bir` : `Her ${s.everyMinutes} dakikada bir`;
  return s.times.length ? `Her gün ${s.times.join(', ')}` : 'Saat seçilmedi';
}

function untilText(t?: number): string {
  if (!t) return '–';
  const d = t - Date.now();
  if (d <= 0) return 'şimdi';
  if (d < 60_000) return `${Math.ceil(d / 1000)} sn sonra`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)} dk sonra`;
  const at = new Date(t);
  const today = at.toDateString() === new Date().toDateString();
  return `${today ? 'bugün' : 'yarın'} ${at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function AutomationPage() {
  const automation = useApp((s) => s.automation);
  const boot = useApp((s) => s.boot!);
  const saveSettings = useApp((s) => s.saveSettings);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const [editing, setEditing] = useState<WatchConfig | 'new' | null>(null);

  if (!automation)
    return (
      <div className="page">
        <div className="empty">
          <div className="spinner" />
        </div>
      </div>
    );

  const configs = boot.settings.watches ?? [];
  const jobs = boot.config.syncJobs;
  const scheduled = automation.schedules;
  const unscheduled = jobs.filter((j) => !j.schedule);
  const anything = automation.watches.length + scheduled.length > 0;

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
          <h1>Otomasyon</h1>
          <div className="sub">Klasörleri izleyip değişiklikleri kendiliğinden gönderin; senkron işlerini belirli aralıklarla ya da saatlerde çalıştırın.</div>
        </div>
        {anything && (
          <Button size="lg" variant={automation.paused ? 'primary' : 'default'} icon={automation.paused ? <Play size={15} /> : <Pause size={15} />} onClick={() => void pause(!automation.paused)}>
            {automation.paused ? 'Otomasyonu sürdür' : 'Hepsini duraklat'}
          </Button>
        )}
      </div>
      <div className="page-body">
        {boot.isElectron && !boot.settings.closeToTray && anything && (
          <div className="alert info" style={{ marginBottom: 14 }}>
            <PanelBottomClose size={16} />
            <div className="grow">
              Otomasyon yalnızca uygulama açıkken çalışır. Pencere kapanınca da sürmesi için uygulamayı sistem tepsisinde tutun.
            </div>
            <Button size="sm" onClick={() => void saveSettings({ closeToTray: true })}>
              Tepside çalışmaya devam et
            </Button>
          </div>
        )}
        {automation.paused && anything && (
          <div className="alert warn" style={{ marginBottom: 14 }}>
            <Pause size={16} /> Otomasyon duraklatıldı: izlemeler değişiklik toplamıyor, zamanlanmış işler çalışmıyor.
          </div>
        )}

        <div className="auto-section-head">
          <div className="icon-tile accent">
            <Eye size={15} />
          </div>
          <div className="grow">
            <h2>Canlı izleme</h2>
            <div className="faint" style={{ fontSize: 12.5 }}>
              Dosya kaydedildiğinde birkaç saniye bekler, sonra yalnızca değişenleri seçili makinelere gönderir. Erişilemeyen makinelere dakikada bir yeniden dener.
            </div>
          </div>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>
            Yeni izleme
          </Button>
        </div>
        {automation.watches.length === 0 ? (
          <div className="card">
            <Empty icon={<Eye size={22} />} title="İzleme yok" action={<Button icon={<Plus size={15} />} onClick={() => setEditing('new')}>İzleme ekle</Button>}>
              Gönder sayfasında kaynakları ve hedefleri seçip <b>İzle</b>’ye basabilir ya da buradan ekleyebilirsiniz.
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
                    {w.paths.length > 4 && <div className="faint" style={{ fontSize: 11.5 }}>… ve {w.paths.length - 4} yol daha</div>}
                  </div>
                  <div className="row muted" style={{ fontSize: 12.5, gap: 6 }}>
                    <ArrowRight size={13} /> <TargetSummary value={w.targetIds} />
                  </div>
                  {w.error && (
                    <div className="alert error" style={{ fontSize: 12 }}>
                      <AlertTriangle size={14} /> <span className="selectable">{w.error}</span>
                    </div>
                  )}
                  {w.deferredTargets.length > 0 && (
                    <div className="alert warn" style={{ fontSize: 12 }}>
                      <WifiOff size={14} /> {w.deferredTargets.length} hedef erişilemedi; değişiklikler dakikada bir yeniden denenecek.
                    </div>
                  )}
                  <div className="auto-foot">
                    <LastIcon s={w.lastStatus} />
                    <span className="grow ellipsis faint" style={{ fontSize: 12 }}>
                      {w.lastRunAt ? `${ago(w.lastRunAt)} • ${w.lastSummary ?? ''}` : w.pendingFiles ? `${w.pendingFiles} değişiklik bekliyor` : 'Henüz değişiklik olmadı'}
                    </span>
                    {w.runs > 0 && <span className="badge">{num(w.sentFiles)} işlem</span>}
                    <Button size="sm" variant="ghost" iconOnly icon={<HistoryIcon size={13} />} tip="Geçmiş" onClick={() => setPage('history')} />
                    <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} tip="Düzenle" onClick={() => cfg && setEditing(cfg)} />
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon={<Trash2 size={13} />}
                      tip="Kaldır"
                      onClick={async () => {
                        if (!confirm(`“${w.name}” izlemesi kaldırılsın mı?`)) return;
                        useApp.setState({ automation: await api.watchRemove(w.id) });
                        await saveSettings({});
                        toast('ok', 'İzleme kaldırıldı');
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
            <h2>Zamanlanmış senkron</h2>
            <div className="faint" style={{ fontSize: 12.5 }}>
              Senkron işleri seçtiğiniz aralıkta ya da saatlerde karşılaştırılıp önerilen işlemlerle eşitlenir; çakışmalara dokunulmaz.
            </div>
          </div>
          <Button icon={<Plus size={15} />} onClick={() => setPage('sync')}>
            Senkron işine zamanlama ekle
          </Button>
        </div>
        {scheduled.length === 0 ? (
          <div className="card">
            <Empty icon={<CalendarClock size={22} />} title="Zamanlanmış iş yok" action={<Button onClick={() => setPage('sync')}>Senkron sayfasına git</Button>}>
              {jobs.length ? `${jobs.length} senkron işinizden birini açıp “Zamanla”yı etkinleştirin.` : 'Önce Senkron sayfasında bir iş oluşturun.'}
            </Empty>
          </div>
        ) : (
          <div className="card">
            {scheduled.map((s: ScheduleState) => {
              const job = jobs.find((j) => j.id === s.jobId);
              return (
                <div key={s.jobId} className="list-row" style={{ height: 'auto', minHeight: 58, padding: '10px 14px', gap: 14 }}>
                  <div className={cls('icon-tile', s.enabled && s.activeHere && 'accent')}>{s.running ? <Loader2 size={15} className="spin" /> : <Clock size={15} />}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <b className="ellipsis">{s.name}</b>
                      {!s.activeHere && <span className="badge">{s.reason}</span>}
                    </div>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {describeSchedule(job?.schedule)}
                      {job?.schedule?.machineId ? ` • ${job.schedule.machineId} makinesinde` : ''}
                    </div>
                  </div>
                  <div className="col" style={{ gap: 2, alignItems: 'flex-end', minWidth: 170 }}>
                    <span style={{ fontSize: 12.5 }}>{s.running ? 'Çalışıyor…' : s.enabled && s.activeHere ? `Sonraki: ${untilText(s.nextAt)}` : 'Kapalı'}</span>
                    <span className="row faint" style={{ fontSize: 11.5, gap: 5 }}>
                      <LastIcon s={s.lastStatus} />
                      {s.lastAt ? `${ago(s.lastAt)}${s.lastSummary ? ` • ${s.lastSummary}` : ''}` : 'hiç çalışmadı'}
                    </span>
                  </div>
                  <Button size="sm" icon={<Play size={13} />} disabled={s.running || !s.activeHere} onClick={() => void api.scheduleRunNow(s.jobId)}>
                    Şimdi çalıştır
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon={<Pencil size={13} />}
                    tip="İşi aç"
                    onClick={() => {
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
            Zamanlanmamış {unscheduled.length} iş daha var: {unscheduled.map((j) => j.name).join(', ')}
          </div>
        )}
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
      st.toast('warn', 'Kaynak ve hedef seçin', 'İzlemek için en az bir dosya/klasör ve bir hedef gerekli.');
      return;
    }
    const name = st.sendPaths.length === 1 ? baseName(st.sendPaths[0]) : `${baseName(st.sendPaths[0])} +${st.sendPaths.length - 1}`;
    const { dryRun: _d, ...rest } = st.options;
    const a = await api.watchAdd({ name, paths: st.sendPaths, targetIds: st.targets, options: { ...rest, dryRun: false, mode: rest.mode === 'mirror' ? 'overwrite' : rest.mode, propagateDeletes: false }, quietMs: 2000, enabled: true });
    useApp.setState({ automation: a });
    await st.saveSettings({});
    st.toast('ok', 'İzleme başladı', `${name} → ${st.targets.length} hedef. Değişiklikler kendiliğinden gönderilecek.`, { label: 'Otomasyonu aç', run: () => st.setPage('automation') });
  };
}

function WatchEditor({ initial, onClose }: { initial: WatchConfig | null; onClose: () => void }) {
  const st = useApp();
  const isElectron = st.boot!.isElectron;
  const [name, setName] = useState(initial?.name ?? '');
  const [paths, setPaths] = useState<string[]>(initial?.paths ?? st.sendPaths);
  const [targets, setTargets] = useState<string[]>(initial?.targetIds ?? st.targets);
  const [opts, setOpts] = useState<SendOptions>(initial?.options ?? { ...DEFAULT_OPTIONS, ...st.options, dryRun: false, propagateDeletes: false, mode: st.options.mode === 'mirror' ? 'overwrite' : st.options.mode });
  const [quiet, setQuiet] = useState((initial?.quietMs ?? 2000) / 1000);
  const [manual, setManual] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<SendOptions>) => setOpts((o) => ({ ...o, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      const cfg = { name: name.trim() || baseName(paths[0] ?? 'İzleme'), paths, targetIds: targets, options: opts, quietMs: Math.max(500, Math.round(quiet * 1000)), enabled: initial?.enabled ?? true };
      const a = initial ? await api.watchUpdate(initial.id, cfg) : await api.watchAdd(cfg);
      useApp.setState({ automation: a });
      await st.saveSettings({});
      st.toast('ok', initial ? 'İzleme güncellendi' : 'İzleme başladı', cfg.name);
      onClose();
    } catch (e) {
      st.toast('error', 'Kaydedilemedi', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="medium"
      title={initial ? 'İzlemeyi düzenle' : 'Yeni izleme'}
      icon={
        <div className="icon-tile accent">
          <Zap size={16} />
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ fontSize: 12 }}>
            {paths.length} yol → {targets.length} hedef
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" loading={saving} disabled={!paths.length || !targets.length} onClick={() => void save()}>
            {initial ? 'Kaydet' : 'İzlemeyi başlat'}
          </Button>
        </>
      }
    >
      <Field label="Ad">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={paths[0] ? baseName(paths[0]) : 'ör. Senaryolar'} autoFocus />
      </Field>
      <div className="section-title" style={{ marginTop: 16 }}>
        İzlenecek dosya ve klasörler
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
        {!paths.length && <div className="faint" style={{ padding: 12, fontSize: 12.5 }}>Henüz yol yok.</div>}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          className="input sm mono grow"
          value={manual}
          placeholder="Yol yapıştırıp Enter’a basın"
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && manual.trim()) {
              setPaths([...new Set([...paths, manual.trim().replace(/^"|"$/g, '')])]);
              setManual('');
            }
          }}
        />
        <Button size="sm" icon={<FolderOpen size={13} />} disabled={!isElectron} onClick={async () => setPaths([...new Set([...paths, ...(await api.pick({ folders: true, multi: true }))])])}>
          Klasör
        </Button>
        <Button size="sm" icon={<FilePlus size={13} />} disabled={!isElectron} onClick={async () => setPaths([...new Set([...paths, ...(await api.pick({ files: true, multi: true }))])])}>
          Dosya
        </Button>
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        Hedefler
      </div>
      <div className="card flat" style={{ display: 'flex', flexDirection: 'column' }}>
        <TargetPicker value={targets} onChange={setTargets} maxHeight={240} />
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>
        Davranış
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Kip">
          <Segmented
            value={opts.mode === 'mirror' ? 'overwrite' : opts.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: 'overwrite', label: 'Üzerine yaz' },
              { value: 'update', label: 'Yalnızca yeni', tip: 'Hedefte daha yeni olan dosyaya dokunmaz' },
            ]}
          />
        </Field>
        <Field label="Bekleme (sn)" help="Son değişiklikten sonra">
          <input className="input" type="number" min={0.5} step={0.5} value={quiet} onChange={(e) => setQuiet(Number(e.target.value) || 2)} style={{ width: 90 }} />
        </Field>
      </div>
      <ToggleRow icon={<HistoryIcon size={16} className="faint" />} title="Yedek al" desc="Üzerine yazılan dosyanın eski hâli hedefte saklanır" on={opts.backup} onChange={(v) => set({ backup: v })} />
      <ToggleRow icon={<Trash2 size={16} className="faint" />} title="Silinen dosyaları hedefte de sil" desc="Kapalıyken yalnızca yeni ve değişen dosyalar gider" on={opts.propagateDeletes} onChange={(v) => set({ propagateDeletes: v })} />
      <div className="form-grid" style={{ marginTop: 8 }}>
        <Field label="Hariç dosyalar">
          <TagInput value={opts.excludeFiles} onChange={(v) => set({ excludeFiles: v })} placeholder="*.tmp" />
        </Field>
        <Field label="Hariç klasörler">
          <TagInput value={opts.excludeDirs} onChange={(v) => set({ excludeDirs: v })} placeholder="Logs" />
        </Field>
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        <File size={12} style={{ verticalAlign: -2 }} /> Geçici dosyalar (~$…, .tmp, .swp) ve .git klasörü her zaman yok sayılır.
      </div>
    </Modal>
  );
}
