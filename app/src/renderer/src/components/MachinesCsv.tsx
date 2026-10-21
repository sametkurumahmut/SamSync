// Targets › Configuration: the machine list to a CSV file and back (set many machines up in a spreadsheet). An import
// shows what it would add and change before anything is saved; the machines it does not name stay as they are.
import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { NodeConfig } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Modal } from './ui';
import { mergeMachines } from '@shared/machinecsv';
import { t } from '@shared/i18n';

export function MachinesCsvButtons() {
  const boot = useApp((s) => s.boot!);
  const toast = useApp((s) => s.toast);
  const saveConfig = useApp((s) => s.saveConfig);
  const [preview, setPreview] = useState<{ file: string; nodes: NodeConfig[]; errors: string[] } | null>(null);
  const local = boot.isElectron && !boot.remote;
  const exportCsv = async () => {
    const dest = await api.pickSave({ title: t('Makine listesini kaydet'), defaultPath: 'makineler.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!dest) return;
    try {
      await api.exportMachinesCsv(dest);
      toast('ok', t('Makine listesi kaydedildi'), dest);
    } catch (e) {
      toast('error', t('Kaydedilemedi'), (e as Error).message);
    }
  };
  const importCsv = async () => {
    const [file] = await api.pick({ title: t('Makine listesini seçin'), filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
    if (!file) return;
    try {
      setPreview({ file, ...(await api.readMachinesCsv(file)) });
    } catch (e) {
      toast('error', t('Okunamadı'), (e as Error).message);
    }
  };
  const merged = preview ? mergeMachines(boot.config.nodes, preview.nodes) : null;
  const apply = async () => {
    if (!merged) return;
    if (await saveConfig({ ...boot.config, nodes: merged.nodes })) {
      toast('ok', t('{added} makine eklendi, {changed} makine güncellendi', { added: merged.added.length, changed: merged.changed.length }));
      setPreview(null);
    }
  };
  return (
    <>
      <Button size="sm" icon={<Download size={13} />} disabled={!local || !boot.config.nodes.length} onClick={() => void exportCsv()}>
        {t('CSV olarak dışa aktar…')}
      </Button>
      <Button size="sm" icon={<Upload size={13} />} disabled={!local || !boot.configWritable} onClick={() => void importCsv()}>
        {t('CSV’den içe aktar…')}
      </Button>
      {preview && merged && (
        <Modal
          size="medium"
          title={t('Makine listesini içe aktar')}
          icon={<Upload size={16} />}
          onClose={() => setPreview(null)}
          footer={
            <>
              <Button onClick={() => setPreview(null)}>{t('Vazgeç')}</Button>
              <Button variant="primary" disabled={!merged.added.length && !merged.changed.length} onClick={() => void apply()}>
                {t('Uygula')}
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {t('{added} yeni, {changed} değişen, {same} aynı makine. Dosyada olmayan makineler olduğu gibi kalır.', { added: merged.added.length, changed: merged.changed.length, same: merged.same })}
          </p>
          {preview.errors.length > 0 && <div className="alert warn">{preview.errors.slice(0, 8).join('\n')}</div>}
          {[...merged.added.map((n) => ['+', n] as const), ...merged.changed.map((n) => ['~', n] as const)].slice(0, 200).map(([sign, n]) => (
            <div key={sign + n.id} className="row" style={{ gap: 8, fontSize: 12.5, padding: '2px 0' }}>
              <b style={{ width: 12, color: sign === '+' ? 'var(--green)' : 'var(--amber)' }}>{sign}</b>
              <span className="mono">{n.id}</span>
              <span className="grow truncate">{n.name}</span>
              <span className="faint truncate">{[n.group, n.address, ...(n.tags ?? []).map((x) => '#' + x)].filter(Boolean).join(' • ')}</span>
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}
