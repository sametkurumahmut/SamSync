import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowLeft,
  ArrowRightToLine,
  Settings2,
  Plus,
  Trash2,
  FolderOpen,
  Play,
  Scale,
  Filter,
  Equal,
  X,
  Folder,
  File,
  Server,
  Laptop,
  Save,
  RotateCcw,
  FlaskConical,
  ChevronRight,
  CornerLeftUp,
  AlertTriangle,
  Copy,
  CalendarClock,
  Upload,
  Download,
} from 'lucide-react';
import type { Category, CompareItem, CompareResult, Endpoint, FileMeta, SyncAction, SyncJob, SyncPair, SyncVariant, CustomActions, DiffResult, SyncSchedule } from '@shared/types';
import type { BrowseEntry } from '@shared/api';
import { useApp } from '../store/app';
import { api, newTaskId, onEvent } from '../lib/api';
import { Button, Empty, Field, Modal, Segmented, TagInput, Popover, MenuList, SearchInput, Switch } from '../components/ui';
import { describeSchedule } from './AutomationPage';
import { DiffView } from '../components/DiffView';
import { compareOptions } from './SendPage';
import { ago, bytes, cls, num, shortDateTime, splitPath } from '../lib/format';
import { locale, t, tk } from '@shared/i18n';
import { tx } from '../lib/i18n';
import { readStored, writeStored } from '../lib/persist';
import { askConfirm } from '../components/ConfirmDialog';

const VARIANTS: { value: SyncVariant; label: string; desc: string; icon: typeof ArrowRight }[] = [
  { value: 'twoWay', label: tk('İki yönlü'), desc: tk('Değişiklikleri iki tarafa da yayar, silinenleri son eşitlemeden anlar'), icon: ArrowLeftRight },
  { value: 'mirror', label: tk('Ayna'), desc: tk('Sağ taraf solun birebir kopyası olur; fazlalar silinir'), icon: ArrowRight },
  { value: 'update', label: tk('Güncelle'), desc: tk('Yeni ve değişen dosyaları sağa kopyalar, hiçbir şey silmez'), icon: ArrowRightToLine },
  { value: 'custom', label: tk('Özel'), desc: tk('Her durum için yapılacak işlemi siz seçersiniz'), icon: Settings2 },
];

/** Labels are tk() keys: show them with t(). */
export const CAT: Record<Category, { label: string; sign: string }> = {
  leftOnly: { label: tk('Yalnız solda'), sign: '◧' },
  leftNewer: { label: tk('Sol daha yeni'), sign: '◀' },
  different: { label: tk('Farklı'), sign: '≠' },
  rightNewer: { label: tk('Sağ daha yeni'), sign: '▶' },
  rightOnly: { label: tk('Yalnız sağda'), sign: '◨' },
  conflict: { label: tk('Çakışma'), sign: '!' },
  equal: { label: tk('Aynı'), sign: '=' },
};

const ACTION: Record<SyncAction, { label: string; short: string }> = {
  copyRight: { label: tk('Sağa kopyala'), short: '→' },
  copyLeft: { label: tk('Sola kopyala'), short: '←' },
  deleteRight: { label: tk('Sağdan sil'), short: '✕→' },
  deleteLeft: { label: tk('Soldan sil'), short: '←✕' },
  keepBoth: { label: tk('İkisini de sakla'), short: '⇆' },
  none: { label: tk('Bir şey yapma'), short: '=' },
};

function ActionIcon({ a }: { a: SyncAction }) {
  if (a === 'copyRight') return <ArrowRight size={14} />;
  if (a === 'copyLeft') return <ArrowLeft size={14} />;
  if (a === 'keepBoth') return <Copy size={13} />;
  if (a === 'deleteRight')
    return (
      <span className="row" style={{ gap: 0 }}>
        <Trash2 size={12} />
        <ArrowRight size={11} />
      </span>
    );
  if (a === 'deleteLeft')
    return (
      <span className="row" style={{ gap: 0 }}>
        <ArrowLeft size={11} />
        <Trash2 size={12} />
      </span>
    );
  return <Equal size={14} />;
}

/** Filters of the job file dialogs; built when shown, so the name follows the language. */
const jobFileFilters = () => [{ name: t('SamSync senkron işi'), extensions: ['json'] }];

function newJob(): SyncJob {
  const id = 'job-' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    name: t('Yeni senkron işi'),
    pairs: [{ id: 'p1', left: { kind: 'local', path: '' }, right: { kind: 'node', nodeId: '', subPath: '' } }],
    compare: 'timeSize',
    variant: 'mirror',
    filter: { include: [], exclude: [] },
    deletion: 'versioning',
    versioningKeep: 5,
  };
}

