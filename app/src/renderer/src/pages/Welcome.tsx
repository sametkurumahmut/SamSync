import { useState } from 'react';
import { FileJson, Upload, Plus, AlertTriangle, Send, GitBranch, ArrowLeftRight, Wand2 } from 'lucide-react';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { SetupWizard } from '../components/SetupWizard';
import iconUrl from '../../../../resources/icon.png';
import { t } from '@shared/i18n';

export function Welcome() {
  const boot = useApp((s) => s.boot!);
  const setBoot = useApp((s) => s.setBoot);
  const saveConfig = useApp((s) => s.saveConfig);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const [wizard, setWizard] = useState(false);

  const openShared = async () => {
    const [p] = await api.pick({ files: true, title: t('config.json seçin'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    const b = await api.useConfigFile(p);
    setBoot(b);
    if (b.configError) toast('error', t('Dosya okunamadı'), b.configError);
    else toast('ok', t('{n} makine yüklendi', { n: b.config.nodes.length }), b.identity.node ? t('Bu makine: {name}', { name: b.identity.node.name }) : b.identity.reason);
  };
  const importCopy = async () => {
    const [p] = await api.pick({ files: true, title: t('İçe aktarılacak config.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    try {
      const cfg = await api.readConfigFile(p);
      if (await saveConfig(cfg)) toast('ok', t('İçe aktarıldı'), t('{n} makine', { n: cfg.nodes.length }));
    } catch (e) {
      toast('error', t('İçe aktarılamadı'), (e as Error).message);
    }
  };

  return (
    <div className="page welcome">
      <div className="welcome-inner">
        <img src={iconUrl} alt="" className="welcome-logo" />
        <h1>{t('SamSync’e hoş geldiniz')}</h1>
        <p className="muted">
          {t('Dosyaları, klasörleri ve Git değişikliklerini birden çok makineye aynı göreli yolla gönderin; hedefleri karşılaştırın, eşitleyin ve gerekirse eski hâline döndürün.')}
        </p>
        {boot.configError && (
          <div className="alert error" style={{ textAlign: 'left', marginBottom: 16 }}>
            <AlertTriangle size={16} />
            <div>
              <b>{t('Yapılandırma okunamadı')}</b>
              <div className="selectable mono" style={{ fontSize: 12 }}>
                {boot.configPath}
              </div>
              <div className="selectable">{boot.configError}</div>
            </div>
          </div>
        )}
        <div className="welcome-cards">
          <button className="welcome-card primary" onClick={() => setWizard(true)}>
            <div className="icon-tile accent lg">
              <Wand2 size={18} />
            </div>
            <b>{t('Kurulum sihirbazı')}</b>
            <span className="muted">{t('Üç adım: bu makine, ağda bulunan makineler, kaydet. Birkaç dakikada ilk gönderime hazır.')}</span>
          </button>
          <button className="welcome-card" onClick={() => void openShared()} disabled={!boot.isElectron}>
            <div className="icon-tile accent lg">
              <FileJson size={18} />
            </div>
            <b>{t('Mevcut config.json’ı kullan')}</b>
            <span className="muted">{t('Ağ paylaşımındaki ya da eski PowerShell aracının dosyası. Değişiklikler ona yazılır, bütün makineler aynı listeyi görür.')}</span>
          </button>
          <button className="welcome-card" onClick={() => void importCopy()} disabled={!boot.isElectron}>
            <div className="icon-tile lg">
              <Upload size={18} />
            </div>
            <b>{t('Kopyasını içe aktar')}</b>
            <span className="muted">{t('Makineleri bu bilgisayardaki kendi yapılandırma dosyasına kopyalar.')}</span>
          </button>
          <button className="welcome-card" onClick={() => setPage('targets')}>
            <div className="icon-tile lg">
              <Plus size={18} />
            </div>
            <b>{t('Elle ekle')}</b>
            <span className="muted">{t('Makineleri tek tek ekleyin: adres, paylaşım kökü ve yerel kökler.')}</span>
          </button>
        </div>
        {wizard && <SetupWizard onClose={() => setWizard(false)} />}
        <div className="welcome-features">
          <span>
            <Send size={14} /> {t('Çoklu hedefe gönderim')}
          </span>
          <span>
            <GitBranch size={14} /> {t('Commit ve yerel değişiklikler')}
          </span>
          <span>
            <ArrowLeftRight size={14} /> {t('Klasör senkronu')}
          </span>
        </div>
      </div>
    </div>
  );
}
