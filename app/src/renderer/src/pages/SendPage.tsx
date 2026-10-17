import { useEffect, useState } from 'react';
import { FilePlus, FolderPlus, File, Folder, X, Trash2, Copy, UploadCloud, ArrowRight, ShieldCheck, Bell, Terminal, FlaskConical, History as HistoryIcon, Filter, ChevronDown, ChevronRight, AlertTriangle, Send, Eye, Zap, Plus } from 'lucide-react';
import { useApp } from '../store/app';
import { TargetPicker } from '../components/TargetPicker';
import { Button, Segmented, TagInput, ToggleRow, Field, Modal } from '../components/ui';
import { api } from '../lib/api';
import { bytes, cls, num, baseName } from '../lib/format';
import type { SendMode, CompareMethod, QuickSend } from '@shared/types';
import { t, tk } from '@shared/i18n';
import { tx } from '../lib/i18n';
import { pickOverrides } from '@shared/options';
import { useStartWatchFromSend } from './AutomationPage';
import { WorkspaceTabs } from '../components/WorkspaceTabs';

export const MODE_OPTIONS: { value: SendMode; label: string; tip: string }[] = [
  { value: 'overwrite', label: tk('Üzerine yaz'), tip: tk('Yeni ve değişen her dosyayı yazar.\nHedefteki daha yeni dosyalar da güncellenir (uyarıyla).') },
  { value: 'update', label: tk('Yalnızca yeni'), tip: tk('Hedefte daha yeni ya da aynı yaştaki dosyalara dokunmaz.') },
  { value: 'mirror', label: tk('Ayna'), tip: tk('Klasörleri birebir eşitler:\nhedefte olup kaynakta olmayan dosyaları siler.') },
];

export const COMPARE_OPTIONS: { value: CompareMethod; label: string; tip: string }[] = [
  { value: 'timeSize', label: tk('Tarih + boyut'), tip: tk('Hızlı: değiştirilme tarihi ve boyut') },
  { value: 'content', label: tk('İçerik'), tip: tk('Kesin: aynı boyuttaki dosyaları bayt bayt karşılaştırır (yavaş)') },
  { value: 'size', label: tk('Boyut'), tip: tk('Yalnızca boyuta bakar') },
];

/** The option lists above in the current language, for Segmented. */
export function modeOptions() {
  return MODE_OPTIONS.map((o) => ({ ...o, label: t(o.label), tip: t(o.tip) }));
}

export function compareOptions() {
  return COMPARE_OPTIONS.map((o) => ({ ...o, label: t(o.label), tip: t(o.tip) }));
}

