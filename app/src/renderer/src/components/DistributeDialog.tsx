// Distributing from a machine: SamSync on it sends folders of its own disk to the other machines over its own
// network (a machine that holds the right release puts the others right; nothing crosses this computer's link).
import { useEffect, useState } from 'react';
import { Waypoints } from 'lucide-react';
import type { InventoryEntry, NodeConfig, SendMode } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Checkbox, Field, ListSkeleton, Modal, Segmented } from './ui';
import { ago, bytes, cls, num } from '../lib/format';
import { t } from '@shared/i18n';
import { machineLabel } from '@shared/machine';

export function DistributeDialog({ source, onClose }: { source: NodeConfig; onClose: () => void }) {
  const nodes = useApp((s) => s.boot!.config.nodes);
  const localId = useApp((s) => s.boot!.identity.node?.id);
  const probes = useApp((s) => s.probes);
  const toast = useApp((s) => s.toast);
  const [folders, setFolders] = useState<InventoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const others = nodes.filter((n) => n.enabled && n.id !== source.id && n.id !== localId);
  // the machines of its own group, to begin with
  const [targets, setTargets] = useState<Set<string>>(new Set(others.filter((n) => source.group && n.group === source.group).map((n) => n.id)));
  const [mode, setMode] = useState<SendMode>('overwrite');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .machineFolders(source.id)
      .then((f) => {
        setFolders(f);
        setPicked(new Set(f.map((x) => x.rel)));
      })
      .catch((e) => setError((e as Error).message));
  }, [source.id]);
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const go = async () => {
    if (mode === 'mirror' && !confirm(t('Ayna kipi hedeflerde {name} makinesinde olmayan dosyaları siler. Sürsün mü?', { name: source.name }))) return;
    setBusy(true);
    try {
      const runId = await api.distributeFrom(source.id, [...picked], [...targets], mode);
      onClose();
      useApp.getState().watchRun(runId);
    } catch (e) {
      toast('error', t('Dağıtılamadı'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      size="medium"
      title={t('{name} makinesinden dağıt', { name: source.name })}
      icon={<Waypoints size={16} />}
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ fontSize: 12 }}>
            {t('Dosyalar {name} makinesinden, onun ağı üzerinden gider; bu bilgisayardan bir şey gitmez.', { name: machineLabel(source.name).title })}
          </span>
          <span className="spacer" />
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" loading={busy} disabled={!picked.size || !targets.size} onClick={() => void go()}>
            {t('Dağıt')}
          </Button>
        </>
      }
    >
      <Field label={t('Klasörler')} help={t('O makinenin manifestindeki, SamSync’in oraya gönderdiği klasörler')}>
        {error && <div className="alert error">{error}</div>}
        {!folders && !error && <ListSkeleton rows={3} />}
        {folders && !folders.length && <div className="faint">{t('O makinede manifest yok: SamSync oraya henüz bir şey göndermemiş.')}</div>}
        {folders?.map((f) => (
          <div key={f.rel} className="row" style={{ gap: 8, padding: '3px 0' }}>
            <Checkbox checked={picked.has(f.rel)} onChange={() => setPicked(toggle(picked, f.rel))} label={f.rel || '/'} />
            <span className="mono">{f.rel || '/'}</span>
            <span className="faint" style={{ fontSize: 12 }}>
              {f.label || t('(adsız)')} • {ago(f.writtenAt)} • {t('{n} dosya', { n: num(f.files) })} • {bytes(f.size)}
            </span>
          </div>
        ))}
      </Field>
      <Field label={t('Hedefler')} style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {others.map((n) => (
            <button key={n.id} className={cls('chip', targets.has(n.id) && 'on')} aria-pressed={targets.has(n.id)} onClick={() => setTargets(toggle(targets, n.id))}>
              <span className={cls('dot', probes[n.id] ? (probes[n.id].ok ? 'ok' : 'bad') : '')} /> {machineLabel(n.name).title}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('Kip')} style={{ marginTop: 12 }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'overwrite', label: t('Üzerine yaz') },
            { value: 'update', label: t('Yalnızca yeni') },
            { value: 'mirror', label: t('Ayna') },
          ]}
        />
      </Field>
    </Modal>
  );
}
