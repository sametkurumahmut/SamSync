import { useEffect, useState, type ReactNode } from 'react';
import { Palette, Copy as CopyIcon, FileJson, MousePointerClick, Download, Info, Save, RotateCcw, FolderOpen, Upload, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Monitor, Sun, Moon, Globe, FolderSync, Power, ExternalLink, FileText, Cloud, PanelBottomClose, Languages, Minus, Plus, Sparkles, Bell, Send, Bot, Trash2, Volume2 } from 'lucide-react';
import type { CopySettings, LocalSettings, NotificationSettings, UpdateConfig, UpdateSource } from '@shared/types';
import { useApp, UI_SCALES, stepUiScale, uiScaleOf } from '../store/app';
import { api } from '../lib/api';
import { playFinishSound } from '../lib/sounds';
import { Button, Field, Progress, Segmented, Switch, TagInput, ToggleRow } from '../components/ui';
import { ago, cls, dateTime } from '../lib/format';
import { t, tk } from '@shared/i18n';
import { menuEntries } from '@shared/menu';
import { useUnsaved } from '../lib/unsaved';
import { ConfigEditor } from '../components/ConfigEditor';
import { WebUiSection } from '../components/WebUiSettings';
import { tx } from '../lib/i18n';

const LANG_NAMES = { tr: 'Türkçe', en: 'English', de: 'Deutsch', es: 'Español' } as const; // i18n-ignore: each language by its own name

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

