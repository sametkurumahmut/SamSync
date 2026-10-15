import { useState } from 'react';
import { FilePlus, FolderPlus, File, Folder, X, Trash2, Copy, UploadCloud, ArrowRight, ShieldCheck, Bell, Terminal, FlaskConical, History as HistoryIcon, Filter, ChevronDown, ChevronRight, AlertTriangle, Send, Eye } from 'lucide-react';
import { useApp } from '../store/app';
import { TargetPicker } from '../components/TargetPicker';
import { Button, Segmented, TagInput, ToggleRow, Field } from '../components/ui';
import { api } from '../lib/api';
import { bytes, cls, num, baseName } from '../lib/format';
import type { SendMode, CompareMethod } from '@shared/types';
import { useStartWatchFromSend } from './AutomationPage';

export const MODE_OPTIONS: { value: SendMode; label: string; tip: string }[] = [
  { value: 'overwrite', label: 'Üzerine yaz', tip: 'Yeni ve değişen her dosyayı yazar.\nHedefteki daha yeni dosyalar da güncellenir (uyarıyla).' },
  { value: 'update', label: 'Yalnızca yeni', tip: 'Hedefte daha yeni ya da aynı yaştaki dosyalara dokunmaz.' },
  { value: 'mirror', label: 'Ayna', tip: 'Klasörleri birebir eşitler:\nhedefte olup kaynakta olmayan dosyaları siler.' },
];

