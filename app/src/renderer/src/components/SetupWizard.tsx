// First start without a configuration: three steps to a working setup. This machine (name, address, the folder
// it sends from), the machines found on the network (ticked off a scan), and a look at the list before it is
// saved as the configuration. Everything can be changed later on the Targets page.
import { useMemo, useState } from 'react';
import { Laptop, Radar, ClipboardCheck, FolderOpen, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { DiscoveredHost, NodeConfig } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Field, Modal } from './ui';
import { DiscoverPanel, nodeFromHost } from './DiscoverDialog';
import { baseName, cls } from '../lib/format';
import { t } from '@shared/i18n';

const ID_RE = /^[A-Za-z0-9._-]+$/;
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const isV4 = (a: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a) && !a.startsWith('127.') && !a.startsWith('169.254.');

export function SetupWizard({ onClose }: { onClose: () => void }) {
  const boot = useApp((s) => s.boot!);
  const saveConfig = useApp((s) => s.saveConfig);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const addresses = useMemo(() => boot.identity.addresses.filter(isV4), [boot.identity.addresses]);
  const [me, setMe] = useState({ name: boot.hostname, id: slug(boot.hostname), idTouched: false, group: '', address: addresses[0] ?? '', localRoot: '', networkRoot: 'Share\\Release', rootTouched: false });
  const [picked, setPicked] = useState<Map<string, DiscoveredHost>>(new Map());
  const [edits, setEdits] = useState<Record<string, Partial<NodeConfig>>>({});
  const [saving, setSaving] = useState(false);

  const folder = me.localRoot ? baseName(me.localRoot) : 'Release';
  const setLocalRoot = (p: string) => setMe((m) => ({ ...m, localRoot: p, networkRoot: m.rootTouched ? m.networkRoot : `Share\\${baseName(p) || 'Release'}` }));
  const pickRoot = async () => {
    const [p] = await api.pick({ folders: true, title: t('Bu makinenin gönderdiği klasör') });
    if (p) setLocalRoot(p);
  };

  const meNode: NodeConfig = {
    id: me.id,
    name: me.name || me.id,
    address: me.address,
    group: me.group || undefined,
    localRoots: me.localRoot ? [me.localRoot] : [],
    networkRoot: me.networkRoot,
    enabled: true,
    transport: 'smb',
    localNames: [boot.hostname],
  };
  const others: NodeConfig[] = [...picked.values()].map((h) => {
    const base = nodeFromHost(h, { group: me.group, folder });
    const e = edits[h.address] ?? {};
    return { ...base, ...e, id: e.id ?? base.id!, name: e.name ?? base.name!, address: h.address, localRoots: [], enabled: true, networkRoot: e.networkRoot ?? base.networkRoot! } as NodeConfig;
  });
  const nodes = [meNode, ...others];
  const ids = nodes.map((n) => n.id.toLowerCase());
  const problems: string[] = [];
  if (!me.id || !ID_RE.test(me.id)) problems.push(t('Bu makinenin kimliği yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir'));
  if (!me.address) problems.push(t('Bu makinenin adresi gerekli'));
  for (const n of others) if (!ID_RE.test(n.id)) problems.push(t('{name}: kimlik geçersiz', { name: n.name }));
  if (new Set(ids).size !== ids.length) problems.push(t('Kimlikler tekrar ediyor'));
  const step1Ok = !!me.id && ID_RE.test(me.id) && !!me.address;

  const save = async () => {
    if (problems.length) return;
    setSaving(true);
    const ok = await saveConfig({ ...boot.config, nodes });
    setSaving(false);
    if (!ok) return;
    toast('ok', t('Kurulum tamamlandı'), t('{n} makine kaydedildi. Hedefler sayfasından her zaman değiştirebilirsiniz.', { n: nodes.length }));
    onClose();
    setPage(others.length ? 'overview' : 'targets');
  };

  const steps = [
    { n: 1, icon: <Laptop size={13} />, label: t('Bu makine') },
    { n: 2, icon: <Radar size={13} />, label: t('Makineleri bul') },
    { n: 3, icon: <ClipboardCheck size={13} />, label: t('Gözden geçir ve kaydet') },
  ];
  return (
    <Modal
      size="wide"
      title={t('Kurulum sihirbazı')}
      icon={<Laptop size={16} />}
      onClose={onClose}
      closeOnScrim={false}
      footer={
        <>
          <div className="wizard-steps grow">
            {steps.map((s) => (
              <span key={s.n} className={cls('wizard-step', step === s.n && 'on', step > s.n && 'done')}>
                {step > s.n ? <Check size={12} /> : s.icon} {s.label}
              </span>
            ))}
          </div>
          {step > 1 && (
            <Button icon={<ArrowLeft size={14} />} onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
              {t('Geri')}
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" icon={<ArrowRight size={14} />} disabled={step === 1 && !step1Ok} onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}>
              {step === 2 && !picked.size ? t('Makinesiz devam et') : t('İleri')}
            </Button>
          ) : (
            <Button variant="primary" icon={<Check size={14} />} loading={saving} disabled={problems.length > 0} onClick={() => void save()}>
              {t('Kaydet ve başla')}
            </Button>
          )}
        </>
      }
    >
      {step === 1 && (
        <div className="col" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            {t('SamSync bu bilgisayarı yapılandırmadaki makinelerden biri olarak tanır; buradan gönderir, başkaları buraya gönderir.')}
          </p>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Field label={t('Ad')} style={{ flex: 1 }}>
              <input className="input" value={me.name} onChange={(e) => setMe((m) => ({ ...m, name: e.target.value, id: m.idTouched ? m.id : slug(e.target.value) }))} />
            </Field>
            <Field label={t('Kimlik')} help={t('Yapılandırmada ve komut satırında kullanılan kısa ad')} style={{ width: 200 }}>
              <input className="input mono" value={me.id} onChange={(e) => setMe((m) => ({ ...m, id: e.target.value.trim(), idTouched: true }))} />
            </Field>
            <Field label={t('Grup')} help={t('İsteğe bağlı; aynı gruptaki makineler birlikte seçilir')} style={{ width: 160 }}>
              <input className="input" value={me.group} placeholder="Lab-A" onChange={(e) => setMe((m) => ({ ...m, group: e.target.value.trim() }))} />
            </Field>
          </div>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Field label={t('Adres')} help={t('Diğer makinelerin bu bilgisayara ulaştığı IP')} style={{ width: 220 }}>
              {addresses.length ? (
                <select className="select" value={me.address} onChange={(e) => setMe((m) => ({ ...m, address: e.target.value }))}>
                  {addresses.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input mono" value={me.address} placeholder="10.10.1.10" onChange={(e) => setMe((m) => ({ ...m, address: e.target.value.trim() }))} />
              )}
            </Field>
            <Field label={t('Yerel kök')} help={t('Bu bilgisayarın gönderdiği klasör; göreli yollar buna göre hesaplanır')} style={{ flex: 1 }}>
              <div className="row" style={{ gap: 6 }}>
                <input className="input mono" value={me.localRoot} placeholder="D:\Release" onChange={(e) => setLocalRoot(e.target.value)} />
                <Button icon={<FolderOpen size={14} />} onClick={() => void pickRoot()} disabled={!boot.isElectron}>
                  {t('Seç')}
                </Button>
              </div>
            </Field>
            <Field label={t('Paylaşım kökü')} help={t('Başkalarının bu bilgisayara yazdığı paylaşım yolu')} style={{ width: 220 }}>
              <input className="input mono" value={me.networkRoot} onChange={(e) => setMe((m) => ({ ...m, networkRoot: e.target.value, rootTouched: true }))} />
            </Field>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="col" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0 }}>
            {t('Hedef olacak makineleri işaretleyin. Paylaşım kökü, bulunan ilk paylaşım ve yerel kökün adıyla ({folder}) önerilir; sonraki adımda düzeltebilirsiniz.', { folder })}
          </p>
          <DiscoverPanel
            autoStart
            compact
            selected={new Set(picked.keys())}
            onToggle={(h, on) =>
              setPicked((p) => {
                const next = new Map(p);
                if (on) next.set(h.address, h);
                else next.delete(h.address);
                return next;
              })
            }
          />
        </div>
      )}
      {step === 3 && (
        <div className="col" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0 }}>
            {t('Kaydedilecek makineler. Ad ve paylaşım kökü burada düzeltilebilir; gerisi Hedefler sayfasında.')}
          </p>
          <div className="table-head wizard-cols">
            <span>{t('Kimlik')}</span>
            <span>{t('Ad')}</span>
            <span>{t('Adres')}</span>
            <span>{t('Paylaşım kökü')}</span>
          </div>
          <div className="wizard-rows">
            {nodes.map((n, i) => {
              const own = i === 0;
              const key = own ? '' : n.address;
              return (
                <div key={n.id + n.address} className="list-row wizard-cols" style={{ height: 'auto', padding: '6px 12px' }}>
                  <span className="mono ellipsis">
                    {n.id}
                    {own && <span className="badge blue" style={{ marginLeft: 6 }}>{t('bu makine')}</span>}
                  </span>
                  {own ? <span className="ellipsis">{n.name}</span> : <input className="input sm" value={n.name} onChange={(e) => setEdits((x) => ({ ...x, [key]: { ...x[key], name: e.target.value, id: x[key]?.id ?? slug(e.target.value) } }))} />}
                  <span className="mono faint">{n.address}</span>
                  {own ? <span className="mono ellipsis">{n.networkRoot}</span> : <input className="input sm mono" value={n.networkRoot} onChange={(e) => setEdits((x) => ({ ...x, [key]: { ...x[key], networkRoot: e.target.value } }))} />}
                </div>
              );
            })}
          </div>
          {problems.map((p) => (
            <div key={p} className="alert error">
              {p}
            </div>
          ))}
          <p className="faint" style={{ margin: 0, fontSize: 12 }}>
            {t('Kayıt yeri: {path}', { path: boot.configPath })}
          </p>
        </div>
      )}
    </Modal>
  );
}