export function SendPage() {
  const paths = useApp((s) => s.sendPaths);
  const infos = useApp((s) => s.sendInfos);
  const add = useApp((s) => s.addSendPaths);
  const remove = useApp((s) => s.removeSendPath);
  const clear = useApp((s) => s.clearSendPaths);
  const targets = useApp((s) => s.targets);
  const setTargets = useApp((s) => s.setTargets);
  const options = useApp((s) => s.options);
  const startPlan = useApp((s) => s.startPlan);
  const toast = useApp((s) => s.toast);
  const isElectron = useApp((s) => s.boot!.isElectron);
  const [manual, setManual] = useState('');
  const startWatch = useStartWatchFromSend();

  const pickFiles = async () => {
    const p = await api.pick({ files: true, multi: true, title: t('Gönderilecek dosyalar') });
    if (p.length) await add(p);
  };
  const pickFolders = async () => {
    const p = await api.pick({ folders: true, multi: true, title: t('Gönderilecek klasörler') });
    if (p.length) await add(p);
  };

  const totalSize = infos.reduce((s, i) => s + i.size, 0);
  const files = infos.reduce((s, i) => s + (!i.exists ? 0 : i.isDir ? i.fileCount ?? 0 : 1), 0);
  const dirs = infos.filter((i) => i.isDir).length;
  const missing = infos.filter((i) => !i.exists).length;

  const review = () => startPlan({ sources: paths.map((p) => ({ kind: 'fs', path: p })), origin: 'send', label: paths.length === 1 ? baseName(paths[0]) : t('{n} öğe', { n: paths.length }) });
  // Ctrl Enter from the app shell
  useEffect(() => {
    const h = () => {
      if (paths.length && targets.length) void review();
    };
    window.addEventListener('samsync:review', h);
    return () => window.removeEventListener('samsync:review', h);
  });
  const modeLabel = MODE_OPTIONS.find((m) => m.value === options.mode)?.label;
  const ownSettings = pickOverrides(options.perTarget, targets);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Gönder')}</h1>
          <div className="sub">{t('Dosya ve klasörleri seçili makinelere, yerel köke göre aynı göreli yolla gönderin.')}</div>
        </div>
        <Button icon={<FilePlus size={15} />} onClick={pickFiles} disabled={!isElectron}>
          {t('Dosya ekle')}
        </Button>
        <Button icon={<FolderPlus size={15} />} onClick={pickFolders} disabled={!isElectron}>
          {t('Klasör ekle')}
        </Button>
      </div>
      <div className="page-body fill" style={{ display: 'flex', flexDirection: 'column' }}>
        <WorkspaceTabs />
        <QuickSendsBar canSave={paths.length > 0 && targets.length > 0} />
        <div className="send-grid" style={{ flex: 1, minHeight: 0 }}>
          <div className="col" style={{ gap: 14, minHeight: 0 }}>
            <div className="card sources-card">
              <div className="card-head">
                <div className="icon-tile">
                  <UploadCloud size={15} />
                </div>
                <h2>{t('Kaynaklar')}</h2>
                {infos.length > 0 && (
                  <span className="hint">
                    {t('{n} öğe', { n: num(infos.length) })} • {t('{n} dosya', { n: files })}, {t('{n} klasör', { n: dirs })} • {bytes(totalSize)}
                  </span>
                )}
                <span className="spacer" />
                {infos.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy size={13} />}
                      onClick={() => {
                        void navigator.clipboard.writeText(paths.join('\n'));
                        toast('ok', t('Yollar panoya kopyalandı'));
                      }}
                    >
                      {t('Kopyala')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={clear}>
                      {t('Temizle')}
                    </Button>
                  </>
                )}
              </div>
              {infos.length === 0 && paths.length === 0 ? (
                <div className="drop-zone send-drop">
                  <div className="empty-icon" style={{ width: 60, height: 60, borderRadius: 18 }}>
                    <UploadCloud size={26} />
                  </div>
                  <h3>{t('Dosya veya klasörleri buraya sürükleyin')}</h3>
                  <p className="muted">{t('Ya da seçin. Explorer’da sağ tık → “SamSync ile gönder” de buraya getirir.')}</p>
                  <div className="row" style={{ marginTop: 6 }}>
                    <Button icon={<FilePlus size={15} />} onClick={pickFiles} disabled={!isElectron}>
                      {t('Dosya seç')}
                    </Button>
                    <Button icon={<FolderPlus size={15} />} onClick={pickFolders} disabled={!isElectron}>
                      {t('Klasör seç')}
                    </Button>
                  </div>
                  <div className="row" style={{ marginTop: 10, width: 'min(520px, 100%)' }}>
                    <input
                      className="input sm mono"
                      placeholder={t('…ya da tam yolu yapıştırın ve Enter’a basın')}
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && manual.trim()) {
                          void add(manual.split(/\r?\n/).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean));
                          setManual('');
                        }
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="source-list">
                  {missing > 0 && (
                    <div className="alert error" style={{ margin: 10 }}>
                      <AlertTriangle size={15} /> {t('{n} öğe bulunamadı; gönderimde atlanacak.', { n: missing })}
                    </div>
                  )}
                  {infos.map((i) => (
                    <div key={i.path} className={cls('source-row', !i.exists && 'missing')}>
                      <div className={cls('icon-tile', i.isDir && 'accent')}>{i.isDir ? <Folder size={15} /> : <File size={15} />}</div>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="ellipsis" style={{ fontWeight: 580 }}>
                            {baseName(i.path)}
                          </span>
                          {!i.exists && <span className="badge red">{t('bulunamadı')}</span>}
                          {i.outsideRoots ? (
                            <span className="badge amber" data-tip={t('Hiçbir yerel kökün altında değil:\nsürücü harfiyle birlikte tam yolu korunur')}>
                              {t('kök dışı')}
                            </span>
                          ) : (
                            i.root && (
                              <span className="badge" data-tip={t('Yerel kök: {path}', { path: i.root })}>
                                {baseName(i.root)}
                              </span>
                            )
                          )}
                        </div>
                        <div className="row faint mono" style={{ fontSize: 11.5, gap: 6 }}>
                          <ArrowRight size={11} style={{ flex: 'none' }} />
                          <span className="ellipsis selectable" title={i.path}>
                            {i.rel || t('(kökün kendisi)')}
                            {i.isDir ? '/' : ''}
                          </span>
                        </div>
                      </div>
                      <span className="faint tabular nowrap" style={{ fontSize: 12 }}>
                        {i.isDir ? `${t('{n} dosya', { n: num(i.fileCount ?? 0) + (i.fileCountCapped ? '+' : '') })} • ${bytes(i.size)}` : bytes(i.size)}
                      </span>
                      <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} onClick={() => remove(i.path)} tip={t('Listeden çıkar')} />
                    </div>
                  ))}
                  {paths.length > infos.length && (
                    <div className="row faint" style={{ padding: 12 }}>
                      <div className="spinner" /> {t('Kaynaklar okunuyor…')}
                    </div>
                  )}
                </div>
              )}
            </div>
            <OptionsCard />
          </div>

          <div className="card targets-card">
            <div className="card-head">
              <div className="icon-tile">
                <Send size={15} />
              </div>
              <h2>{t('Hedefler')}</h2>
              <span className="spacer" />
            </div>
            <TargetPicker value={targets} onChange={setTargets} overrides />
          </div>
        </div>

        <div className="action-bar">
          <div className="grow row" style={{ gap: 10 }}>
            <span className="tabular">
              {tx(
                '{sources} kaynak {arrow} {targets} hedef',
                { sources: <b>{num(paths.length)}</b>, arrow: <ArrowRight size={13} style={{ verticalAlign: -2 }} />, targets: <b>{targets.length}</b> },
                { s: paths.length, n: targets.length },
              )}
            </span>
            <span className="badge outline">{modeLabel && t(modeLabel)}</span>
            {options.backup && <span className="badge blue">{t('yedekli')}</span>}
            {options.dryRun && <span className="badge amber">{t('deneme')}</span>}
            {Object.keys(ownSettings).length > 0 && (
              <span className="badge violet" data-tip={t('Bu hedeflerin kipi ya da yedeği genel ayardan farklı')}>
                {t('{n} hedefte özel ayar', { n: Object.keys(ownSettings).length })}
              </span>
            )}
          </div>
          <Button size="lg" icon={<Eye size={15} />} disabled={!paths.length || !targets.length} onClick={() => void startWatch()} tip={t('Bu kaynakları izler; değiştikçe\nseçili hedeflere kendiliğinden gönderir')}>
            {t('İzle')}
          </Button>
          <Button size="lg" icon={<FlaskConical size={15} />} disabled={!paths.length || !targets.length} onClick={() => startPlan({ sources: paths.map((p) => ({ kind: 'fs', path: p })), origin: 'send', options: { dryRun: true }, label: t('Deneme') })}>
            {t('Deneme')}
          </Button>
          <Button size="lg" variant="primary" icon={<Send size={15} />} disabled={!paths.length || !targets.length} onClick={review}>
            {t('İncele ve gönder')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Saved sends: the current sources, targets and options under a name, run again with one click here, from
 * the tray, the command palette or `--quick <name>`.
 */
const NO_QUICK: QuickSend[] = [];

function QuickSendsBar({ canSave }: { canSave: boolean }) {
  // the selector must return the same value while nothing changed, or the store rerenders without end
  const quick = useApp((s) => s.boot?.settings.quickSends) ?? NO_QUICK;
  const run = useApp((s) => s.runQuickSend);
  const save = useApp((s) => s.saveQuickSend);
  const remove = useApp((s) => s.removeQuickSend);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [review, setReview] = useState(false);
  const [hotkey, setHotkey] = useState('');
  if (!quick.length && !canSave) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      <span className="faint row" style={{ fontSize: 12, gap: 4 }}>
        <Zap size={13} /> {t('Hızlı gönderimler')}
      </span>
      {quick.map((q) => (
        <span key={q.id} className="chip row" style={{ gap: 4 }} data-tip={t('{n} kaynak → {targets} hedef{review}', { n: q.paths.length, targets: q.targetIds.length, review: q.review ? ` • ${t('inceleyerek')}` : '' })}>
          <button className="chip-btn" onClick={() => run(q)}>
            <Send size={12} /> {q.name}
            {q.hotkey && <span className="kbd">{q.hotkey}</span>}
          </button>
          <button
            className="chip-x"
            aria-label={t('Kaldır')}
            onClick={async () => {
              if (!confirm(t('“{name}” hızlı gönderimi kaldırılsın mı?', { name: q.name }))) return;
              await remove(q.id);
            }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {canSave && (
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setNaming(true)}>
          {t('Bu listeyi kaydet')}
        </Button>
      )}
      {naming && (
        <Modal
          title={t('Hızlı gönderim kaydet')}
          icon={<Zap size={16} />}
          onClose={() => setNaming(false)}
          footer={
            <>
              <span className="spacer" />
              <Button onClick={() => setNaming(false)}>{t('Vazgeç')}</Button>
              <Button
                variant="primary"
                disabled={!name.trim()}
                onClick={async () => {
                  await save(name.trim(), review, hotkey);
                  setNaming(false);
                  setName('');
                  setHotkey('');
                }}
              >
                {t('Kaydet')}
              </Button>
            </>
          }
        >
          <Field label={t('Ad')} help={t('Tepside, komut paletinde ve komut satırında (--quick "ad") bu adla görünür')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('DLL → Dozer')} autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void save(name.trim(), review, hotkey).then(() => setNaming(false))} />
          </Field>
          <Field label={t('Kısayol tuşu (isteğe bağlı)')} help={t('Her yerden çalışır, uygulama tepsideyken de; örn. Ctrl+Alt+1. Başka bir program kullanıyorsa atanamaz.')}>
            <input className="input mono" value={hotkey} onChange={(e) => setHotkey(e.target.value)} placeholder="Ctrl+Alt+1" />
          </Field>
          <ToggleRow icon={<Eye size={16} className="faint" />} title={t('Önce incele')} desc={t('Kapalıyken plan hesaplanır hesaplanmaz gönderilir; hedefte silme olacaksa yine inceleme açılır')} on={review} onChange={setReview} />
        </Modal>
      )}
    </div>
  );
}

export function OptionsCard({ git }: { git?: boolean }) {
  const options = useApp((s) => s.options);
  const set = useApp((s) => s.setOptions);
  const postCommand = useApp((s) => s.boot!.config.copy.postCommand);
  const [filters, setFilters] = useState(false);
  return (
    <div className="card options-card">
      <div className="card-head">
        <div className="icon-tile">
          <ShieldCheck size={15} />
        </div>
        <h2>{t('Seçenekler')}</h2>
      </div>
      <div className="card-body options-body">
        <div className="options-row">
          <Field label={t('Kip')}>
            <Segmented value={options.mode} onChange={(v) => set({ mode: v })} options={modeOptions()} />
          </Field>
          {!git && (
            <Field label={t('Karşılaştırma')}>
              <Segmented value={options.compare} onChange={(v) => set({ compare: v })} options={compareOptions()} />
            </Field>
          )}
          <Field label={t('Eşzamanlı hedef')}>
            <input className="input" type="number" min={1} max={32} value={options.parallelTargets} onChange={(e) => set({ parallelTargets: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })} style={{ width: 80 }} />
          </Field>
        </div>
        <div className="options-toggles">
          <ToggleRow icon={<HistoryIcon size={16} className="faint" />} title={t('Yedek al')} desc={t('Üzerine yazılan ve silinen dosyaların eski hâli hedefte saklanır')} on={options.backup} onChange={(v) => set({ backup: v })} />
          <ToggleRow icon={<ShieldCheck size={16} className="faint" />} title={t('Doğrula')} desc={t('Yazdıktan sonra içerik özetini karşılaştırır')} on={options.verify} onChange={(v) => set({ verify: v })} />
          {git && <ToggleRow icon={<Trash2 size={16} className="faint" />} title={t('Silinenleri hedefte de sil')} desc={t('Git’te silinen ya da taşınan dosyalar hedeften kaldırılır')} on={options.propagateDeletes} onChange={(v) => set({ propagateDeletes: v })} />}
          <ToggleRow icon={<Bell size={16} className="faint" />} title={t('Bitince bildir')} desc={t('Masaüstü bildirimi gösterir')} on={options.notify} onChange={(v) => set({ notify: v })} />
          {postCommand && <ToggleRow icon={<Terminal size={16} className="faint" />} title={t('Sonrası komut')} desc={<span className="mono">{postCommand}</span>} on={options.runPostCommand} onChange={(v) => set({ runPostCommand: v })} />}
        </div>
        <button className="link-btn row" style={{ gap: 4, marginTop: 4 }} onClick={() => setFilters((f) => !f)}>
          {filters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Filter size={13} /> {t('Filtreler')}
          {(options.excludeFiles.length > 0 || options.excludeDirs.length > 0) && (
            <span className="badge" style={{ marginLeft: 4 }}>
              {options.excludeFiles.length + options.excludeDirs.length}
            </span>
          )}
        </button>
        {filters && (
          <div className="options-row" style={{ marginTop: 10 }}>
            <Field label={t('Hariç dosyalar')} help={t('*.pdb, *.tmp, desktop.ini — ada göre her klasörde')}>
              <TagInput value={options.excludeFiles} onChange={(v) => set({ excludeFiles: v })} placeholder="*.pdb" />
            </Field>
            <Field label={t('Hariç klasörler')} help={t('.git, Logs, bin/Debug — ada ya da göreli yola göre')}>
              <TagInput value={options.excludeDirs} onChange={(v) => set({ excludeDirs: v })} placeholder="Logs" />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
