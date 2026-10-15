import { FileJson, Upload, Plus, AlertTriangle, Send, GitBranch, ArrowLeftRight } from 'lucide-react';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button } from '../components/ui';
import iconUrl from '../../../../resources/icon.png';

export function Welcome() {
  const boot = useApp((s) => s.boot!);
  const setBoot = useApp((s) => s.setBoot);
  const saveConfig = useApp((s) => s.saveConfig);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);

  const useShared = async () => {
    const [p] = await api.pick({ files: true, title: 'config.json seçin', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    const b = await api.useConfigFile(p);
    setBoot(b);
    if (b.configError) toast('error', 'Dosya okunamadı', b.configError);
    else toast('ok', `${b.config.nodes.length} makine yüklendi`, b.identity.node ? `Bu makine: ${b.identity.node.name}` : b.identity.reason);
  };
  const importCopy = async () => {
    const [p] = await api.pick({ files: true, title: 'İçe aktarılacak config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!p) return;
    try {
      const cfg = await api.readConfigFile(p);
      if (await saveConfig(cfg)) toast('ok', 'İçe aktarıldı', `${cfg.nodes.length} makine`);
    } catch (e) {
      toast('error', 'İçe aktarılamadı', (e as Error).message);
    }
  };

  return (
    <div className="page welcome">
      <div className="welcome-inner">
        <img src={iconUrl} alt="" className="welcome-logo" />
        <h1>SamSync’e hoş geldiniz</h1>
        <p className="muted">
          Dosyaları, klasörleri ve Git değişikliklerini birden çok makineye aynı göreli yolla gönderin; hedefleri karşılaştırın, eşitleyin ve gerekirse eski hâline döndürün.
        </p>
        {boot.configError && (
          <div className="alert error" style={{ textAlign: 'left', marginBottom: 16 }}>
            <AlertTriangle size={16} />
            <div>
              <b>Yapılandırma okunamadı</b>
              <div className="selectable mono" style={{ fontSize: 12 }}>
                {boot.configPath}
              </div>
              <div className="selectable">{boot.configError}</div>
            </div>
          </div>
        )}
        <div className="welcome-cards">
          <button className="welcome-card" onClick={() => void useShared()} disabled={!boot.isElectron}>
            <div className="icon-tile accent lg">
              <FileJson size={18} />
            </div>
            <b>Mevcut config.json’ı kullan</b>
            <span className="muted">Ağ paylaşımındaki ya da eski PowerShell aracının dosyası. Değişiklikler ona yazılır, bütün makineler aynı listeyi görür.</span>
          </button>
          <button className="welcome-card" onClick={() => void importCopy()} disabled={!boot.isElectron}>
            <div className="icon-tile lg">
              <Upload size={18} />
            </div>
            <b>Kopyasını içe aktar</b>
            <span className="muted">Makineleri bu bilgisayardaki kendi yapılandırma dosyasına kopyalar.</span>
          </button>
          <button className="welcome-card" onClick={() => setPage('targets')}>
            <div className="icon-tile lg">
              <Plus size={18} />
            </div>
            <b>Sıfırdan başla</b>
            <span className="muted">Makineleri tek tek ekleyin: adres, paylaşım kökü ve yerel kökler.</span>
          </button>
        </div>
        <div className="welcome-features">
          <span>
            <Send size={14} /> Çoklu hedefe gönderim
          </span>
          <span>
            <GitBranch size={14} /> Commit ve yerel değişiklikler
          </span>
          <span>
            <ArrowLeftRight size={14} /> Klasör senkronu
          </span>
        </div>
      </div>
    </div>
  );
}