export function SyncPage() {
  const cfg = useApp((s) => s.boot!.config);
  const saveConfig = useApp((s) => s.saveConfig);
  const toast = useApp((s) => s.toast);
  const isElectron = useApp((s) => s.boot!.isElectron);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem('samsync.sync.job'));
  const [draft, setDraftState] = useState<SyncJob | null>(() => readStored<SyncJob | null>('samsync.sync.draft', null));
  const setDraft = (d: SyncJob | null) => {
    setDraftState(d);
    writeStored('samsync.sync.draft', d);
  };
  const jobs = cfg.syncJobs;
  const effectiveId = activeId && jobs.some((j) => j.id === activeId) ? activeId : jobs[0]?.id ?? null;
  const saved = jobs.find((j) => j.id === effectiveId) ?? null;
  const job = draft && draft.id === effectiveId ? draft : saved;
  const dirty = !!draft && draft.id === effectiveId && JSON.stringify(draft) !== JSON.stringify(saved);

  const select = (id: string) => {
    localStorage.setItem('samsync.sync.job', id);
    setActiveId(id);
    setDraft(null);
  };
  const update = (patch: Partial<SyncJob>) => job && setDraft({ ...job, ...patch });
  const persist = async (j = job) => {
    if (!j) return false;
    const exists = jobs.some((x) => x.id === j.id);
    const ok = await saveConfig({ ...cfg, syncJobs: exists ? jobs.map((x) => (x.id === j.id ? j : x)) : [...jobs, j] });
    if (ok) setDraft(null);
    return ok;
  };
  const importJob = async () => {
    const [p] = await api.pick({ files: true, title: t('İçe aktarılacak senkron işi'), filters: jobFileFilters() });
    if (!p) return;
    try {
      // the configuration arrives with the config-changed event; the new job is shown once it is there
      select(await api.importSyncJob(p));
      toast('ok', t('Senkron işi içe aktarıldı'), p);
    } catch (e) {
      toast('error', t('İçe aktarılamadı'), (e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Senkron')}</h1>
          <div className="sub">{t('Klasör çiftlerini karşılaştırın; farkları görüp işlemleri tek tek ayarlayın, sonra eşitleyin.')}</div>
        </div>
        <Button icon={<Download size={15} />} disabled={!isElectron} onClick={() => void importJob()}>
          {t('İçe aktar…')}
        </Button>
        <Button
          icon={<Plus size={15} />}
          onClick={async () => {
            const j = newJob();
            if (await persist(j)) select(j.id);
          }}
        >
          {t('Yeni iş')}
        </Button>
      </div>
      <div className="page-body fill">
        <div className="sync-layout">
          <div className="card sync-jobs">
            <div className="pane-head">
              <b>{t('İşler')}</b>
              <span className="faint">{jobs.length}</span>
            </div>
            <div className="pane-scroll" style={{ padding: 6 }}>
              {jobs.map((j) => {
                const V = VARIANTS.find((v) => v.value === j.variant)!;
                return (
                  <button key={j.id} className={cls('job-item', j.id === effectiveId && 'active')} onClick={() => select(j.id)}>
                    <div className={cls('icon-tile', j.id === effectiveId && 'accent')}>
                      <V.icon size={15} />
                    </div>
                    <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                      <div className="ellipsis" style={{ fontWeight: 580 }}>
                        {j.name}
                      </div>
                      <div className="faint ellipsis" style={{ fontSize: 11.5 }}>
                        {t(V.label)} • {t('{n} çift', { n: j.pairs.length })} • {j.lastRun ? ago(Date.parse(j.lastRun)) : t('hiç çalışmadı')}
                      </div>
                    </div>
                  </button>
                );
              })}
              {!jobs.length && (
                <div className="faint" style={{ padding: 14, fontSize: 12.5 }}>
                  {t('Henüz iş yok. “Yeni iş” ile bir klasör çifti tanımlayın.')}
                </div>
              )}
            </div>
          </div>
          {!job ? (
            <div className="card" style={{ display: 'grid', placeItems: 'center' }}>
              <Empty art="sync" title={t('Bir senkron işi seçin ya da oluşturun')} hint={tx('Örnek: {a} ile {b} iki yönlü, her gece', { a: <code>D:\Data</code>, b: <code>\\NAS\Data</code> })}>
                {t('Sol ve sağ klasörleri karşılaştırın, her dosya için yapılacak işlemi görün ve değiştirin. Sağ taraf bir hedef makinenin klasörü ya da herhangi bir klasör olabilir.')}
              </Empty>
            </div>
          ) : (
            <JobView
              key={job.id}
              job={job}
              dirty={dirty}
              onChange={update}
              onSave={() => void persist().then((ok) => ok && toast('ok', t('İş kaydedildi')))}
              onRevert={() => setDraft(null)}
              onDelete={async () => {
                if (!(await askConfirm(t('“{name}” silinsin mi?', { name: job.name }), { danger: true }))) return;
                await saveConfig({ ...cfg, syncJobs: jobs.filter((x) => x.id !== job.id) });
                await api.resetSyncState(job.id);
                setActiveId(null);
                setDraft(null);
              }}
              onPersist={persist}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function JobView({
  job,
  dirty,
  onChange,
  onSave,
  onRevert,
  onDelete,
  onPersist,
}: {
  job: SyncJob;
  dirty: boolean;
  onChange: (p: Partial<SyncJob>) => void;
  onSave: () => void;
  onRevert: () => void;
  onDelete: () => void;
  onPersist: (j?: SyncJob) => Promise<boolean>;
}) {
  const toast = useApp((s) => s.toast);
  const watchRun = useApp((s) => s.watchRun);
  const backupFolder = useApp((s) => s.boot!.config.copy.backupFolderName);
  const isElectron = useApp((s) => s.boot!.isElectron);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Record<string, SyncAction>>>({});
  const [confirmRun, setConfirmRun] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLButtonElement>(null);
  const taskRef = useRef<string | null>(null);

  const ready = job.pairs.every((p) => (p.left.kind === 'local' ? p.left.path : p.left.nodeId) && (p.right.kind === 'local' ? p.right.path : p.right.nodeId));

  const compare = async () => {
    if (!ready) return toast('warn', t('Klasörler eksik'), t('Her çiftin iki tarafını da seçin.'));
    if (dirty) await onPersist(job);
    const id = newTaskId();
    taskRef.current = id;
    setComparing(t('Taranıyor…'));
    setOverrides({});
    const unsub = onEvent((e) => {
      if (e.type === 'task-progress' && e.taskId === id) setComparing(e.message);
    });
    try {
      const r = await api.compareJob(job, id);
      setResult(r);
    } catch (e) {
      toast('error', t('Karşılaştırma başarısız'), (e as Error).message);
    } finally {
      unsub();
      setComparing(null);
    }
  };

  const effective = (pairId: string, it: CompareItem): SyncAction => overrides[pairId]?.[it.key] ?? it.action;
  const stats = useMemo(() => {
    const s = { copyRight: 0, copyLeft: 0, deleteLeft: 0, deleteRight: 0, keepBoth: 0, none: 0, bytes: 0 };
    for (const p of result?.pairs ?? [])
      for (const it of p.items) {
        const a = effective(p.pairId, it);
        s[a]++;
        if (a === 'copyRight' && it.left && !it.left.isDir) s.bytes += it.left.size;
        if (a === 'copyLeft' && it.right && !it.right.isDir) s.bytes += it.right.size;
        if (a === 'keepBoth') s.bytes += (it.left?.size ?? 0) + (it.right?.size ?? 0);
      }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, overrides]);
  const work = stats.copyLeft + stats.copyRight + stats.deleteLeft + stats.deleteRight + stats.keepBoth;

  const exportJob = async () => {
    if (dirty && !(await onPersist(job))) return;
    const safeName = job.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || job.id;
    const p = await api.pickSave({ title: t('Senkron işini dışa aktar'), defaultPath: `${safeName}.samsync-job.json`, filters: jobFileFilters() });
    if (!p) return;
    try {
      await api.exportSyncJob(job.id, p);
      toast('ok', t('Senkron işi dışa aktarıldı'), p);
    } catch (e) {
      toast('error', t('Dışa aktarılamadı'), (e as Error).message);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!result) return;
    try {
      const id = await api.syncRun(result.id, job, overrides, dryRun);
      setConfirmRun(false);
      watchRun(id);
      setResult(null);
    } catch (e) {
      toast('error', t('Senkron başlatılamadı'), (e as Error).message);
    }
  };

  const V = VARIANTS.find((v) => v.value === job.variant)!;
  const filterCount = job.filter.include.length + job.filter.exclude.length + (job.filter.minSizeKb ? 1 : 0) + (job.filter.maxSizeKb ? 1 : 0) + (job.filter.newerThanDays ? 1 : 0);

  return (
    <div className="sync-main">
      <div className="card">
        <div className="card-head">
          <input className="input job-name" value={job.name} onChange={(e) => onChange({ name: e.target.value })} />
          <span className="spacer" />
          {dirty && (
            <>
              <span className="badge amber">{t('kaydedilmedi')}</span>
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={onRevert}>
                {t('Geri al')}
              </Button>
              <Button size="sm" icon={<Save size={13} />} onClick={onSave}>
                {t('Kaydet')}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" icon={<Upload size={13} />} disabled={!isElectron} tip={t('İşi başka bir yapılandırmaya taşımak için dosyaya yazar')} onClick={() => void exportJob()}>
            {t('Dışa aktar…')}
          </Button>
          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} tip={t('İşi sil')} onClick={onDelete} />
        </div>
        <div className="card-body sync-config">
          <div className="variant-grid">
            {VARIANTS.map((v) => (
              <button key={v.value} className={cls('variant', job.variant === v.value && 'on')} onClick={() => onChange({ variant: v.value, custom: v.value === 'custom' ? job.custom ?? { leftOnly: 'copyRight', rightOnly: 'none', leftNewer: 'copyRight', rightNewer: 'none', different: 'copyRight' } : job.custom })}>
                <v.icon size={18} />
                <div>
                  <div style={{ fontWeight: 620 }}>{t(v.label)}</div>
                  <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.35 }}>
                    {t(v.desc)}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {job.variant === 'custom' && <CustomEditor value={job.custom!} onChange={(custom) => onChange({ custom })} />}
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
            <Field label={t('Karşılaştırma')}>
              <Segmented value={job.compare} onChange={(compare) => onChange({ compare })} options={compareOptions()} />
            </Field>
            <Field label={t('Silinen / üzerine yazılan dosyalar')}>
              <Segmented
                value={job.deletion}
                onChange={(deletion) => onChange({ deletion })}
                options={[
                  { value: 'versioning', label: t('Sürümle (yedekle)'), tip: t('Eski hâller o tarafın yedek klasörüne taşınır') },
                  { value: 'recycle', label: t('Geri dönüşüm kutusu'), tip: t('Bu makinedeki klasörlerde eski hâller geri dönüşüm kutusuna gider;\nağ yollarında ve hedef makinelerde yedek klasörüne taşınır') },
                  { value: 'permanent', label: t('Kalıcı sil') },
                ]}
              />
            </Field>
            {job.deletion !== 'permanent' && (
              <>
                <Field label={t('Saklanacak sürüm')}>
                  <input className="input" type="number" min={0} value={job.versioningKeep} onChange={(e) => onChange({ versioningKeep: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80 }} />
                </Field>
                <Field label={t('Saklama süresi (gün)')}>
                  <span data-tip={t('Bundan eski sürümler başarılı bir çalışmadan sonra silinir.\nBoş ya da 0: yaş sınırı yok')}>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={job.versioningMaxDays || ''}
                      placeholder="—"
                      onChange={(e) => onChange({ versioningMaxDays: Math.max(0, Number(e.target.value) || 0) || undefined })}
                      style={{ width: 80 }}
                    />
                  </span>
                </Field>
              </>
            )}
            <Field label={t('Filtre')}>
              <button ref={filterRef} className="btn" onClick={() => setFilterOpen((o) => !o)}>
                <Filter size={14} /> {t('Filtre')} {filterCount > 0 && <span className="badge blue">{filterCount}</span>}
              </button>
            </Field>
          </div>
          <ScheduleEditor job={job} onChange={(schedule) => onChange({ schedule })} />
          <div className="divider" />
          <div className="section-title">{t('Klasör çiftleri')}</div>
          <div className="col" style={{ gap: 8 }}>
            {job.pairs.map((p, i) => (
              <PairEditor
                key={p.id}
                pair={p}
                onChange={(np) => onChange({ pairs: job.pairs.map((x) => (x.id === p.id ? np : x)) })}
                onRemove={job.pairs.length > 1 ? () => onChange({ pairs: job.pairs.filter((x) => x.id !== p.id) }) : undefined}
                index={i}
              />
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => onChange({ pairs: [...job.pairs, { id: 'p' + Date.now().toString(36), left: { kind: 'local', path: '' }, right: { kind: 'node', nodeId: '', subPath: '' } }] })}>
              {t('Çift ekle')}
            </Button>
            <span className="spacer" />
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={13} />}
              tip={t('İki yönlü eşitlemenin hatırladığı son durumu siler')}
              onClick={async () => {
                await api.resetSyncState(job.id);
                toast('ok', t('Eşitleme geçmişi sıfırlandı'));
              }}
            >
              {t('Durumu sıfırla')}
            </Button>
            <Button variant="primary" icon={comparing ? undefined : <Scale size={15} />} loading={!!comparing} onClick={() => void compare()} disabled={!ready}>
              {t('Karşılaştır')}
            </Button>
          </div>
        </div>
      </div>

      {comparing && (
        <div className="card row" style={{ padding: 14, gap: 12 }}>
          <div className="spinner" />
          <span className="muted ellipsis">{comparing}</span>
          <span className="spacer" />
          <Button size="sm" onClick={() => taskRef.current && void api.cancelTask(taskRef.current)}>
            {t('Durdur')}
          </Button>
        </div>
      )}

      {result && !comparing && (
        <ResultView
          result={result}
          variant={t(V.label)}
          overrides={overrides}
          setOverride={(pairId, keys, a) =>
            setOverrides((o) => {
              const p = { ...(o[pairId] ?? {}) };
              for (const k of keys) p[k] = a;
              return { ...o, [pairId]: p };
            })
          }
          resetOverrides={() => setOverrides({})}
          stats={stats}
          work={work}
          onRun={() => setConfirmRun(true)}
        />
      )}

      {filterOpen && (
        <Popover anchor={filterRef.current} onClose={() => setFilterOpen(false)} width={460}>
          <div style={{ padding: 10 }} className="col">
            <Field label={t('Dahil et')} help={t('Boş = her şey. Örnek: *.entity, Data/**')}>
              <TagInput value={job.filter.include} onChange={(include) => onChange({ filter: { ...job.filter, include } })} placeholder="*" />
            </Field>
            <Field label={t('Hariç tut')} help={t('Örnek: *.tmp, Logs/, .git/, bin/*.pdb')}>
              <TagInput value={job.filter.exclude} onChange={(exclude) => onChange({ filter: { ...job.filter, exclude } })} placeholder="*.tmp" />
            </Field>
            <div className="row" style={{ gap: 10 }}>
              <Field label={t('En az (KB)')}>
                <input className="input" type="number" min={0} value={job.filter.minSizeKb ?? ''} onChange={(e) => onChange({ filter: { ...job.filter, minSizeKb: e.target.value === '' ? undefined : Number(e.target.value) } })} />
              </Field>
              <Field label={t('En çok (KB)')}>
                <input className="input" type="number" min={0} value={job.filter.maxSizeKb ?? ''} onChange={(e) => onChange({ filter: { ...job.filter, maxSizeKb: e.target.value === '' ? undefined : Number(e.target.value) } })} />
              </Field>
              <Field label={t('Son N gün')}>
                <input className="input" type="number" min={0} value={job.filter.newerThanDays ?? ''} onChange={(e) => onChange({ filter: { ...job.filter, newerThanDays: e.target.value === '' ? undefined : Number(e.target.value) } })} />
              </Field>
            </div>
          </div>
        </Popover>
      )}

      {confirmRun && result && (
        <Modal
          title={t('Senkronizasyonu başlat')}
          icon={
            <div className="icon-tile accent">
              <Play size={16} />
            </div>
          }
          onClose={() => setConfirmRun(false)}
          footer={
            <>
              <span className="spacer" />
              <Button onClick={() => setConfirmRun(false)}>{t('Vazgeç')}</Button>
              <Button icon={<FlaskConical size={14} />} onClick={() => void run(true)}>
                {t('Deneme')}
              </Button>
              <Button variant="primary" icon={<Play size={14} />} onClick={() => void run(false)}>
                {t('Başlat')}
              </Button>
            </>
          }
        >
          <div className="stat-grid">
            <div className="stat">
              <div className="k">{t('Sağa kopyala')}</div>
              <div className="v">{num(stats.copyRight)}</div>
            </div>
            <div className="stat">
              <div className="k">{t('Sola kopyala')}</div>
              <div className="v">{num(stats.copyLeft)}</div>
            </div>
            <div className="stat">
              <div className="k">{t('Silinecek')}</div>
              <div className="v" style={{ color: stats.deleteLeft + stats.deleteRight ? 'var(--red)' : undefined }}>
                {num(stats.deleteLeft + stats.deleteRight)}
              </div>
            </div>
            <div className="stat">
              <div className="k">{t('Veri')}</div>
              <div className="v">{bytes(stats.bytes)}</div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 14 }}>
            {job.deletion === 'versioning'
              ? t('Silinen ve üzerine yazılan dosyalar her iki tarafın {folder} klasörüne taşınır.', { folder: backupFolder })
              : job.deletion === 'recycle'
                ? t('Silinen ve üzerine yazılan dosyalar bu makinedeki klasörlerde geri dönüşüm kutusuna, öbür taraflarda {folder} klasörüne taşınır.', { folder: backupFolder })
                : t('Silinen dosyalar kalıcı olarak kaldırılır.')}
          </p>
        </Modal>
      )}
    </div>
  );
}

function CustomEditor({ value, onChange }: { value: CustomActions; onChange: (v: CustomActions) => void }) {
  const cats: (keyof CustomActions)[] = ['leftOnly', 'leftNewer', 'different', 'rightNewer', 'rightOnly'];
  const allowed: Record<keyof CustomActions, SyncAction[]> = {
    leftOnly: ['copyRight', 'deleteLeft', 'none'],
    rightOnly: ['copyLeft', 'deleteRight', 'none'],
    leftNewer: ['copyRight', 'copyLeft', 'none'],
    rightNewer: ['copyLeft', 'copyRight', 'none'],
    different: ['copyRight', 'copyLeft', 'none'],
  };
  return (
    <div className="custom-grid">
      {cats.map((c) => (
        <div key={c} className="custom-cell">
          <div className="row" style={{ gap: 6 }}>
            <span className={cls('sign', c)}>{CAT[c].sign}</span>
            <span style={{ fontWeight: 560, fontSize: 12.5 }}>{t(CAT[c].label)}</span>
          </div>
          <select className="select" value={value[c]} onChange={(e) => onChange({ ...value, [c]: e.target.value as SyncAction })}>
            {allowed[c].map((a) => (
              <option key={a} value={a}>
                {ACTION[a].short} {t(ACTION[a].label)}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function PairEditor({ pair, onChange, onRemove, index }: { pair: SyncPair; onChange: (p: SyncPair) => void; onRemove?: () => void; index: number }) {
  return (
    <div className="pair-row">
      <span className="faint tabular" style={{ width: 16 }}>
        {index + 1}
      </span>
      <EndpointEditor value={pair.left} onChange={(left) => onChange({ ...pair, left })} side={t('Sol')} />
      <div className="pair-arrow">
        <ArrowLeftRight size={16} />
      </div>
      <EndpointEditor value={pair.right} onChange={(right) => onChange({ ...pair, right })} side={t('Sağ')} />
      {onRemove ? <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} onClick={onRemove} /> : <span style={{ width: 27 }} />}
    </div>
  );
}

function EndpointEditor({ value, onChange, side }: { value: Endpoint; onChange: (e: Endpoint) => void; side: string }) {
  const nodes = useApp((s) => s.boot!.config.nodes);
  const localId = useApp((s) => s.boot!.identity.node?.id);
  const isElectron = useApp((s) => s.boot!.isElectron);
  const [browsing, setBrowsing] = useState(false);
  return (
    <div className="endpoint">
      <Segmented
        size="sm"
        value={value.kind}
        onChange={(k) => onChange(k === 'local' ? { kind: 'local', path: '' } : { kind: 'node', nodeId: '', subPath: '' })}
        options={[
          { value: 'local', label: '', icon: <Laptop size={13} />, tip: t('{side}: bu makinede bir klasör', { side }) },
          { value: 'node', label: '', icon: <Server size={13} />, tip: t('{side}: bir hedef makinenin klasörü', { side }) },
        ]}
      />
      {value.kind === 'local' ? (
        <>
          <input className="input sm mono grow" value={value.path} placeholder={t('C:\\klasör\\yolu')} onChange={(e) => onChange({ kind: 'local', path: e.target.value })} spellCheck={false} />
          <Button
            size="sm"
            iconOnly
            icon={<FolderOpen size={14} />}
            disabled={!isElectron}
            tip={t('Klasör seç')}
            onClick={async () => {
              const [p] = await api.pick({ folders: true, defaultPath: value.path || undefined });
              if (p) onChange({ kind: 'local', path: p });
            }}
          />
        </>
      ) : (
        <>
          <select className="select" style={{ height: 27, fontSize: 12.5, flex: '1 1 150px', minWidth: 120 }} value={value.nodeId} onChange={(e) => onChange({ ...value, nodeId: e.target.value })}>
            <option value="">{t('Makine seçin…')}</option>
            {nodes
              .filter((n) => n.id !== localId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.group ? `${n.group} / ` : ''}
                  {n.name}
                </option>
              ))}
          </select>
          <input className="input sm mono" style={{ flex: '1 1 110px', minWidth: 90 }} value={value.subPath} placeholder={t('alt klasör')} onChange={(e) => onChange({ ...value, subPath: e.target.value })} spellCheck={false} />
          <Button size="sm" iconOnly icon={<FolderOpen size={14} />} tip={t('Uzak klasöre göz at')} disabled={!value.nodeId} onClick={() => setBrowsing(true)} />
          {browsing && <RemoteBrowser endpoint={{ kind: 'node', nodeId: value.nodeId, subPath: '' }} start={value.subPath} onPick={(p) => onChange({ ...value, subPath: p })} onClose={() => setBrowsing(false)} />}
        </>
      )}
    </div>
  );
}

export function RemoteBrowser({ endpoint, start, onPick, onClose }: { endpoint: Endpoint; start: string; onPick: (rel: string) => void; onClose: () => void }) {
  const [rel, setRel] = useState(start.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
  const [entries, setEntries] = useState<BrowseEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEntries(null);
    setError(null);
    api
      .browse(endpoint, rel)
      .then(setEntries)
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel]);
  const parts = rel ? rel.split('/') : [];
  return (
    <Modal
      title={t('Uzak klasör seçin')}
      size="medium"
      icon={
        <div className="icon-tile accent">
          <Server size={16} />
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <span className="mono faint ellipsis grow">/{rel}</span>
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onPick(rel);
              onClose();
            }}
          >
            {t('Bu klasörü seç')}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="chip" onClick={() => setRel('')}>
          {t('kök')}
        </button>
        {parts.map((p, i) => (
          <span key={i} className="row" style={{ gap: 4 }}>
            <ChevronRight size={12} className="faint" />
            <button className="chip" onClick={() => setRel(parts.slice(0, i + 1).join('/'))}>
              {p}
            </button>
          </span>
        ))}
      </div>
      <div className="card flat" style={{ minHeight: 280, maxHeight: 420, overflow: 'auto' }}>
        {rel && (
          <div className="list-row" style={{ cursor: 'pointer' }} onClick={() => setRel(parts.slice(0, -1).join('/'))}>
            <CornerLeftUp size={14} className="faint" /> ..
          </div>
        )}
        {error && (
          <div className="alert error" style={{ margin: 10 }}>
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        {!entries && !error && (
          <div className="empty">
            <div className="spinner" />
          </div>
        )}
        {entries?.map((e) => (
          <div key={e.rel} className="list-row" style={{ cursor: e.isDir ? 'pointer' : 'default', opacity: e.isDir ? 1 : 0.55 }} onClick={() => e.isDir && setRel(e.rel)}>
            {e.isDir ? <Folder size={14} color="var(--accent)" /> : <File size={14} className="faint" />}
            <span className="ellipsis grow">{splitPath(e.rel).name}</span>
            {!e.isDir && <span className="faint tabular">{bytes(e.size)}</span>}
            <span className="faint tabular" style={{ fontSize: 11.5 }}>
              {shortDateTime(e.mtimeMs)}
            </span>
          </div>
        ))}
        {entries && !entries.length && <div className="faint" style={{ padding: 14 }}>{t('Boş klasör')}</div>}
      </div>
    </Modal>
  );
}

type Row = { pairId: string; it: CompareItem; pairLabel?: string };

function ResultView({
  result,
  variant,
  overrides,
  setOverride,
  resetOverrides,
  stats,
  work,
  onRun,
}: {
  result: CompareResult;
  variant: string;
  overrides: Record<string, Record<string, SyncAction>>;
  setOverride: (pairId: string, keys: string[], a: SyncAction) => void;
  resetOverrides: () => void;
  stats: Record<SyncAction | 'bytes', number>;
  work: number;
  onRun: () => void;
}) {
  const [hidden, setHidden] = useState<Set<Category>>(new Set(['equal']));
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ row: Row; el: HTMLElement } | null>(null);
  const [diffRow, setDiffRow] = useState<Row | null>(null);
  const [resolver, setResolver] = useState(false);
  const parent = useRef<HTMLDivElement>(null);

  const all: Row[] = useMemo(() => result.pairs.flatMap((p) => p.items.map((it) => ({ pairId: p.pairId, it }))), [result]);
  const ql = q.trim().toLowerCase();
  const rows = useMemo(() => all.filter((r) => !hidden.has(r.it.category) && (!ql || r.it.rel.toLowerCase().includes(ql))), [all, hidden, ql]);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 34, overscan: 20 });
  const act = (r: Row) => overrides[r.pairId]?.[r.it.key] ?? r.it.action;
  const errors = result.pairs.filter((p) => p.error);
  const overridden = Object.values(overrides).reduce((s, o) => s + Object.keys(o).length, 0);

  const options = (it: CompareItem): SyncAction[] => {
    const o: SyncAction[] = [];
    if (it.left) o.push('copyRight', 'deleteLeft');
    if (it.right) o.push('copyLeft', 'deleteRight');
    if (it.left && it.right && !it.isDir) o.push('keepBoth');
    o.push('none');
    return o;
  };
  const applyVisible = (a: SyncAction) => {
    const by = new Map<string, string[]>();
    for (const r of rows) if (options(r.it).includes(a)) by.set(r.pairId, [...(by.get(r.pairId) ?? []), r.it.key]);
    for (const [p, keys] of by) setOverride(p, keys, a);
  };

  return (
    <div className="card sync-result">
      <div className="sync-summary">
        {(Object.keys(CAT) as Category[]).map((c) => {
          const n = result.stats.byCategory[c];
          if (!n && c !== 'equal') return null;
          return (
            <button
              key={c}
              className={cls('cat-chip', !hidden.has(c) && 'on')}
              onClick={() =>
                setHidden((h) => {
                  const x = new Set(h);
                  x.has(c) ? x.delete(c) : x.add(c);
                  return x;
                })
              }
              data-tip={hidden.has(c) ? t('Göster') : t('Gizle')}
            >
              <span className={cls('sign', c)}>{CAT[c].sign}</span>
              {t(CAT[c].label)}
              <b className="tabular">{num(n)}</b>
            </button>
          );
        })}
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {variant} • {t('{s} sn', { s: (result.durationMs / 1000).toFixed(1) })}
        </span>
      </div>
      {errors.map((p) => (
        <div key={p.pairId} className="alert error" style={{ margin: '0 12px 8px' }}>
          <AlertTriangle size={15} />
          <div className="selectable">
            <b>
              {p.leftLabel} ⇄ {p.rightLabel}
            </b>
            <div style={{ whiteSpace: 'pre-wrap' }}>{p.error}</div>
          </div>
        </div>
      ))}
      <div className="row" style={{ padding: '0 12px 8px', gap: 6 }}>
        <SearchInput value={q} onChange={setQ} placeholder={t('Yolda ara')} style={{ width: 220 }} />
        <span className="faint" style={{ fontSize: 12 }}>
          {t('Görünenlere uygula:')}
        </span>
        {(['copyRight', 'copyLeft', 'none'] as SyncAction[]).map((a) => (
          <Button key={a} size="sm" icon={<ActionIcon a={a} />} onClick={() => applyVisible(a)} tip={t(ACTION[a].label)}>
            {''}
          </Button>
        ))}
        {overridden > 0 && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={resetOverrides}>
            {t('{n} değişikliği geri al', { n: overridden })}
          </Button>
        )}
      </div>
      <div className="table-head sync-cols">
        <span>{t('Göreli yol')}</span>
        <span>{t('Sol')}</span>
        <span style={{ textAlign: 'center' }}>{t('Durum')}</span>
        <span style={{ textAlign: 'center' }}>{t('İşlem')}</span>
        <span>{t('Sağ')}</span>
      </div>
      <div ref={parent} className="pane-scroll" style={{ flex: 1 }}>
        {rows.length === 0 ? (
          <Empty icon={<Equal size={20} />} title={all.length ? t('Gösterilecek fark yok') : t('Klasörler boş')}>
            {all.length ? t('İki taraf seçili filtrelere göre aynı.') : undefined}
          </Empty>
        ) : (
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index];
              const it = r.it;
              const a = act(r);
              const changed = a !== it.action;
              const { dir, name } = splitPath(it.rel);
              return (
                <div
                  key={`${r.pairId}|${it.key}`}
                  className="list-row sync-cols"
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size }}
                  onDoubleClick={() => !it.isDir && it.left && it.right && setDiffRow(r)}
                  title={it.conflict ?? it.rel}
                >
                  <span className="path" style={{ minWidth: 0 }}>
                    {it.isDir ? <Folder size={13} color="var(--accent)" style={{ flex: 'none', marginRight: 6 }} /> : null}
                    {dir && <span className="dir">{'\u200e' + dir + '\u200e'}</span>}
                    <span className="name">{name}</span>
                  </span>
                  <span className="faint tabular side">{it.left ? (it.left.isDir ? t('klasör') : `${bytes(it.left.size)} • ${shortDateTime(it.left.mtimeMs)}`) : ''}</span>
                  <span style={{ textAlign: 'center' }}>
                    <span className={cls('sign', it.category)} data-tip={it.conflict ?? t(CAT[it.category].label)} style={{ display: 'inline-grid' }}>
                      {CAT[it.category].sign}
                    </span>
                  </span>
                  <span style={{ textAlign: 'center' }}>
                    <button className={cls('action-btn', a, changed && 'changed')} onClick={(e) => setMenu({ row: r, el: e.currentTarget })} data-tip={t(ACTION[a].label)}>
                      <ActionIcon a={a} />
                    </button>
                  </span>
                  <span className="faint tabular side">{it.right ? (it.right.isDir ? t('klasör') : `${bytes(it.right.size)} • ${shortDateTime(it.right.mtimeMs)}`) : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="action-bar" style={{ margin: 0, borderRadius: 0, borderLeft: 0, borderRight: 0, borderBottom: 0 }}>
        <div className="row grow" style={{ gap: 12 }}>
          <span className="row" style={{ gap: 4 }}>
            <ArrowRight size={14} color="var(--accent)" /> <b className="tabular">{num(stats.copyRight)}</b>
          </span>
          <span className="row" style={{ gap: 4 }}>
            <ArrowLeft size={14} color="var(--accent)" /> <b className="tabular">{num(stats.copyLeft)}</b>
          </span>
          <span className="row" style={{ gap: 4 }}>
            <Trash2 size={13} color="var(--red)" /> <b className="tabular">{num(stats.deleteLeft + stats.deleteRight)}</b>
          </span>
          <span className="faint">{bytes(stats.bytes)}</span>
          {result.stats.byCategory.conflict > 0 && (
            <Button size="sm" icon={<AlertTriangle size={13} color="var(--amber)" />} onClick={() => setResolver(true)} tip={t('Çakışmaları tek tek ya da toplu çözün: sol, sağ, ikisini de sakla')}>
              {t('{n} çakışmayı çöz…', { n: result.stats.byCategory.conflict })}
            </Button>
          )}
        </div>
        <Button size="lg" variant="primary" icon={<Play size={15} />} disabled={!work} onClick={onRun}>
          {t('Senkronize et')}
        </Button>
      </div>
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} width={210} align="end">
          <MenuList
            onDone={() => setMenu(null)}
            items={[
              ...options(menu.row.it).map((a) => ({ label: t(ACTION[a].label), icon: <ActionIcon a={a} />, onClick: () => setOverride(menu.row.pairId, [menu.row.it.key], a), hint: a === menu.row.it.defaultAction ? t('öneri') : undefined })),
              ...(menu.row.it.left && menu.row.it.right && !menu.row.it.isDir ? [{ sep: true }, { label: t('Farkı göster'), icon: <Copy size={14} />, onClick: () => setDiffRow(menu.row) }] : []),
            ]}
          />
        </Popover>
      )}
      {diffRow && <SyncDiffModal compareId={result.id} row={diffRow} onClose={() => setDiffRow(null)} />}
      {resolver && <ConflictResolver result={result} act={act} setOverride={setOverride} onClose={() => setResolver(false)} />}
    </div>
  );
}

/**
 * The conflicts of a comparison on their own: both sides with size and time, the reason, and a choice per item
 * (left wins, right wins, keep both, leave) plus the same for all at once. The choices are the usual overrides.
 */
function ConflictResolver({ result, act, setOverride, onClose }: { result: CompareResult; act: (r: Row) => SyncAction; setOverride: (pairId: string, keys: string[], a: SyncAction) => void; onClose: () => void }) {
  const rows: Row[] = useMemo(() => result.pairs.flatMap((p) => p.items.filter((it) => it.category === 'conflict').map((it) => ({ pairId: p.pairId, it }))), [result]);
  const [diffRow, setDiffRow] = useState<Row | null>(null);
  const canKeep = (it: CompareItem) => !!it.left && !!it.right && !it.isDir;
  const choices = (it: CompareItem): SyncAction[] => [...(it.left ? (['copyRight'] as SyncAction[]) : []), ...(it.right ? (['copyLeft'] as SyncAction[]) : []), ...(canKeep(it) ? (['keepBoth'] as SyncAction[]) : []), 'none'];
  const TOL = 2000;
  const newer = (it: CompareItem): SyncAction | null => {
    if (!it.left || !it.right || it.isDir) return null;
    if (it.left.mtimeMs > it.right.mtimeMs + TOL) return 'copyRight';
    if (it.right.mtimeMs > it.left.mtimeMs + TOL) return 'copyLeft';
    return 'none';
  };
  const bulk = (pick: (it: CompareItem) => SyncAction | null) => {
    const by = new Map<string, Map<SyncAction, string[]>>();
    for (const r of rows) {
      const a = pick(r.it);
      if (!a) continue;
      const m = by.get(r.pairId) ?? new Map<SyncAction, string[]>();
      m.set(a, [...(m.get(a) ?? []), r.it.key]);
      by.set(r.pairId, m);
    }
    for (const [pairId, m] of by) for (const [a, keys] of m) setOverride(pairId, keys, a);
  };
  const decided = rows.filter((r) => act(r) !== 'none').length;
  const side = (m: FileMeta | undefined) => (m ? (m.isDir ? t('klasör') : `${bytes(m.size)} • ${shortDateTime(m.mtimeMs)}`) : t('yok'));
  return (
    <Modal
      size="wide"
      title={t('Çakışmaları çöz')}
      icon={<AlertTriangle size={16} color="var(--amber)" />}
      onClose={onClose}
      footer={
        <>
          <span className="muted grow" style={{ fontSize: 12.5 }}>
            {t('{done}/{n} karar verildi; karar verilmeyenlere dokunulmaz.', { done: decided, n: rows.length })}
          </span>
          <Button variant="primary" onClick={onClose}>
            {t('Tamam')}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          {t('Hepsine:')}
        </span>
        <Button size="sm" onClick={() => bulk(newer)} tip={t('Tarihi daha yeni olan taraf kazanır; tarihleri aynı olanlara dokunulmaz')}>
          {t('Yeni olan kazansın')}
        </Button>
        <Button size="sm" icon={<ArrowRight size={13} />} onClick={() => bulk((it) => (it.left ? 'copyRight' : null))}>
          {t('Sol kazansın')}
        </Button>
        <Button size="sm" icon={<ArrowLeft size={13} />} onClick={() => bulk((it) => (it.right ? 'copyLeft' : null))}>
          {t('Sağ kazansın')}
        </Button>
        <Button size="sm" icon={<Copy size={13} />} onClick={() => bulk((it) => (canKeep(it) ? 'keepBoth' : null))} tip={t('Her iki tarafa öbürünün sürümü "ad (sol).uzantı" / "ad (sağ).uzantı" olarak yazılır; hiçbir şey silinmez')}>
          {t('İkisini de sakla')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulk(() => 'none')}>
          {t('Hepsini atla')}
        </Button>
      </div>
      <div className="conflict-list">
        {rows.map((r) => {
          const it = r.it;
          const a = act(r);
          const lNewer = !!it.left && !!it.right && it.left.mtimeMs > it.right.mtimeMs + TOL;
          const rNewer = !!it.left && !!it.right && it.right.mtimeMs > it.left.mtimeMs + TOL;
          return (
            <div key={`${r.pairId}|${it.key}`} className="conflict-row">
              <div className="row" style={{ gap: 8 }}>
                <span className="mono ellipsis" style={{ fontWeight: 600, fontSize: 12.5 }} title={it.rel}>
                  {it.rel}
                </span>
                {it.conflict && <span className="badge amber">{it.conflict}</span>}
                <span className="spacer" />
                {canKeep(it) && (
                  <Button size="sm" variant="ghost" onClick={() => setDiffRow(r)}>
                    {t('Farkı göster')}
                  </Button>
                )}
              </div>
              <div className="conflict-sides">
                <div className={cls('conflict-side', a === 'copyRight' && 'win', a === 'copyLeft' && 'lose')}>
                  <div className="row faint" style={{ fontSize: 11, gap: 6 }}>
                    {t('Sol')} {lNewer && <span className="badge green">{t('daha yeni')}</span>}
                  </div>
                  <div className="tabular">{side(it.left)}</div>
                </div>
                <Segmented size="sm" value={a} onChange={(v) => setOverride(r.pairId, [it.key], v)} options={choices(it).map((o) => ({ value: o, label: <ActionIcon a={o} />, tip: t(ACTION[o].label) }))} />
                <div className={cls('conflict-side', a === 'copyLeft' && 'win', a === 'copyRight' && 'lose')}>
                  <div className="row faint" style={{ fontSize: 11, gap: 6 }}>
                    {t('Sağ')} {rNewer && <span className="badge green">{t('daha yeni')}</span>}
                  </div>
                  <div className="tabular">{side(it.right)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {diffRow && <SyncDiffModal compareId={result.id} row={diffRow} onClose={() => setDiffRow(null)} />}
    </Modal>
  );
}

function SyncDiffModal({ compareId, row, onClose }: { compareId: string; row: Row; onClose: () => void }) {
  const [state, setState] = useState<{ diff: DiffResult | null; loading: boolean; error?: string }>({ diff: null, loading: true });
  useEffect(() => {
    api
      .syncItemDiff(compareId, row.pairId, row.it.key)
      .then((diff) => setState({ diff, loading: false }))
      .catch((e) => setState({ diff: null, loading: false, error: (e as Error).message }));
  }, [compareId, row]);
  return (
    <Modal size="wide" title={<span className="mono" style={{ fontSize: 13 }}>{row.it.rel}</span>} onClose={onClose}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DiffView diff={state.diff} loading={state.loading} error={state.error} title={<span className="muted">{t('Sağ (eski) → sol')}</span>} />
      </div>
    </Modal>
  );
}

function ScheduleEditor({ job, onChange }: { job: SyncJob; onChange: (s: SyncSchedule | undefined) => void }) {
  const nodes = useApp((s) => s.boot!.config.nodes);
  const localId = useApp((s) => s.boot!.identity.node?.id);
  const automation = useApp((s) => s.automation);
  const s = job.schedule;
  const state = automation?.schedules.find((x) => x.jobId === job.id);
  const enable = (on: boolean) =>
    onChange(on ? { mode: 'interval', everyMinutes: 60, times: [], machineId: localId, notify: 'errors', ...(s ?? {}), enabled: true } : s ? { ...s, enabled: false } : undefined);
  return (
    <div className="schedule-box">
      <div className="row" style={{ gap: 10 }}>
        <Switch on={!!s?.enabled} onChange={enable} />
        <CalendarClock size={15} className="faint" />
        <b style={{ fontSize: 13 }}>{t('Zamanla')}</b>
        <span className="faint" style={{ fontSize: 12 }}>
          {s?.enabled ? describeSchedule(s) : t('Bu iş yalnızca elle çalışır')}
          {s?.enabled && state?.nextAt ? ` • ${t('sonraki {time}', { time: new Date(state.nextAt).toLocaleString(locale(), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) })}` : ''}
          {s?.enabled && state && !state.activeHere ? ` • ${state.reason}` : ''}
        </span>
      </div>
      {s?.enabled && (
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 10 }}>
          <Field label={t('Ne zaman')}>
            <Segmented
              value={s.mode}
              onChange={(mode) => onChange({ ...s, mode })}
              options={[
                { value: 'interval', label: t('Aralıkla') },
                { value: 'times', label: t('Belirli saatlerde') },
              ]}
            />
          </Field>
          {s.mode === 'interval' ? (
            <Field label={t('Her (dakika)')}>
              <input className="input" type="number" min={1} value={s.everyMinutes} onChange={(e) => onChange({ ...s, everyMinutes: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 100 }} />
            </Field>
          ) : (
            <Field label={t('Saatler (SS:dd)')} style={{ minWidth: 240 }}>
              <TagInput value={s.times} onChange={(times) => onChange({ ...s, times: times.filter((x) => /^\d{1,2}:\d{2}$/.test(x)) })} placeholder="09:00" />
            </Field>
          )}
          <Field label={t('Çalışacağı makine')} help={t('Yapılandırma ortak; iş yalnızca bu makinede çalışır')}>
            <select className="select" value={s.machineId ?? ''} onChange={(e) => onChange({ ...s, machineId: e.target.value || undefined })} style={{ width: 270 }}>
              <option value="">{t('Her makinede (önerilmez)')}</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                  {n.id === localId ? ' ' + t('(bu makine)') : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Bildirim')}>
            <select className="select" value={s.notify} onChange={(e) => onChange({ ...s, notify: e.target.value as SyncSchedule['notify'] })} style={{ width: 170 }}>
              <option value="errors">{t('Yalnızca hatada')}</option>
              <option value="changes">{t('Değişiklik olunca')}</option>
              <option value="always">{t('Her çalışmada')}</option>
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}
