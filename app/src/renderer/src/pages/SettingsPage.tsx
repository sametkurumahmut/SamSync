import { useEffect, useState, type ReactNode } from 'react';
import { Palette, Copy as CopyIcon, FileJson, MousePointerClick, Download, Info, Save, RotateCcw, FolderOpen, Upload, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Monitor, Sun, Moon, Globe, FolderSync, Power, ExternalLink, FileText, Cloud, PanelBottomClose } from 'lucide-react';
import type { CopySettings, UpdateConfig, UpdateSource } from '@shared/types';
import type { ExplorerMenuStatus } from '@shared/api';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Field, Progress, Segmented, Switch, TagInput, ToggleRow } from '../components/ui';
import { ago, cls } from '../lib/format';

const ACCENTS = ['#2f7cf6', '#0ea5e9', '#14b8a6', '#22c55e', '#8b5cf6', '#ec4899', '#f97316', '#e11d48'];

function Section({ id, icon, title, desc, children, action }: { id: string; icon: ReactNode; title: string; desc?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card settings-section" id={id}>
      <div className="card-head">
        <div className="icon-tile">{icon}</div>
        <div className="grow">
          <h2>{title}</h2>
          {desc && <div className="hint">{desc}</div>}
        </div>
        {action}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const boot = useApp((s) => s.boot!);
  const s = boot.settings;
  const saveSettings = useApp((st) => st.saveSettings);
  const saveConfig = useApp((st) => st.saveConfig);
  const setBoot = useApp((st) => st.setBoot);
  const toast = useApp((st) => st.toast);
  const update = useApp((st) => st.update);
  const [copy, setCopy] = useState<CopySettings>(boot.config.copy);
  const [upd, setUpd] = useState<UpdateConfig>(boot.config.update ?? { source: 'github' });
  const [menu, setMenu] = useState<ExplorerMenuStatus | null>(null);
  const copyDirty = JSON.stringify(copy) !== JSON.stringify(boot.config.copy);
  const updDirty = JSON.stringify(upd) !== JSON.stringify(boot.config.update ?? { source: 'github' });

  useEffect(() => setCopy(boot.config.copy), [boot.config.copy]);
  useEffect(() => {
    void api.explorerMenuStatus().then(setMenu);
  }, []);

  const useFile = async () => {
    const [p] = await api.pick({ files: true, title: 'config.json seçin', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    const b = await api.useConfigFile(p);
    setBoot(b);
    if (b.configError) toast('error', 'Dosya okunamadı', b.configError);
    else toast('ok', 'Yapılandırma dosyası değişti', `${b.config.nodes.length} makine yüklendi`);
  };
  const importFile = async () => {
    const [p] = await api.pick({ files: true, title: 'İçe aktarılacak config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    try {
      const incoming = await api.readConfigFile(p);
      const ids = new Set(boot.config.nodes.map((n) => n.id.toLowerCase()));
      const added = incoming.nodes.filter((n) => !ids.has(n.id.toLowerCase()));
      const next = { ...boot.config, nodes: [...boot.config.nodes, ...added] };
      if (!boot.config.nodes.length) {
        next.copy = incoming.copy;
        next.profiles = incoming.profiles;
      }
      if (await saveConfig(next)) toast('ok', 'İçe aktarıldı', `${added.length} yeni makine eklendi${incoming.nodes.length - added.length ? `, ${incoming.nodes.length - added.length} zaten vardı` : ''}`);
    } catch (e) {
      toast('error', 'İçe aktarılamadı', (e as Error).message);
    }
  };

  const num = (k: keyof CopySettings, min: number, max: number) => (
    <input className="input" type="number" min={min} max={max} value={copy[k] as number} onChange={(e) => setCopy({ ...copy, [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) })} />
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Ayarlar</h1>
          <div className="sub">Görünüm bu bilgisayara, kopyalama ve güncelleme ayarları paylaşılan yapılandırmaya yazılır.</div>
        </div>
      </div>
      <div className="page-body">
        <div className="settings-grid">
          <Section id="look" icon={<Palette size={15} />} title="Görünüm">
            <Field label="Tema">
              <Segmented
                value={s.theme}
                onChange={(theme) => void saveSettings({ theme })}
                options={[
                  { value: 'dark', label: 'Koyu', icon: <Moon size={14} /> },
                  { value: 'light', label: 'Açık', icon: <Sun size={14} /> },
                  { value: 'system', label: 'Sistemle eşle', icon: <Monitor size={14} />, tip: 'Bilgisayarın açık/koyu tema ayarını izler' },
                ]}
              />
            </Field>
            <Field label="Vurgu rengi" style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 8 }}>
                {ACCENTS.map((c) => (
                  <button key={c} className={cls('swatch', s.accent === c && 'on')} style={{ background: c }} onClick={() => void saveSettings({ accent: c })} />
                ))}
                <input type="color" className="swatch-input" value={s.accent} onChange={(e) => void saveSettings({ accent: e.target.value })} />
              </div>
            </Field>
            <Field label="Yoğunluk" style={{ marginTop: 14 }}>
              <Segmented
                value={s.density}
                onChange={(density) => void saveSettings({ density })}
                options={[
                  { value: 'comfortable', label: 'Rahat' },
                  { value: 'compact', label: 'Sıkı' },
                ]}
              />
            </Field>
            <div className="divider" />
            <ToggleRow title="Başarılı gönderimden sonra paneli kapat" on={s.closeRunPanelOnSuccess} onChange={(v) => void saveSettings({ closeRunPanelOnSuccess: v })} />
          </Section>

          <Section id="background" icon={<PanelBottomClose size={15} />} title="Arka plan ve başlangıç" desc="Otomasyonun pencere kapalıyken de sürmesi için">
            <ToggleRow
              title="Kapatınca sistem tepsisinde çalışmaya devam et"
              desc="Pencere gizlenir; izleme ve zamanlanmış işler sürer. Tepsideki simgeden açılır ya da kapatılır."
              on={s.closeToTray}
              disabled={!boot.isElectron}
              onChange={(v) => void saveSettings({ closeToTray: v })}
            />
            <ToggleRow
              title={boot.platform === 'darwin' ? 'Oturum açılınca başlat' : 'Windows açılışında başlat'}
              desc={boot.platform === 'linux' ? 'Linux’ta masaüstü ortamınızın başlangıç uygulamalarına ekleyin.' : 'Tepside gizli başlar (yukarıdaki seçenek açıksa). Yalnızca kurulu sürümde etkilidir.'}
              on={s.launchAtLogin}
              disabled={!boot.isElectron || boot.platform === 'linux'}
              onChange={(v) => void saveSettings({ launchAtLogin: v })}
            />
          </Section>

          <Section
            id="copy"
            icon={<CopyIcon size={15} />}
            title="Kopyalama"
            desc="Bütün makinelerde geçerli varsayılanlar"
            action={
              copyDirty && (
                <div className="row">
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setCopy(boot.config.copy)}>
                    Geri al
                  </Button>
                  <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={async () => (await saveConfig({ ...boot.config, copy })) && toast('ok', 'Kopyalama ayarları kaydedildi')}>
                    Kaydet
                  </Button>
                </div>
              )
            }
          >
            <div className="form-grid three">
              <Field label="Yeniden deneme">{num('retryCount', 0, 100)}</Field>
              <Field label="Denemeler arası (sn)">{num('waitSeconds', 0, 60)}</Field>
              <Field label="Saklanacak yedek" help="0 = sınırsız">
                {num('backupKeep', 0, 1000)}
              </Field>
              <Field label="Eşzamanlı hedef">{num('parallelTargets', 1, 16)}</Field>
              <Field label="Hedef başına dosya" help="Eşzamanlı">{num('parallelFiles', 1, 32)}</Field>
              <Field label="Zaman toleransı (sn)" help="FAT/ağ sürücüleri için">
                {num('timeToleranceSec', 0, 3600)}
              </Field>
              <Field label="Bant genişliği (MB/sn)" help="Hedef başına; 0 = sınırsız">
                {num('bandwidthMBps', 0, 10000)}
              </Field>
            </div>
            <Field label="Yedek klasörü" help="Hedef kökünün altında; yedek alınan dosyaların eski hâlleri burada tarih klasörlerinde durur. Değiştirirseniz eski addaki yedekler listelenmez." style={{ marginTop: 12 }}>
              <input
                className="input mono"
                value={copy.backupFolderName}
                onChange={(e) => setCopy({ ...copy, backupFolderName: e.target.value.replace(/[\\/:*?"<>|]/g, '') })}
                placeholder="_SamSyncYedek"
              />
            </Field>
            <div style={{ marginTop: 6 }}>
              <ToggleRow title="Yazdıktan sonra doğrula" desc="İçerik özetini karşılaştırır (daha yavaş)" on={copy.verify} onChange={(v) => setCopy({ ...copy, verify: v })} />
              <ToggleRow title="1 saatlik yaz saati farkını yok say" desc="Saat dilimi kaymış dosyaları aynı sayar" on={copy.ignoreDstShift} onChange={(v) => setCopy({ ...copy, ignoreDstShift: v })} />
            </div>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <Field label="Varsayılan hariç dosyalar">
                <TagInput value={copy.excludeFiles} onChange={(v) => setCopy({ ...copy, excludeFiles: v })} placeholder="*.pdb" />
              </Field>
              <Field label="Varsayılan hariç klasörler">
                <TagInput value={copy.excludeDirs} onChange={(v) => setCopy({ ...copy, excludeDirs: v })} placeholder=".git" />
              </Field>
            </div>
            <Field label="Kopyalama sonrası komut" help="{address} {targetId} {targetName} {networkRoot} {destination} — her başarılı hedeften sonra bir kez çalışır" style={{ marginTop: 12 }}>
              <input className="input mono" value={copy.postCommand ?? ''} onChange={(e) => setCopy({ ...copy, postCommand: e.target.value })} placeholder={'schtasks /run /s {address} /tn "Sim Yeniden Baslat"'} />
            </Field>
          </Section>

          <Section id="config" icon={<FileJson size={15} />} title="Yapılandırma dosyası" desc="Makineler, gruplar, profiller ve senkron işleri">
            <div className="mono selectable" style={{ fontSize: 12, wordBreak: 'break-all', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-inset)', border: '1px solid var(--border)' }}>
              {boot.configPath}
            </div>
            {boot.configError && (
              <div className="alert error" style={{ marginTop: 10 }}>
                <AlertTriangle size={15} /> {boot.configError}
              </div>
            )}
            <p className="muted" style={{ fontSize: 12.5 }}>
              Ağ paylaşımındaki ortak bir <span className="mono">config.json</span> seçilirse bütün makineler aynı listeyi kullanır. Eski PowerShell aracının dosyası doğrudan okunur; kaydederken onun alanları korunur.
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button icon={<FolderOpen size={14} />} onClick={() => void useFile()} disabled={!boot.isElectron}>
                Başka dosya kullan…
              </Button>
              <Button icon={<Upload size={14} />} onClick={() => void importFile()} disabled={!boot.isElectron}>
                Makineleri içe aktar…
              </Button>
              {boot.settings.configPath && (
                <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={async () => setBoot(await api.useConfigFile(null))}>
                  Varsayılana dön
                </Button>
              )}
              <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void api.openPath(boot.configPath).catch((e) => toast('error', 'Açılamadı', (e as Error).message))}>
                Aç
              </Button>
            </div>
          </Section>

          <Section id="integration" icon={<MousePointerClick size={15} />} title="Sağ tık menüsü" desc="Explorer’da dosya ve klasörler için “SamSync ile gönder”">
            {!menu ? (
              <div className="spinner" />
            ) : !menu.supported ? (
              <p className="muted">Bu özellik yalnızca Windows’ta kullanılabilir. macOS ve Linux’ta dosyaları pencereye sürükleyin ya da uygulamayı dosya yollarıyla başlatın.</p>
            ) : (
              <>
                <div className="row">
                  {menu.installed ? <CheckCircle2 size={16} color="var(--green)" /> : <Info size={16} className="faint" />}
                  <span className="grow">{menu.installed ? 'Kurulu' : 'Kurulu değil'}</span>
                  <Button
                    variant={menu.installed ? 'default' : 'primary'}
                    onClick={async () => {
                      const r = await api.explorerMenuInstall(!menu.installed);
                      setMenu(r);
                      toast('ok', r.installed ? 'Sağ tık menüsü eklendi' : 'Sağ tık menüsü kaldırıldı');
                    }}
                  >
                    {menu.installed ? 'Kaldır' : 'Ekle'}
                  </Button>
                </div>
                {menu.command && (
                  <div className="mono faint selectable" style={{ fontSize: 11.5, marginTop: 8, wordBreak: 'break-all' }}>
                    {menu.command}
                  </div>
                )}
                <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
                  100 öğeye kadar seçim desteklenir; Explorer her öğe için uygulamayı bir kez başlatır, hepsi tek pencerede toplanır. Windows 11’de “Daha fazla seçenek göster” altında görünür.
                </p>
              </>
            )}
          </Section>

          <Section
            id="updates"
            icon={<Download size={15} />}
            title="Güncellemeler"
            desc={`Sürüm ${boot.appVersion}`}
            action={
              updDirty && (
                <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={async () => (await saveConfig({ ...boot.config, update: upd })) && toast('ok', 'Güncelleme kaynağı kaydedildi')}>
                  Kaydet
                </Button>
              )
            }
          >
            <Field label="Kaynak">
              <Segmented
                value={upd.source}
                onChange={(source: UpdateSource) => setUpd({ ...upd, source })}
                options={[
                  { value: 'github', label: 'GitHub', icon: <Cloud size={14} /> },
                  { value: 'url', label: 'Web adresi', icon: <Globe size={14} /> },
                  { value: 'folder', label: 'Ağ klasörü', icon: <FolderSync size={14} /> },
                  { value: 'off', label: 'Kapalı', icon: <Power size={14} /> },
                ]}
              />
            </Field>
            {upd.source === 'url' && (
              <Field label="Adres" help="latest.yml ve kurulum dosyalarının bulunduğu klasörün adresi" style={{ marginTop: 12 }}>
                <input className="input mono" value={upd.url ?? ''} onChange={(e) => setUpd({ ...upd, url: e.target.value })} placeholder="https://sunucu/samsync/" />
              </Field>
            )}
            {upd.source === 'folder' && (
              <Field label="Klasör" help="İnternete çıkmayan makineler için: latest.yml + SamSync-Setup-x.y.z.exe" style={{ marginTop: 12 }}>
                <div className="row">
                  <input className="input mono" value={upd.folder ?? ''} onChange={(e) => setUpd({ ...upd, folder: e.target.value })} placeholder="\\dosya-sunucusu\Dagitim\SamSync" />
                  <Button
                    iconOnly
                    icon={<FolderOpen size={14} />}
                    disabled={!boot.isElectron}
                    onClick={async () => {
                      const [p] = await api.pick({ folders: true });
                      if (p) setUpd({ ...upd, folder: p });
                    }}
                  />
                </div>
              </Field>
            )}
            <div style={{ marginTop: 6 }}>
              <ToggleRow title="Açılışta ve 6 saatte bir denetle" on={s.updateAutoCheck} onChange={(v) => void saveSettings({ updateAutoCheck: v })} />
              <ToggleRow title="Yeni sürümü arka planda indir" on={s.updateAutoDownload} onChange={(v) => void saveSettings({ updateAutoDownload: v })} />
            </div>
            <UpdateStatus />
          </Section>

          <Section id="about" icon={<Info size={15} />} title="Hakkında">
            <div className="about-grid">
              <span className="faint">Sürüm</span>
              <span>{boot.appVersion}</span>
              <span className="faint">Platform</span>
              <span>
                {boot.platform} • {boot.hostname}
              </span>
              <span className="faint">Git</span>
              <span>{boot.gitVersion ?? 'bulunamadı'}</span>
              <span className="faint">Veri klasörü</span>
              <span className="mono selectable" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                {boot.userDataPath}
              </span>
            </div>
            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <Button size="sm" icon={<FileText size={13} />} onClick={() => void api.openLog()}>
                Günlüğü aç
              </Button>
              <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => void api.openPath(boot.userDataPath)}>
                Veri klasörü
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void api.windowControl('devtools')}>
                Geliştirici araçları
              </Button>
            </div>
          </Section>
        </div>
        {update?.phase === 'error' && null}
      </div>
    </div>
  );
}

function UpdateStatus() {
  const update = useApp((s) => s.update);
  const [busy, setBusy] = useState(false);
  if (!update) return null;
  const p = update.phase;
  return (
    <div className="update-box">
      <div className="row">
        {p === 'checking' || p === 'downloading' ? (
          <Loader2 size={16} className="spin" color="var(--accent)" />
        ) : p === 'ready' || p === 'none' ? (
          <CheckCircle2 size={16} color="var(--green)" />
        ) : p === 'error' ? (
          <AlertTriangle size={16} color="var(--red)" />
        ) : p === 'available' ? (
          <Download size={16} color="var(--accent)" />
        ) : (
          <Info size={16} className="faint" />
        )}
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 580 }}>
            {p === 'idle' && 'Henüz denetlenmedi'}
            {p === 'checking' && 'Denetleniyor…'}
            {p === 'none' && 'Güncel sürümü kullanıyorsunuz'}
            {p === 'available' && `Yeni sürüm: ${update.version}`}
            {p === 'downloading' && `İndiriliyor… %${Math.round(update.percent ?? 0)}`}
            {p === 'ready' && `${update.version} kurulmaya hazır`}
            {p === 'error' && 'Güncelleme hatası'}
            {p === 'unsupported' && 'Bu kurulumda güncelleme yok'}
          </div>
          <div className="faint ellipsis selectable" style={{ fontSize: 12 }}>
            {update.error ?? update.detail ?? (update.checkedAt ? `Son denetim ${ago(update.checkedAt)}` : '')}
          </div>
        </div>
        {(p === 'idle' || p === 'none' || p === 'error') && (
          <Button
            size="sm"
            icon={<RefreshCw size={13} />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              useApp.setState({ update: await api.updateCheck() });
              setBusy(false);
            }}
          >
            Şimdi denetle
          </Button>
        )}
        {p === 'available' && (
          <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={async () => useApp.setState({ update: await api.updateDownload() })}>
            İndir
          </Button>
        )}
        {p === 'ready' && (
          <Button size="sm" variant="primary" onClick={() => void api.updateInstall()}>
            Yeniden başlat ve kur
          </Button>
        )}
      </div>
      {p === 'downloading' && (
        <div style={{ marginTop: 10 }}>
          <Progress value={update.percent ?? 0} />
        </div>
      )}
      {update.notes && p !== 'none' && (
        <div className="faint selectable" style={{ fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
          {update.notes.replace(/<[^>]+>/g, '')}
        </div>
      )}
    </div>
  );
}

export function SwitchRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check-label">
      <Switch on={on} onChange={onChange} /> {label}
    </label>
  );
}
