// Targets › Select: the actions for several machines at once (wake, restart, update, switch on or off, tags, group).
import { useState } from 'react';
import { ArrowUpCircle, FolderInput, Hash, Power, PowerOff, RotateCw, ToggleLeft, ToggleRight, X } from 'lucide-react';
import type { NodeConfig } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Field, Modal } from './ui';
import { t } from '@shared/i18n';
import { compareVersions } from '@shared/version';

const ID_RE = /^[A-Za-z0-9._-]+$/;

export function BulkBar({ ids, onClear, onUpdate, onWake }: { ids: string[]; onClear: () => void; onUpdate: (ids: string[]) => void; onWake: (ids: string[]) => void }) {
  const boot = useApp((s) => s.boot!);
  const probes = useApp((s) => s.probes);
  const saveConfig = useApp((s) => s.saveConfig);
  const toast = useApp((s) => s.toast);
  const [ask, setAsk] = useState<null | 'addTag' | 'removeTag' | 'group'>(null);
  const [value, setValue] = useState('');
  const cfg = boot.config;
  const picked = cfg.nodes.filter((n) => ids.includes(n.id));
  const editable = boot.configWritable && !boot.readOnly;
  const change = async (fn: (n: NodeConfig) => NodeConfig) => {
    if (await saveConfig({ ...cfg, nodes: cfg.nodes.map((n) => (ids.includes(n.id) ? fn(n) : n)) })) toast('ok', t('{n} makine güncellendi', { n: ids.length }));
  };
  const power = async (action: 'restart' | 'shutdown') => {
    const able = picked.filter((n) => probes[n.id]?.agent?.alive && probes[n.id]?.agent?.power);
    if (!able.length) return toast('warn', t('Seçilenlerden hiçbiri buna izin vermiyor'), t('O makinelerde Ayarlar › Ajan › yeniden başlatma ve kapatma izni açık olmalı'));
    if (!confirm(action === 'restart' ? t('{n} makine bir dakika içinde yeniden başlatılsın mı?', { n: able.length }) : t('{n} makine bir dakika içinde kapatılsın mı?', { n: able.length }))) return;
    const r = await api.power(
      able.map((n) => n.id),
      action,
    );
    const bad = r.filter((x) => !x.ok);
    toast(bad.length ? 'warn' : 'ok', t('{ok} makine {action}', { ok: r.length - bad.length, action: action === 'restart' ? t('yeniden başlıyor') : t('kapanıyor') }), bad.map((x) => `${x.nodeId}: ${x.error}`).join('\n') || undefined);
  };
  const outdated = picked.filter((n) => {
    const a = probes[n.id]?.agent;
    return !!a?.alive && !!a.updates && !!a.version && compareVersions(a.version, boot.appVersion) < 0;
  });
  const offline = picked.filter((n) => probes[n.id] && !probes[n.id].ok && probes[n.id].macs?.length);
  const apply = async () => {
    const v = value.trim().replace(/\s+/g, '-');
    if (ask !== 'group' || v) {
      if (!ID_RE.test(v) && !(ask === 'group' && !v)) return toast('error', t('Yalnızca harf, rakam, nokta, alt çizgi, tire'));
    }
    if (ask === 'addTag') await change((n) => ({ ...n, tags: [...new Set([...(n.tags ?? []), v])] }));
    else if (ask === 'removeTag') await change((n) => ({ ...n, tags: (n.tags ?? []).filter((x) => x.toLowerCase() !== v.toLowerCase()) }));
    else if (ask === 'group') await change((n) => ({ ...n, group: v || undefined }));
    setAsk(null);
    setValue('');
  };
  const tags = [...new Set(cfg.nodes.flatMap((n) => n.tags ?? []))];
  const groups = [...new Set(cfg.nodes.map((n) => n.group).filter(Boolean))] as string[];
  return (
    <div className="bulk-bar card">
      <b>{t('{n} makine seçili', { n: ids.length })}</b>
      <span className="spacer" />
      <Button size="sm" icon={<Power size={13} />} disabled={!offline.length} tip={t('Kapalı olanları uyandırır (MAC adresi bilinenler)')} onClick={() => onWake(offline.map((n) => n.id))}>
        {t('Uyandır')}
      </Button>
      <Button size="sm" icon={<RotateCw size={13} />} onClick={() => void power('restart')}>
        {t('Yeniden başlat')}
      </Button>
      <Button size="sm" icon={<PowerOff size={13} />} onClick={() => void power('shutdown')}>
        {t('Kapat')}
      </Button>
      <Button size="sm" icon={<ArrowUpCircle size={13} />} disabled={!outdated.length} onClick={() => onUpdate(outdated.map((n) => n.id))}>
        {t('Ajanları güncelle')}
      </Button>
      <Button size="sm" icon={<ToggleRight size={13} />} disabled={!editable} onClick={() => void change((n) => ({ ...n, enabled: true }))}>
        {t('Etkinleştir')}
      </Button>
      <Button size="sm" icon={<ToggleLeft size={13} />} disabled={!editable} onClick={() => void change((n) => ({ ...n, enabled: false }))}>
        {t('Devre dışı bırak')}
      </Button>
      <Button size="sm" icon={<Hash size={13} />} disabled={!editable} onClick={() => setAsk('addTag')}>
        {t('Etiket ekle…')}
      </Button>
      <Button size="sm" icon={<Hash size={13} />} disabled={!editable || !tags.length} onClick={() => setAsk('removeTag')}>
        {t('Etiketi kaldır…')}
      </Button>
      <Button size="sm" icon={<FolderInput size={13} />} disabled={!editable} onClick={() => setAsk('group')}>
        {t('Gruba taşı…')}
      </Button>
      <Button size="sm" variant="ghost" iconOnly icon={<X size={13} />} tip={t('Seçimi bırak')} onClick={onClear} />
      {ask && (
        <Modal
          title={ask === 'addTag' ? t('Etiket ekle') : ask === 'removeTag' ? t('Etiketi kaldır') : t('Gruba taşı')}
          onClose={() => setAsk(null)}
          footer={
            <>
              <Button onClick={() => setAsk(null)}>{t('Vazgeç')}</Button>
              <Button variant="primary" disabled={ask !== 'group' && !value.trim()} onClick={() => void apply()}>
                {t('Uygula')}
              </Button>
            </>
          }
        >
          <Field label={ask === 'group' ? t('Grup') : t('Etiket')} help={ask === 'group' ? t('Boş bırakılırsa makineler gruptan çıkar') : t('{n} makineye uygulanır', { n: ids.length })}>
            <input className="input" list="bulk-values" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void apply()} />
            <datalist id="bulk-values">
              {(ask === 'group' ? groups : tags).map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </Field>
        </Modal>
      )}
    </div>
  );
}