export const COMPARE_OPTIONS: { value: CompareMethod; label: string; tip: string }[] = [
  { value: 'timeSize', label: 'Tarih + boyut', tip: 'Hızlı: değiştirilme tarihi ve boyut' },
  { value: 'content', label: 'İçerik', tip: 'Kesin: aynı boyuttaki dosyaları bayt bayt karşılaştırır (yavaş)' },
  { value: 'size', label: 'Boyut', tip: 'Yalnızca boyuta bakar' },
];

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
    const p = await api.pick({ files: true, multi: true, title: 'Gönderilecek dosyalar' });
    if (p.length) await add(p);
  };
  const pickFolders = async () => {
    const p = await api.pick({ folders: true, multi: true, title: 'Gönderilecek klasörler' });
    if (p.length) await add(p);
  };

  const totalSize = infos.reduce((s, i) => s + i.size, 0);
  const files = infos.reduce((s, i) => s + (!i.exists ? 0 : i.isDir ? i.fileCount ?? 0 : 1), 0);
  const dirs = infos.filter((i) => i.isDir).length;
  const missing = infos.filter((i) => !i.exists).length;

  const review = () => startPlan({ sources: paths.map((p) => ({ kind: 'fs', path: p })), origin: 'send', label: paths.length === 1 ? baseName(paths[0]) : `${paths.length} öğe` });

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Gönder</h1>
          <div className="sub">Dosya ve klasörleri seçili makinelere, yerel köke göre aynı göreli yolla gönderin.</div>
        </div>
        <Button icon={<FilePlus size={15} />} onClick={pickFiles} disabled={!isElectron}>
          Dosya ekle
        </Button>
        <Button icon={<FolderPlus size={15} />} onClick={pickFolders} disabled={!isElectron}>
          Klasör ekle
        </Button>
      </div>
      <div className="page-body fill">
        <div className="send-grid">
          <div className="col" style={{ gap: 14, minHeight: 0 }}>
            <div className="card sources-card">
              <div className="card-head">
                <div className="icon-tile">
                  <UploadCloud size={15} />
                </div>
                <h2>Kaynaklar</h2>
                {infos.length > 0 && (
                  <span className="hint">
                    {num(infos.length)} öğe • {files} dosya, {dirs} klasör • {bytes(totalSize)}
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
                        toast('ok', 'Yollar panoya kopyalandı');
                      }}
                    >
                      Kopyala
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={clear}>
                      Temizle
                    </Button>
                  </>
                )}
              </div>
              {infos.length === 0 && paths.length === 0 ? (
                <div className="drop-zone send-drop">
                  <div className="empty-icon" style={{ width: 60, height: 60, borderRadius: 18 }}>
                    <UploadCloud size={26} />
                  </div>
                  <h3>Dosya veya klasörleri buraya sürükleyin</h3>
                  <p className="muted">Ya da seçin. Explorer’da sağ tık → “SamSync ile gönder” de buraya getirir.</p>
                  <div className="row" style={{ marginTop: 6 }}>
                    <Button icon={<FilePlus size={15} />} onClick={pickFiles} disabled={!isElectron}>
                      Dosya seç
                    </Button>
                    <Button icon={<FolderPlus size={15} />} onClick={pickFolders} disabled={!isElectron}>
                      Klasör seç
                    </Button>
                  </div>
                  <div className="row" style={{ marginTop: 10, width: 'min(520px, 100%)' }}>
                    <input
                      className="input sm mono"
                      placeholder="…ya da tam yolu yapıştırın ve Enter’a basın"
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
                      <AlertTriangle size={15} /> {missing} öğe bulunamadı; gönderimde atlanacak.
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
                          {!i.exists && <span className="badge red">bulunamadı</span>}
                          {i.outsideRoots ? (
                            <span className="badge amber" data-tip={'Hiçbir yerel kökün altında değil:\nsürücü harfiyle birlikte tam yolu korunur'}>
                              kök dışı
                            </span>
                          ) : (
                            i.root && (
                              <span className="badge" data-tip={`Yerel kök: ${i.root}`}>
                                {baseName(i.root)}
                              </span>
                            )
                          )}
                        </div>
                        <div className="row faint mono" style={{ fontSize: 11.5, gap: 6 }}>
                          <ArrowRight size={11} style={{ flex: 'none' }} />
                          <span className="ellipsis selectable" title={i.path}>
                            {i.rel || '(kökün kendisi)'}
                            {i.isDir ? '/' : ''}
                          </span>
                        </div>
                      </div>
                      <span className="faint tabular nowrap" style={{ fontSize: 12 }}>
                        {i.isDir ? `${num(i.fileCount ?? 0)}${i.fileCountCapped ? '+' : ''} dosya • ${bytes(i.size)}` : bytes(i.size)}
                      </span>
                      <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} onClick={() => remove(i.path)} tip="Listeden çıkar" />
                    </div>
                  ))}
                  {paths.length > infos.length && (
                    <div className="row faint" style={{ padding: 12 }}>
                      <div className="spinner" /> Kaynaklar okunuyor…
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
              <h2>Hedefler</h2>
              <span className="spacer" />
            </div>
            <TargetPicker value={targets} onChange={setTargets} />
          </div>
        </div>

        <div className="action-bar">
          <div className="grow row" style={{ gap: 10 }}>
            <span className="tabular">
              <b>{num(paths.length)}</b> kaynak <ArrowRight size={13} style={{ verticalAlign: -2 }} /> <b>{targets.length}</b> hedef
            </span>
            <span className="badge outline">{MODE_OPTIONS.find((m) => m.value === options.mode)?.label}</span>
            {options.backup && <span className="badge blue">yedekli</span>}
            {options.dryRun && <span className="badge amber">deneme</span>}
          </div>
          <Button size="lg" icon={<Eye size={15} />} disabled={!paths.length || !targets.length} onClick={() => void startWatch()} tip={'Bu kaynakları izler; değiştikçe\nseçili hedeflere kendiliğinden gönderir'}>
            İzle
          </Button>
          <Button size="lg" icon={<FlaskConical size={15} />} disabled={!paths.length || !targets.length} onClick={() => startPlan({ sources: paths.map((p) => ({ kind: 'fs', path: p })), origin: 'send', options: { dryRun: true }, label: 'Deneme' })}>
            Deneme
          </Button>
          <Button size="lg" variant="primary" icon={<Send size={15} />} disabled={!paths.length || !targets.length} onClick={review}>
            İncele ve gönder
          </Button>
        </div>
      </div>
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
        <h2>Seçenekler</h2>
      </div>
      <div className="card-body options-body">
        <div className="options-row">
          <Field label="Kip">
            <Segmented value={options.mode} onChange={(v) => set({ mode: v })} options={MODE_OPTIONS} />
          </Field>
          {!git && (
            <Field label="Karşılaştırma">
              <Segmented value={options.compare} onChange={(v) => set({ compare: v })} options={COMPARE_OPTIONS} />
            </Field>
          )}
          <Field label="Eşzamanlı hedef">
            <input className="input" type="number" min={1} max={16} value={options.parallelTargets} onChange={(e) => set({ parallelTargets: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })} style={{ width: 80 }} />
          </Field>
        </div>
        <div className="options-toggles">
          <ToggleRow icon={<HistoryIcon size={16} className="faint" />} title="Yedek al" desc="Üzerine yazılan ve silinen dosyaların eski hâli hedefte saklanır" on={options.backup} onChange={(v) => set({ backup: v })} />
          <ToggleRow icon={<ShieldCheck size={16} className="faint" />} title="Doğrula" desc="Yazdıktan sonra içerik özetini karşılaştırır" on={options.verify} onChange={(v) => set({ verify: v })} />
          {git && <ToggleRow icon={<Trash2 size={16} className="faint" />} title="Silinenleri hedefte de sil" desc="Git’te silinen ya da taşınan dosyalar hedeften kaldırılır" on={options.propagateDeletes} onChange={(v) => set({ propagateDeletes: v })} />}
          <ToggleRow icon={<Bell size={16} className="faint" />} title="Bitince bildir" desc="Masaüstü bildirimi gösterir" on={options.notify} onChange={(v) => set({ notify: v })} />
          {postCommand && <ToggleRow icon={<Terminal size={16} className="faint" />} title="Sonrası komut" desc={<span className="mono">{postCommand}</span>} on={options.runPostCommand} onChange={(v) => set({ runPostCommand: v })} />}
        </div>
        <button className="link-btn row" style={{ gap: 4, marginTop: 4 }} onClick={() => setFilters((f) => !f)}>
          {filters ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Filter size={13} /> Filtreler
          {(options.excludeFiles.length > 0 || options.excludeDirs.length > 0) && (
            <span className="badge" style={{ marginLeft: 4 }}>
              {options.excludeFiles.length + options.excludeDirs.length}
            </span>
          )}
        </button>
        {filters && (
          <div className="options-row" style={{ marginTop: 10 }}>
            <Field label="Hariç dosyalar" help="*.pdb, *.tmp, desktop.ini — ada göre her klasörde">
              <TagInput value={options.excludeFiles} onChange={(v) => set({ excludeFiles: v })} placeholder="*.pdb" />
            </Field>
            <Field label="Hariç klasörler" help=".git, Logs, bin/Debug — ada ya da göreli yola göre">
              <TagInput value={options.excludeDirs} onChange={(v) => set({ excludeDirs: v })} placeholder="Logs" />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
