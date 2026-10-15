import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, ListChecks, Bookmark, Server, Trash2, Wifi, WifiOff, CheckCheck, RotateCcw } from 'lucide-react';
import type { NodeConfig, Profile } from '@shared/types';
import { useApp } from '../store/app';
import { Button, Checkbox, Empty, MenuButton, Modal, SearchInput, Field, type MenuEntry } from './ui';
import { api } from '../lib/api';
import { cls } from '../lib/format';
import { tx } from '../lib/i18n';
import { t } from '@shared/i18n';

interface Group {
  key: string;
  name: string;
  nodes: NodeConfig[];
}

export function useTargetNodes(): NodeConfig[] {
  const cfg = useApp((s) => s.boot!.config);
  const localId = useApp((s) => s.boot!.identity.node?.id);
  return useMemo(() => cfg.nodes.filter((n) => n.enabled && n.id !== localId), [cfg, localId]);
}

function groupNodes(nodes: NodeConfig[]): Group[] {
  const map = new Map<string, Group>();
  for (const n of nodes) {
    const key = n.group ? n.group.toLowerCase() : '';
    if (!map.has(key)) map.set(key, { key, name: n.group ?? t('Gruba ait olmayanlar'), nodes: [] });
    map.get(key)!.nodes.push(n);
  }
  const list = [...map.values()];
  // ungrouped machines last
  return [...list.filter((g) => g.key), ...list.filter((g) => !g.key)];
}