/** The releases page of the repository the app updates from: what changed in each version. */
function ReleaseNotesButton() {
  const url = useApp((s) => s.boot?.repositoryUrl);
  if (!url) return null;
  return (
    <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void api.openExternal(`${url}/releases`)}>
      {t('Sürüm notları')}
    </Button>
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
  const integration = useApp((st) => st.integration);
  const [editingJson, setEditingJson] = useState(false);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [wizardBusy, setWizardBusy] = useState(false);
  const copyDirty = JSON.stringify(copy) !== JSON.stringify(boot.config.copy);
  const updDirty = JSON.stringify(upd) !== JSON.stringify(boot.config.update ?? { source: 'github' });
  useUnsaved('settings.copy', t('Kopyalama ayarları'), copyDirty);
  useUnsaved('settings.update', t('Güncelleme kaynağı'), updDirty);

  useEffect(() => setCopy(boot.config.copy), [boot.config.copy]);
  useEffect(() => {
    void api.integrationStatus().then((st) => useApp.setState({ integration: st }));
  }, []);
  const setIntegration = async (patch: { explorerMenu?: boolean; notepadPlusPlus?: boolean }) => {
    setIntegrationBusy(true);
    try {
      const st = await api.integrationSet(patch);
      useApp.setState({ integration: st, boot: { ...useApp.getState().boot!, settings: { ...useApp.getState().boot!.settings, ...patch } } });
    } catch (e) {
      toast('error', t('Menü yazılamadı'), (e as Error).message);
    } finally {
      setIntegrationBusy(false);
    }
  };

  const pickConfigFile = async () => {
    const [p] = await api.pick({ files: true, title: t('config.json seçin'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    const b = await api.useConfigFile(p);
    setBoot(b);
    if (b.configError) toast('error', t('Dosya okunamadı'), b.configError);
    else toast('ok', t('Yapılandırma dosyası değişti'), t('{n} makine yüklendi', { n: b.config.nodes.length }));
  };
  const importFile = async () => {
    const [p] = await api.pick({ files: true, title: t('İçe aktarılacak config.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
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
      const existed = incoming.nodes.length - added.length;
      if (await saveConfig(next))
        toast('ok', t('İçe aktarıldı'), existed ? t('{n} yeni makine eklendi, {m} zaten vardı', { n: added.length, m: existed }) : t('{n} yeni makine eklendi', { n: added.length }));
    } catch (e) {
      toast('error', t('İçe aktarılamadı'), (e as Error).message);
    }
  };

  /** The old wizard's profiles and last selection: found under %LOCALAPPDATA% or picked by hand. */
  const importWizard = async (choose: boolean) => {
    let file = choose ? null : await api.findWizardState();
    if (!file) {
      if (!choose) toast('info', t('Eski sihirbaz ayarı bulunamadı'), t('Dosyayı kendiniz seçin (wizard-state.json).'));
      [file] = await api.pick({ files: true, title: t('Eski sihirbazın durum dosyası'), filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!file) return;
    }
    if (s.wizardImport && !confirm(t('Bu ayarlar daha önce içe aktarılmıştı. Son seçim yeniden yazılsın mı? Var olan profiller korunur.'))) return;
    setWizardBusy(true);
    try {
      const r = await api.importWizardState(file);
      const st = useApp.getState();
      const known = new Set(r.config.nodes.map((n) => n.id));
      const took = r.lastTargets.length > 0;
      useApp.setState({
        boot: { ...st.boot!, settings: r.settings, config: r.config },
        targets: took ? r.settings.lastTargets.filter((id) => known.has(id)) : st.targets,
        options: took ? { ...st.options, ...r.settings.lastOptions, dryRun: false } : st.options,
      });
      const parts = [
        t('{n} hedef seçildi', { n: r.lastTargets.length }),
        t('{n} profil eklendi', { n: r.profilesAdded.length }),
        ...(r.profilesSkipped.length ? [t('{n} profil zaten vardı', { n: r.profilesSkipped.length })] : []),
        ...(r.unknownTargets.length ? [t('bilinmeyen makineler atlandı: {ids}', { ids: r.unknownTargets.join(', ') })] : []),
        ...(r.profilesError ? [t('profiller kaydedilemedi: {error}', { error: r.profilesError })] : []),
      ];
      toast(r.profilesError ? 'warn' : 'ok', t('Eski sihirbaz ayarları içe aktarıldı'), parts.join(' • '));
    } catch (e) {
      toast('error', t('İçe aktarılamadı'), (e as Error).message);
    } finally {
      setWizardBusy(false);
    }
  };

  const num = (k: keyof CopySettings, min: number, max: number) => (
    <input className="input" type="number" min={min} max={max} value={copy[k] as number} onChange={(e) => setCopy({ ...copy, [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) })} />
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Ayarlar')}</h1>
          <div className="sub">{t('Görünüm bu bilgisayara, kopyalama ve güncelleme ayarları paylaşılan yapılandırmaya yazılır.')}</div>
        </div>
      </div>
      <div className="page-body">
        <div className="settings-grid">
          <Section id="look" icon={<Palette size={15} />} title={t('Görünüm')}>
            <Field label={t('Dil')}>
              <Segmented
                value={s.language}
                onChange={(language) => void saveSettings({ language })}
                options={[
                  { value: 'system', label: t('Sistemle eşle'), icon: <Languages size={14} />, tip: t('Bilgisayarın dili: {lang}', { lang: LANG_NAMES[boot.systemLang] }) },
                  { value: 'tr', label: LANG_NAMES.tr },
                  { value: 'en', label: LANG_NAMES.en },
                  { value: 'de', label: LANG_NAMES.de },
                  { value: 'es', label: LANG_NAMES.es },
                ]}
              />
            </Field>
            <Field label={t('Tema')} style={{ marginTop: 14 }}>
              <Segmented
                value={s.theme}
                onChange={(theme) => void saveSettings({ theme })}
                options={[
                  { value: 'dark', label: t('Koyu'), icon: <Moon size={14} /> },
                  { value: 'light', label: t('Açık'), icon: <Sun size={14} /> },
                  { value: 'system', label: t('Sistemle eşle'), icon: <Monitor size={14} />, tip: t('Bilgisayarın açık/koyu tema ayarını izler') },
                ]}
              />
            </Field>
            <Field label={t('Vurgu rengi')} style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 8 }}>
                {ACCENTS.map((c) => (
                  <button key={c} className={cls('swatch', s.accent === c && 'on')} style={{ background: c }} aria-label={t('Vurgu rengi {color}', { color: c })} aria-pressed={s.accent === c} onClick={() => void saveSettings({ accent: c })} />
                ))}
                <input type="color" className="swatch-input" aria-label={t('Özel vurgu rengi')} value={s.accent} onChange={(e) => void saveSettings({ accent: e.target.value })} />
              </div>
            </Field>
            <Field label={t('Yoğunluk')} style={{ marginTop: 14 }}>
              <Segmented
                value={s.density}
                onChange={(density) => void saveSettings({ density })}
                options={[
                  { value: 'comfortable', label: t('Rahat') },
                  { value: 'compact', label: t('Sıkı') },
                ]}
              />
            </Field>
            <Field label={t('Arayüz ölçeği')} help={t('Ctrl + ve Ctrl − ile de değişir; Ctrl 0 sıfırlar.')} style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" iconOnly icon={<Minus size={14} />} tip={t('Ölçeği küçült')} disabled={uiScaleOf(s) <= UI_SCALES[0]} onClick={() => void saveSettings({ uiScale: stepUiScale(uiScaleOf(s), -1) })} />
                <span className="tabular" style={{ minWidth: 44, textAlign: 'center', fontWeight: 600 }}>
                  %{uiScaleOf(s)}
                </span>
                <Button size="sm" iconOnly icon={<Plus size={14} />} tip={t('Ölçeği büyüt')} disabled={uiScaleOf(s) >= UI_SCALES[UI_SCALES.length - 1]} onClick={() => void saveSettings({ uiScale: stepUiScale(uiScaleOf(s), 1) })} />
                {uiScaleOf(s) !== 100 && (
                  <Button size="sm" variant="ghost" onClick={() => void saveSettings({ uiScale: 100 })}>
                    {t('Sıfırla')}
                  </Button>
                )}
              </div>
            </Field>
            <div className="divider" />
            <ToggleRow title={t('Başarılı gönderimden sonra paneli kapat')} on={s.closeRunPanelOnSuccess} onChange={(v) => void saveSettings({ closeRunPanelOnSuccess: v })} />
            <Field label={t('Bitince ses')} help={t('Gönderim bitince kısa bir ses: başarılıysa yükselen iki nota, hata varsa alçak bir uyarı. Deneme çalıştırmaları ve iptaller sessizdir.')} style={{ marginTop: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <select className="select" style={{ width: 220 }} aria-label={t('Bitince ses')} value={s.finishSound ?? 'always'} onChange={(e) => void saveSettings({ finishSound: e.target.value as LocalSettings['finishSound'] })}>
                  <option value="always">{t('Her bitişte')}</option>
                  <option value="errors">{t('Yalnızca hata varsa')}</option>
                  <option value="never">{t('Kapalı')}</option>
                </select>
                <Button size="sm" variant="ghost" icon={<Volume2 size={13} />} onClick={() => playFinishSound('ok')}>
                  {t('Başarı sesi')}
                </Button>
                <Button size="sm" variant="ghost" icon={<Volume2 size={13} />} onClick={() => playFinishSound('error')}>
                  {t('Hata sesi')}
                </Button>
              </div>
            </Field>
          </Section>

          <Section id="background" icon={<PanelBottomClose size={15} />} title={t('Arka plan ve başlangıç')} desc={t('Otomasyonun pencere kapalıyken de sürmesi için')}>
            <ToggleRow
              title={t('Kapatınca sistem tepsisinde çalışmaya devam et')}
              desc={t('Pencere gizlenir; izleme ve zamanlanmış işler sürer. Tepsideki simgeden açılır ya da kapatılır.')}
              on={s.closeToTray}
              disabled={!boot.isElectron}
              onChange={(v) => void saveSettings({ closeToTray: v })}
            />
            <ToggleRow
              title={boot.platform === 'darwin' ? t('Oturum açılınca başlat') : t('Windows açılışında başlat')}
              desc={boot.platform === 'linux' ? t('Linux’ta masaüstü ortamınızın başlangıç uygulamalarına ekleyin.') : t('Tepside gizli başlar (yukarıdaki seçenek açıksa). Yalnızca kurulu sürümde etkilidir.')}
              on={s.launchAtLogin}
              disabled={!boot.isElectron || boot.platform === 'linux'}
              onChange={(v) => void saveSettings({ launchAtLogin: v })}
            />
          </Section>

          <Section
            id="copy"
            icon={<CopyIcon size={15} />}
            title={t('Kopyalama')}
            desc={t('Bütün makinelerde geçerli varsayılanlar')}
            action={
              copyDirty && (
                <div className="row">
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setCopy(boot.config.copy)}>
                    {t('Geri al')}
                  </Button>
                  <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={async () => (await saveConfig({ ...boot.config, copy })) && toast('ok', t('Kopyalama ayarları kaydedildi'))}>
                    {t('Kaydet')}
                  </Button>
                </div>
              )
            }
          >
            <div className="form-grid three">
              <Field label={t('Yeniden deneme')}>{num('retryCount', 0, 100)}</Field>
              <Field label={t('Denemeler arası (sn)')}>{num('waitSeconds', 0, 60)}</Field>
              <Field label={t('Saklanacak yedek')} help={t('0 = sınırsız')}>
                {num('backupKeep', 0, 1000)}
              </Field>
              <Field label={t('Eşzamanlı hedef')}>{num('parallelTargets', 1, 32)}</Field>
              <Field label={t('Hedef başına dosya')} help={t('Eşzamanlı')}>
                {num('parallelFiles', 1, 64)}
              </Field>
              <Field label={t('Zaman toleransı (sn)')} help={t('FAT/ağ sürücüleri için')}>
                {num('timeToleranceSec', 0, 3600)}
              </Field>
              <Field label={t('Bant genişliği (MB/sn)')} help={t('Hedef başına; 0 = sınırsız')}>
                {num('bandwidthMBps', 0, 10000)}
              </Field>
              <Field label={t('Röle işi alma süresi (sn)')} help={t('Röle bu sürede işi almazsa doğrudan gönderilir')}>
                {num('relayAckSeconds', 5, 3600)}
              </Field>
              <Field label={t('Röle bitirme süresi (dk)')} help={t('Rölenin dağıtımı bu sürede bitmezse hata sayılır')}>
                {num('relayTimeoutMinutes', 1, 1440)}
              </Field>
              <Field label={t('Röle kuyruğu: yeniden deneme (dk)')} help={t('Kapalı makinenin işleri rölede bekler, bu aralıkla denenir; 0 = kuyruk yok')}>
                {num('relayQueueMinutes', 0, 1440)}
              </Field>
              <Field label={t('Röle kuyruğu: en çok (gün)')} help={t('Bu kadar gün erişilemeyen makinenin bekleyen işleri düşürülür')}>
                {num('relayQueueDays', 1, 90)}
              </Field>
              <Field label={t('Manifeste güven (gün)')} help={t('Hedefte bırakılan manifest bu kadar gün ağ üzerinden gezinmenin yerine geçer (örnekle doğrulanır); 0 = her gönderimde tam tarama')}>
                {num('manifestMaxDays', 0, 365)}
              </Field>
            </div>
            <Field label={t('Yedek klasörü')} help={t('Hedef kökünün altında; yedek alınan dosyaların eski hâlleri burada tarih klasörlerinde durur. Değiştirirseniz eski addaki yedekler listelenmez.')} style={{ marginTop: 12 }}>
              <input
                className="input mono"
                value={copy.backupFolderName}
                onChange={(e) => setCopy({ ...copy, backupFolderName: e.target.value.replace(/[\\/:*?"<>|]/g, '') })}
                placeholder="_SamSyncYedek"
              />
            </Field>
            <div style={{ marginTop: 6 }}>
              <ToggleRow title={t('Yazdıktan sonra doğrula')} desc={t('İçerik özetini karşılaştırır (daha yavaş)')} on={copy.verify} onChange={(v) => setCopy({ ...copy, verify: v })} />
              <ToggleRow title={t('1 saatlik yaz saati farkını yok say')} desc={t('Saat dilimi kaymış dosyaları aynı sayar')} on={copy.ignoreDstShift} onChange={(v) => setCopy({ ...copy, ignoreDstShift: v })} />
              <ToggleRow
                title={t('Kök dışı kaynakları tam yoluyla gönder')}
                desc={t('Eski davranış: hiçbir yerel kökün altında olmayan bir klasör hedefte sürücü harfiyle birlikte tam yoluyla yer alır. Kapalıyken klasörün kendisi hedef kökünün yerine geçer; Gönder sayfasında her kaynak için ayrıca seçilebilir.')}
                on={copy.outsideRoots === 'fullPath'}
                onChange={(v) => setCopy({ ...copy, outsideRoots: v ? 'fullPath' : 'own' })}
              />
            </div>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <Field label={t('Varsayılan hariç dosyalar')}>
                <TagInput value={copy.excludeFiles} onChange={(v) => setCopy({ ...copy, excludeFiles: v })} placeholder="*.pdb" />
              </Field>
              <Field label={t('Varsayılan hariç klasörler')}>
                <TagInput value={copy.excludeDirs} onChange={(v) => setCopy({ ...copy, excludeDirs: v })} placeholder=".git" />
              </Field>
            </div>
            <Field
              label={t('Kopyalama sonrası komut')}
              help={t('{vars} — her başarılı hedeften sonra bir kez çalışır', { vars: '{address} {targetId} {targetName} {networkRoot} {destination} {source}' })}
              style={{ marginTop: 12 }}
            >
              <input className="input mono" value={copy.postCommand ?? ''} onChange={(e) => setCopy({ ...copy, postCommand: e.target.value })} placeholder={'schtasks /run /s {address} /tn "Sim Yeniden Baslat"'} />
            </Field>
          </Section>

          <Section id="config" icon={<FileJson size={15} />} title={t('Yapılandırma dosyası')} desc={t('Makineler, gruplar, profiller ve senkron işleri')}>
            <div className="mono selectable" style={{ fontSize: 12, wordBreak: 'break-all', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-inset)', border: '1px solid var(--border)' }}>
              {boot.configPath}
            </div>
            {boot.configError && (
              <div className="alert error" style={{ marginTop: 10 }}>
                <AlertTriangle size={15} /> {boot.configError}
              </div>
            )}
            <p className="muted" style={{ fontSize: 12.5 }}>
              {tx('Ağ paylaşımındaki ortak bir {file} seçilirse bütün makineler aynı listeyi kullanır.', { file: <span className="mono">config.json</span> })}{' '}
              {t('Eski PowerShell aracının dosyası doğrudan okunur; kaydederken onun alanları korunur.')}
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button icon={<FolderOpen size={14} />} onClick={() => void pickConfigFile()} disabled={!boot.isElectron}>
                {t('Başka dosya kullan…')}
              </Button>
              <Button icon={<Upload size={14} />} onClick={() => void importFile()} disabled={!boot.isElectron}>
                {t('Makineleri içe aktar…')}
              </Button>
              <Button icon={<FileJson size={14} />} onClick={() => setEditingJson(true)}>
                {t('JSON olarak düzenle…')}
              </Button>
              {editingJson && <ConfigEditor onClose={() => setEditingJson(false)} />}
              {boot.settings.configPath && (
                <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={async () => setBoot(await api.useConfigFile(null))}>
                  {t('Varsayılana dön')}
                </Button>
              )}
              <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void api.openPath(boot.configPath).catch((e) => toast('error', t('Açılamadı'), (e as Error).message))}>
                {t('Aç')}
              </Button>
            </div>
            <div className="divider" />
            <div className="section-title">{t('Eski sihirbazdan içe aktar')}</div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {t('Eski aracın sihirbazındaki profilleri ve son seçimi (hedefler ve hedef başına Yedek al / Yalnızca yeni / Ayna) bir kez buraya taşır. Aynı adlı profiller olduğu gibi kalır.')}
            </p>
            {s.wizardImport && (
              <p className="faint selectable" style={{ fontSize: 12 }}>
                {t('İçe aktarıldı: {time} • {file}', { time: dateTime(s.wizardImport.at), file: s.wizardImport.file })}
              </p>
            )}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button icon={<Upload size={14} />} loading={wizardBusy} onClick={() => void importWizard(false)} disabled={!boot.isElectron}>
                {s.wizardImport ? t('Yeniden içe aktar') : t('Sihirbaz ayarlarını içe aktar')}
              </Button>
              <Button variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void importWizard(true)} disabled={!boot.isElectron}>
                {t('Dosya seç…')}
              </Button>
            </div>
          </Section>

          <Section id="integration" icon={<MousePointerClick size={15} />} title={t('Sağ tık menüleri')} desc={t('Explorer ve Notepad++ içinden tek tıkla gönderim')}>
            {!integration ? (
              boot.isElectron ? <div className="spinner" /> : <p className="muted">{t('Bu özellik yalnızca masaüstü uygulamasında kullanılabilir.')}</p>
            ) : !integration.supported ? (
              <p className="muted">{t('Bu özellik yalnızca Windows’ta kullanılabilir. macOS ve Linux’ta dosyaları pencereye sürükleyin ya da uygulamayı dosya yollarıyla başlatın.')}</p>
            ) : (
              <>
                <ToggleRow
                  icon={integration.explorer.installed ? <CheckCircle2 size={16} color="var(--green)" /> : <Info size={16} className="faint" />}
                  title={t('Explorer menüsü')}
                  desc={t('Dosya ve klasörlere sağ tıklayınca “SamSync”: tümüne, son ayarla, profile, gruba ya da makineye tek tıkla gönder; incele ve gönder; yedekten geri al.')}
                  on={integration.explorer.enabled}
                  onChange={(v) => !integrationBusy && void setIntegration({ explorerMenu: v })}
                />
                {integration.explorer.error && (
                  <div className="alert error" style={{ marginTop: 8 }}>
                    <AlertTriangle size={15} /> {integration.explorer.error}
                  </div>
                )}
                {integration.explorer.enabled && (
                  <div style={{ margin: '8px 0 0 30px' }}>
                    <Field label={t('Makineler menüde')}>
                      <Segmented
                        value={boot.config.menuShowNodes ?? 'auto'}
                        onChange={(menuShowNodes) => void saveConfig({ ...boot.config, menuShowNodes })}
                        options={SHOW_NODES.map((o) => ({ value: o.value, label: t(o.label), tip: t(o.tip) }))}
                      />
                    </Field>
                    <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                      {integration.explorer.expanded.length > 0 && <div>{t('Alt menüsüyle: {groups}', { groups: integration.explorer.expanded.join(', ') })}</div>}
                      {integration.explorer.collapsed.length > 0 && <div>{t('Tek girdi (bütün gruba gönderir): {groups}', { groups: integration.explorer.collapsed.join(', ') })}</div>}
                      {integration.explorer.overBudget && <div style={{ color: 'var(--amber)' }}>{t('Menüde 16 girdiden fazlası var; Windows bazılarını göstermeyebilir')}</div>}
                    </div>
                    {integration.explorer.command && (
                      <div className="mono faint selectable" style={{ fontSize: 11.5, marginTop: 6, wordBreak: 'break-all' }}>
                        {integration.explorer.command}
                      </div>
                    )}
                    <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                      {t('100 öğeye kadar seçim desteklenir; Explorer her öğe için uygulamayı bir kez başlatır, hepsi tek gönderimde toplanır. Windows 11’de “Daha fazla seçenek göster” altında görünür.')}
                    </p>
                  </div>
                )}
                <div className="divider" />
                <ToggleRow
                  icon={integration.notepadPlusPlus.installs.some((i) => i.installed) ? <CheckCircle2 size={16} color="var(--green)" /> : <Info size={16} className="faint" />}
                  title="Notepad++"
                  desc={t('Sekmeye sağ tıklayınca “SamSync” klasörü, Çalıştır menüsünde aynı komutlar ve kısayollar (Ctrl+Alt+W: son ayarla gönder).')}
                  on={integration.notepadPlusPlus.enabled}
                  onChange={(v) => !integrationBusy && void setIntegration({ notepadPlusPlus: v })}
                />
                <div style={{ margin: '8px 0 0 30px' }}>
                  {integration.notepadPlusPlus.error && (
                    <div className="alert error">
                      <AlertTriangle size={15} /> {integration.notepadPlusPlus.error}
                    </div>
                  )}
                  {!integration.notepadPlusPlus.installs.length && <div className="faint" style={{ fontSize: 12 }}>{t('Bu bilgisayarda Notepad++ bulunamadı.')}</div>}
                  {integration.notepadPlusPlus.installs.map((i) => (
                    <div key={i.configDir} style={{ fontSize: 12, marginBottom: 8 }}>
                      <div className="row" style={{ gap: 6 }}>
                        {i.installed ? <CheckCircle2 size={13} color="var(--green)" /> : <Info size={13} className="faint" />}
                        <span>{i.installed ? t('Kurulu') : t('Kurulu değil')}</span>
                        <span className="faint">
                          {i.version ? `Notepad++ ${i.version}` : 'Notepad++'}
                          {i.portable ? ` • ${t('taşınabilir')}` : ''}
                          {i.running ? ` • ${t('açık')}` : ''}
                        </span>
                      </div>
                      <div className="mono faint selectable" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                        {i.configDir}
                      </div>
                      {i.warnings.map((w) => (
                        <div key={w} style={{ color: 'var(--amber)', fontSize: 12 }}>
                          {w}
                        </div>
                      ))}
                    </div>
                  ))}
                  {integration.notepadPlusPlus.waitingForExit && (
                    <div className="alert info" style={{ marginBottom: 8 }}>
                      <Info size={15} /> {t('Notepad++ açıkken değişti; kapanırken kendi ayarlarını geri yazar. Notepad++ kapanınca SamSync menüyü ve kısayolları yeniden yazar.')}
                    </div>
                  )}
                  {integration.notepadPlusPlus.enabled && <NppShortcuts />}
                </div>
              </>
            )}
          </Section>

          <Section
            id="updates"
            icon={<Download size={15} />}
            title={t('Güncellemeler')}
            desc={t('Sürüm {version}', { version: boot.appVersion })}
            action={
              updDirty && (
                <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={async () => (await saveConfig({ ...boot.config, update: upd })) && toast('ok', t('Güncelleme kaynağı kaydedildi'))}>
                  {t('Kaydet')}
                </Button>
              )
            }
          >
            <Field label={t('Kaynak')}>
              <Segmented
                value={upd.source}
                onChange={(source: UpdateSource) => setUpd({ ...upd, source })}
                options={[
                  { value: 'github', label: 'GitHub', icon: <Cloud size={14} /> },
                  { value: 'url', label: t('Web adresi'), icon: <Globe size={14} /> },
                  { value: 'folder', label: t('Ağ klasörü'), icon: <FolderSync size={14} /> },
                  { value: 'off', label: t('Kapalı'), icon: <Power size={14} /> },
                ]}
              />
            </Field>
            {upd.source === 'url' && (
              <Field label={t('Adres')} help={t('latest.yml ve kurulum dosyalarının bulunduğu klasörün adresi')} style={{ marginTop: 12 }}>
                <input className="input mono" value={upd.url ?? ''} onChange={(e) => setUpd({ ...upd, url: e.target.value })} placeholder="https://sunucu/samsync/" />
              </Field>
            )}
            {upd.source === 'folder' && (
              <Field label={t('Klasör')} help={t('İnternete çıkmayan makineler için: latest.yml + SamSync-Setup-x.y.z.exe')} style={{ marginTop: 12 }}>
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
              <ToggleRow title={t('Açılışta ve 6 saatte bir denetle')} on={s.updateAutoCheck} onChange={(v) => void saveSettings({ updateAutoCheck: v })} />
              <ToggleRow title={t('Yeni sürümü arka planda indir')} on={s.updateAutoDownload} onChange={(v) => void saveSettings({ updateAutoDownload: v })} />
            </div>
            <UpdateStatus />
          </Section>

          <NotificationsSection />

          <WebUiSection Section={Section} />

          <AssistantSection />

          <Section id="about" icon={<Info size={15} />} title={t('Hakkında')}>
            <div className="about-grid">
              <span className="faint">{t('Sürüm')}</span>
              <span>{boot.appVersion}</span>
              <span className="faint">{t('Platform')}</span>
              <span>
                {boot.platform} • {boot.hostname}
              </span>
              <span className="faint">Git</span>
              <span>{boot.gitVersion ?? t('bulunamadı')}</span>
              <span className="faint">{t('Veri klasörü')}</span>
              <span className="mono selectable" style={{ fontSize: 11.5, wordBreak: 'break-all' }}>
                {boot.userDataPath}
              </span>
              <span className="faint">{t('Lisans')}</span>
              <span>
                <a href="https://www.gnu.org/licenses/gpl-3.0.html" onClick={(e) => (e.preventDefault(), void api.openExternal(boot.repositoryUrl ? `${boot.repositoryUrl}/blob/HEAD/LICENSE` : 'https://www.gnu.org/licenses/gpl-3.0.html'))}>
                  GNU GPL v3.0
                </a>{' '}
                <span className="faint">• © 2026 Samet Kurumahmut</span>
              </span>
            </div>
            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <Button size="sm" icon={<FileText size={13} />} onClick={() => void api.openLog()}>
                {t('Günlüğü aç')}
              </Button>
              <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => void api.openPath(boot.userDataPath)}>
                {t('Veri klasörü')}
              </Button>
              <Button
                size="sm"
                icon={<Save size={13} />}
                data-tip={t('Günlükler, yapılandırma, ayarlar ve bir özet tek klasörde (parolalar hariç); bir sorunu anlatırken paylaşın')}
                onClick={async () => {
                  const dir = await api.exportDiagnostics();
                  if (dir) useApp.getState().toast('ok', t('Tanılama klasörü hazır'), dir);
                }}
              >
                {t('Tanılama klasörü oluştur…')}
              </Button>
              <Button size="sm" icon={<Sparkles size={13} />} onClick={async () => useApp.setState({ whatsNew: await api.whatsNew(true) })}>
                {t('Bu sürümdeki yenilikler')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void api.windowControl('devtools')}>
                {t('Geliştirici araçları')}
              </Button>
            </div>
          </Section>
        </div>
        {update?.phase === 'error' && null}
      </div>
    </div>
  );
}

/** The help bot's optional cloud half: a Claude API key, kept encrypted on this machine. */
function AssistantSection() {
  const assistant = useApp((s) => s.assistant);
  const toast = useApp((s) => s.toast);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    setBusy(true);
    try {
      const ok = await api.assistantSetKey(value);
      if (!ok) return toast('error', t('Anahtar saklanamadı'), t('Bu platformda şifreli saklama yok.'));
      useApp.setState({ assistant: await api.assistantStatus() });
      setKey('');
      toast('ok', value ? t('Claude API anahtarı kaydedildi') : t('Claude API anahtarı kaldırıldı'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="assistant" icon={<Bot size={15} />} title={t('Yardım botu')} desc={t('F1 ile açılan bot çevrimdışı SSS ve README’den yanıtlar; bir Claude API anahtarıyla serbest sorulara yapay zekâ ile yanıt verir')}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className={cls('dot', assistant?.configured ? 'ok' : '')} />
          <span style={{ fontSize: 13 }}>{assistant?.configured ? t('Claude bağlı ({model}); sorular belgelerle birlikte Claude’a gider.', { model: assistant.model }) : t('Anahtar yok: bot yalnızca çevrimdışı arama ile yanıtlıyor.')}</span>
        </div>
        <Field label={t('Claude API anahtarı')} help={t('console.anthropic.com’dan alınır; bu makinede işletim sisteminin şifreli deposunda saklanır, yapılandırmaya yazılmaz. Her soru kendi ücretiyle API’ye gider.')}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input mono grow" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" spellCheck={false} />
            <Button size="sm" variant="primary" icon={<Save size={13} />} disabled={!key.trim()} loading={busy} onClick={() => void save(key)}>
              {t('Kaydet')}
            </Button>
            {assistant?.configured && (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} loading={busy} onClick={() => void save(null)}>
                {t('Kaldır')}
              </Button>
            )}
          </div>
        </Field>
      </div>
    </Section>
  );
}

/** Webhook / Telegram reports of finished runs (this machine). */
function NotificationsSection() {
  const boot = useApp((s) => s.boot!);
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const saved = boot.settings.notifications ?? { onSuccess: false, onFailure: true };
  const [n, setN] = useState<NotificationSettings>(saved);
  const [testing, setTesting] = useState(false);
  const dirty = JSON.stringify(n) !== JSON.stringify(saved);
  const any = !!(n.webhookUrl || (n.telegramToken && n.telegramChatId));
  return (
    <Section
      id="notifications"
      icon={<Bell size={15} />}
      title={t('Bildirimler')}
      desc={t('Gönderim bitince ekibe haber: bir web kancası ya da Telegram')}
      action={
        dirty && (
          <div className="row">
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setN(saved)}>
              {t('Geri al')}
            </Button>
            <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={async () => (await saveSettings({ notifications: n }), toast('ok', t('Bildirim ayarları kaydedildi')))}>
              {t('Kaydet')}
            </Button>
          </div>
        )
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Field label={t('Web kancası (URL)')} help={t('Her bitişte JSON gönderilir: durum, etiket, makineler, işlem ve bayt sayıları, süre, özet metin. Teams/Slack iş akışı ya da kendi betiğiniz.')}>
          <input className="input mono" value={n.webhookUrl ?? ''} onChange={(e) => setN({ ...n, webhookUrl: e.target.value.trim() || undefined })} placeholder="https://…" spellCheck={false} />
        </Field>
        <div className="form-grid">
          <Field label={t('Telegram bot anahtarı')} help={t('@BotFather’dan; yalnızca bu makinede saklanır')}>
            <input className="input mono" type="password" value={n.telegramToken ?? ''} onChange={(e) => setN({ ...n, telegramToken: e.target.value.trim() || undefined })} placeholder="123456:ABC…" spellCheck={false} />
          </Field>
          <Field label={t('Telegram sohbet kimliği')} help={t('Kişi ya da grup; botu gruba ekleyip kimliğini öğrenin')}>
            <input className="input mono" value={n.telegramChatId ?? ''} onChange={(e) => setN({ ...n, telegramChatId: e.target.value.trim() || undefined })} placeholder="-1001234567890" spellCheck={false} />
          </Field>
        </div>
        <ToggleRow title={t('Başarılı gönderimlerde de bildir')} desc={t('Kapalıyken yalnızca hatalı ya da kısmi bitenler gider')} on={n.onSuccess} onChange={(v) => setN({ ...n, onSuccess: v })} />
        <ToggleRow title={t('Hatalı ve kısmi gönderimlerde bildir')} on={n.onFailure} onChange={(v) => setN({ ...n, onFailure: v })} />
        <div className="row">
          <Button
            size="sm"
            icon={<Send size={13} />}
            loading={testing}
            disabled={!any || dirty}
            tip={dirty ? t('Önce kaydedin') : undefined}
            onClick={async () => {
              setTesting(true);
              try {
                const r = await api.notifyTest();
                const lines = Object.entries(r).map(([ch, res]) => `${ch}: ${res}`);
                const ok = Object.values(r).every((x) => x === 'ok');
                toast(ok ? 'ok' : 'error', ok ? t('Sınama iletisi gitti') : t('Sınama iletisi gönderilemedi'), lines.join(' • '));
              } finally {
                setTesting(false);
              }
            }}
          >
            {t('Sına')}
          </Button>
          <span className="faint" style={{ fontSize: 12 }}>
            {t('Deneme çalıştırmaları bildirilmez. Masaüstü bildirimi ayrıca "Bitince bildir" seçeneğine bağlıdır.')}
          </span>
        </div>
      </div>
    </Section>
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
            {p === 'idle' && t('Henüz denetlenmedi')}
            {p === 'checking' && t('Denetleniyor…')}
            {p === 'none' && t('Güncel sürümü kullanıyorsunuz')}
            {p === 'available' && t('Yeni sürüm: {version}', { version: update.version ?? '' })}
            {p === 'downloading' && t('İndiriliyor… %{n}', { n: Math.round(update.percent ?? 0) })}
            {p === 'ready' && t('{version} kurulmaya hazır', { version: update.version ?? '' })}
            {p === 'error' && t('Güncelleme hatası')}
            {p === 'unsupported' && t('Bu kurulumda güncelleme yok')}
          </div>
          {/* the whole message wraps: an error cut off after a few words says nothing */}
          <div className="faint selectable" style={{ fontSize: 12, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            {update.error ?? update.detail ?? (update.checkedAt ? t('Son denetim {time}', { time: ago(update.checkedAt) }) : '')}
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
            {t('Şimdi denetle')}
          </Button>
        )}
        {p === 'available' && (
          <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={async () => useApp.setState({ update: await api.updateDownload() })}>
            {t('İndir')}
          </Button>
        )}
        {p === 'ready' && (
          <Button size="sm" variant="primary" onClick={() => useApp.setState({ updatePrompt: true })}>
            {t('Yeniden başlat ve kur')}
          </Button>
        )}
        <ReleaseNotesButton />
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

const SHOW_NODES = [
  { value: 'auto', label: tk('Sığdıkça'), tip: tk('Windows menüsünde 16 girdiye kadar: önce bu makinenin grubu, sonra sığarsa diğer gruplar alt menüyle') },
  { value: 'always', label: tk('Her zaman'), tip: tk('Bütün grupları alt menüsüyle göster') },
  { value: 'never', label: tk('Yalnızca gruplar'), tip: tk('Gruplar tek girdi olarak bütün gruba gönderir; tek tek makineler yok') },
] as const;

/** notepadPlusPlusShortcuts in the shared config: menu entry id -> "Ctrl+Alt+W". */
function NppShortcuts() {
  const boot = useApp((s) => s.boot!);
  const saveConfig = useApp((s) => s.saveConfig);
  const entries = menuEntries(boot.config, boot.identity.node?.id);
  const saved = boot.config.notepadPlusPlusShortcuts ?? { 'wizard:last': 'Ctrl+Alt+W' };
  const [rows, setRows] = useState<{ id: string; keys: string }[]>(() => Object.entries(saved).map(([id, keys]) => ({ id, keys })));
  const dirty = JSON.stringify(Object.fromEntries(rows.filter((r) => r.id).map((r) => [r.id, r.keys.trim()]))) !== JSON.stringify(saved);
  useUnsaved('settings.npp', t('Notepad++ kısayolları'), dirty);
  return (
    <Field label={t('Notepad++ kısayolları')} style={{ marginTop: 6 }}>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
          <select className="select grow" value={r.id} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}>
            {!entries.some((e) => e.id === r.id) && <option value={r.id}>{r.id}</option>}
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <input className="input mono" style={{ width: 150 }} value={r.keys} placeholder="Ctrl+Alt+W" spellCheck={false} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, keys: e.target.value } : x)))} />
          <Button iconOnly size="sm" variant="ghost" icon={<RotateCcw size={13} />} tip={t('Kaldır')} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" onClick={() => setRows([...rows, { id: 'wizard:last', keys: '' }])}>
          {t('Kısayol ekle')}
        </Button>
        <span className="spacer" />
        {dirty && (
          <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={() => void saveConfig({ ...boot.config, notepadPlusPlusShortcuts: Object.fromEntries(rows.filter((r) => r.id && r.keys.trim()).map((r) => [r.id, r.keys.trim()])) })}>
            {t('Kaydet')}
          </Button>
        )}
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
        {t('Ctrl, Alt, Shift ile bir tuş: harf, rakam, F1–F24, Insert, Delete, Home, End, PageUp, PageDown, yön tuşları. Paylaşılan yapılandırmaya yazılır, bütün makinelerde geçerlidir.')}
      </div>
    </Field>
  );
}