export function TargetPicker({ value, onChange, maxHeight }: { value: string[]; onChange: (ids: string[]) => void; maxHeight?: number | string }) {
  const nodes = useTargetNodes();
  const probes = useApp((s) => s.probes);
  const probing = useApp((s) => s.probing);
  const probe = useApp((s) => s.probe);
  const cfg = useApp((s) => s.boot!.config);
  const saveConfig = useApp((s) => s.saveConfig);
  const toast = useApp((s) => s.toast);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const sel = new Set(value);
  const ql = q.trim().toLowerCase();
  const visible = ql ? nodes.filter((n) => `${n.name} ${n.id} ${n.group ?? ''} ${n.address}`.toLowerCase().includes(ql)) : nodes;
  const groups = groupNodes(visible);
  const visibleIds = visible.map((n) => n.id);

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(sel);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    onChange(nodes.map((n) => n.id).filter((id) => next.has(id)));
  };

  const lastFailed = async () => {
    const runs = await api.runs();
    const last = runs.find((r) => r.origin !== 'sync');
    if (!last) return toast('info', t('Henüz çalıştırma yok'));
    const failed = last.targets.filter((x) => x.status === 'failed' || x.status === 'partial').map((x) => x.key);
    if (!failed.length) return toast('ok', t('Son çalıştırmada hata yok'));
    onChange(failed.filter((id) => nodes.some((n) => n.id === id)));
    toast('info', t('{n} hatalı hedef seçildi', { n: failed.length }));
  };

  const items: MenuEntry[] = [
    { label: t('Görünenlerin tümünü seç'), icon: <CheckCheck size={15} />, onClick: () => setMany(visibleIds, true) },
    { label: t('Seçimi temizle'), icon: <RotateCcw size={15} />, onClick: () => setMany(visibleIds, false) },
    { label: t('Erişilebilirleri seç'), icon: <Wifi size={15} />, onClick: () => onChange(nodes.filter((n) => probes[n.id]?.ok && visibleIds.includes(n.id)).map((n) => n.id)) },
    { label: t('Erişilemeyenleri bırak'), icon: <WifiOff size={15} />, onClick: () => onChange(value.filter((id) => probes[id]?.ok !== false)) },
    { label: t('Seçimi ters çevir'), icon: <ListChecks size={15} />, onClick: () => onChange(nodes.filter((n) => (visibleIds.includes(n.id) ? !sel.has(n.id) : sel.has(n.id))).map((n) => n.id)) },
    { label: t('Son çalıştırmada hatalıları seç'), icon: <RefreshCw size={15} />, onClick: () => void lastFailed() },
    { sep: true },
    { section: t('Profiller') },
    ...cfg.profiles.map((p) => ({
      label: p.name,
      icon: <Bookmark size={15} />,
      hint: `${p.targetIds.length}`,
      onClick: () => {
        onChange(p.targetIds.filter((id) => nodes.some((n) => n.id === id)));
        // a profile is the targets together with the send options saved with them
        if (p.options) useApp.getState().setOptions(p.options);
      },
    })),
    { label: t('Seçimi profil olarak kaydet…'), icon: <Bookmark size={15} />, onClick: () => setSaving(true), disabled: !value.length },
  ];

  if (!nodes.length)
    return (
      <Empty icon={<Server size={22} />} title={t('Hedef yok')} action={<Button onClick={() => useApp.getState().setPage('targets')}>{t('Hedef ekle')}</Button>}>
        {t('Bu makine dışında etkin bir hedef tanımlı değil.')}
      </Empty>
    );

  return (
    <div className="target-picker">
      <div className="row" style={{ padding: '10px 12px', gap: 6 }}>
        <SearchInput value={q} onChange={setQ} placeholder={t('Makine, grup veya IP ara')} style={{ flex: 1 }} />
        <MenuButton items={items} align="end" width={270} buttonProps={{ size: 'sm' }}>
          <ListChecks size={14} /> {t('Seç')} <ChevronDown size={13} />
        </MenuButton>
        <Button size="sm" iconOnly icon={<RefreshCw size={14} className={probing ? 'spin' : undefined} />} tip={t('Erişimi sına')} onClick={() => void probe()} />
      </div>
      <div className="tp-count">
        <span>{tx('{sel} / {n} seçili', { sel: <b>{value.length}</b> }, { n: nodes.length })}</span>
        <span className="faint">
          {t('{n} erişilebilir', { n: nodes.filter((n) => probes[n.id]?.ok).length })}
        </span>
      </div>
      <div className="tp-list" style={{ maxHeight }}>
        {groups.map((g) => {
          const ids = g.nodes.map((n) => n.id);
          const on = ids.filter((id) => sel.has(id)).length;
          const isClosed = closed.has(g.key) && !ql;
          return (
            <div key={g.key} className="tp-group">
              <div className="tp-group-head">
                <Checkbox checked={on === ids.length} mixed={on > 0 && on < ids.length} onChange={(v) => setMany(ids, v)} />
                <button
                  className="tp-group-name"
                  onClick={() =>
                    setClosed((c) => {
                      const n = new Set(c);
                      n.has(g.key) ? n.delete(g.key) : n.add(g.key);
                      return n;
                    })
                  }
                >
                  {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span>{g.name}</span>
                </button>
                <span className="faint tabular" style={{ fontSize: 12 }}>
                  {on}/{ids.length}
                </span>
              </div>
              {!isClosed &&
                g.nodes.map((n) => {
                  const p = probes[n.id];
                  return (
                    <div key={n.id} className={cls('tp-node', sel.has(n.id) && 'on')} onClick={() => setMany([n.id], !sel.has(n.id))}>
                      <Checkbox checked={sel.has(n.id)} onChange={(v) => setMany([n.id], v)} />
                      <span className={cls('dot', p ? (p.ok ? 'ok' : 'bad') : probing ? 'pending' : '')} data-tip={p ? p.detail : t('Henüz yoklanmadı')} />
                      <div className="grow">
                        <div className="ellipsis" style={{ fontWeight: 540 }}>
                          {n.name}
                        </div>
                        <div className="faint mono ellipsis" style={{ fontSize: 11 }}>
                          {n.transport === 'sftp' ? `sftp ${n.sftp?.host || n.address}` : n.transport === 'path' ? n.path : `${n.address} • ${n.networkRoot}`}
                        </div>
                      </div>
                      {p?.ok && p.latencyMs != null && <span className="faint tabular" style={{ fontSize: 11 }}>{p.latencyMs} ms</span>}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {!groups.length && <div className="faint" style={{ padding: 16, textAlign: 'center' }}>{t('Eşleşen makine yok')}</div>}
      </div>
      {saving && (
        <SaveProfileModal
          profiles={cfg.profiles}
          onClose={() => setSaving(false)}
          onSave={async (name) => {
            const id = name.replace(/[^\w.-]/g, '_');
            const { dryRun: _dryRun, ...options } = useApp.getState().options;
            const profiles: Profile[] = [...cfg.profiles.filter((p) => p.id !== id), { id, name, targetIds: value, options }];
            if (await saveConfig({ ...cfg, profiles })) toast('ok', t('Profil kaydedildi'), t('{name}: {n} hedef', { name, n: value.length }));
            setSaving(false);
          }}
          onDelete={async (id) => {
            await saveConfig({ ...cfg, profiles: cfg.profiles.filter((p) => p.id !== id) });
          }}
        />
      )}
    </div>
  );
}

function SaveProfileModal({ profiles, onClose, onSave, onDelete }: { profiles: Profile[]; onClose: () => void; onSave: (name: string) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Modal
      title={t('Hedef profili')}
      icon={<div className="icon-tile accent"><Bookmark size={16} /></div>}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            {t('Kaydet')}
          </Button>
        </>
      }
    >
      <Field label={t('Profil adı')} help={t('Aynı adla kaydetmek mevcut profilin hedeflerini günceller.')}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ör. Unit1 IG'ler")} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
      </Field>
      {profiles.length > 0 && (
        <>
          <div className="divider" />
          <div className="section-title">{t('Kayıtlı profiller')}</div>
          {profiles.map((p) => (
            <div key={p.id} className="row" style={{ padding: '5px 0' }}>
              <Bookmark size={14} className="faint" />
              <button className="link-btn" onClick={() => setName(p.name)}>
                {p.name}
              </button>
              <span className="faint">{t('{n} hedef', { n: p.targetIds.length })}</span>
              <span className="spacer" />
              <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} tip={t('Sil')} onClick={() => onDelete(p.id)} />
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

/** A compact button that shows the selection and opens the picker in a popover. */
export function TargetSummary({ value }: { value: string[] }) {
  const nodes = useTargetNodes();
  const names = nodes.filter((n) => value.includes(n.id)).map((n) => n.name);
  if (!value.length) return <span className="faint">{t('Hedef seçilmedi')}</span>;
  return (
    <span className="ellipsis">
      {tx('{n} hedef: {names}', { n: <b>{value.length}</b>, names: <span className="muted">{names.slice(0, 3).join(', ')}{names.length > 3 ? ` +${names.length - 3}` : ''}</span> }, { count: value.length })}
    </span>
  );
}
