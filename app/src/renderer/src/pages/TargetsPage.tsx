import { useEffect, useMemo, useState } from 'react';
import { Server, Plus, RefreshCw, Pencil, Laptop, FileJson, FolderOpen, Trash2, Wifi, WifiOff, KeyRound, HardDrive, Network, Copy as CopyIcon, Pin, ExternalLink, Share2, Gauge } from 'lucide-react';
import type { NodeConfig, RunSummary, SpeedTestResult, TransportKind } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button, Empty, Field, Modal, SearchInput, Segmented, Switch, TagInput, ToggleRow } from '../components/ui';
import { ago, bytes, cls, duration } from '../lib/format';
import { t } from '@shared/i18n';
import { ConfigEditor } from '../components/ConfigEditor';
import { Inventory } from '../components/Inventory';

const ID_RE = /^[A-Za-z0-9._-]+$/;

export function rootPreview(n: Partial<NodeConfig>, platform: string): string {
  if (n.transport === 'sftp') return `sftp://${n.sftp?.username || t('kullanıcı')}@${n.sftp?.host || n.address || t('adres')}${n.sftp?.root?.startsWith('/') ? '' : '/'}${n.sftp?.root ?? ''}`;
  if (n.transport === 'path' || n.path) return n.path || '';
  const nr = (n.networkRoot || '').replace(/[\\/]+/g, platform === 'win32' ? '\\' : '/');
  return platform === 'win32' ? `\\\\${n.address || t('adres')}\\${nr}` : `/mnt/${n.address || t('adres')}/${nr}`;
}

export function TargetsPage() {
  const boot = useApp((s) => s.boot!);
  const [editingJson, setEditingJson] = useState(false);
  const cfg = boot.config;
  const probes = useApp((s) => s.probes);
  const relayState = useApp((s) => s.relayState);
  // a few MB written and read back on request: the pace of the link, as a number
  const [speed, setSpeed] = useState<Record<string, SpeedTestResult | 'running' | undefined>>({});
  const testSpeed = async (n: NodeConfig) => {
    setSpeed((s) => ({ ...s, [n.id]: 'running' }));
    try {
      const r = await api.speedTest(n.id);
      setSpeed((s) => ({ ...s, [n.id]: r }));
    } catch (e) {
      setSpeed((s) => ({ ...s, [n.id]: undefined }));
      toast('error', t('Hız sınanamadı'), (e as Error).message);
    }
  };
  // what the last send to each machine looked like: pace and time, from the history
  const liveRuns = useApp((s) => s.runs);
  const doneCount = Object.values(liveRuns).filter((r) => r.done).length;
  const [history, setHistory] = useState<RunSummary[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .runs()
      .then((r) => alive && setHistory(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doneCount]);
  const lastSend = useMemo(() => {
    const out = new Map<string, { at: number; ms: number; bytes: number; status: string; via?: string }>();
    for (const r of history) {
      for (const tg of r.targets) {
        if (out.has(tg.key) || !tg.startedAt || !tg.finishedAt || tg.status === 'queued') continue;
        out.set(tg.key, { at: tg.finishedAt, ms: tg.finishedAt - tg.startedAt, bytes: tg.bytesDone, status: tg.status, via: tg.via });
      }
    }
    return out;
  }, [history]);
  const probing = useApp((s) => s.probing);
  const probe = useApp((s) => s.probe);
  const saveConfig = useApp((s) => s.saveConfig);
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const [editing, setEditing] = useState<NodeConfig | 'new' | null>(null);
  const [q, setQ] = useState('');
  const id = boot.identity;

  const ql = q.trim().toLowerCase();
  const nodes = cfg.nodes.filter((n) => !ql || `${n.name} ${n.id} ${n.group ?? ''} ${n.address}`.toLowerCase().includes(ql));
  const groups = new Map<string, NodeConfig[]>();
  for (const n of nodes) {
    const g = n.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])));

  const toggleEnabled = async (n: NodeConfig, on: boolean) => {
    await saveConfig({ ...cfg, nodes: cfg.nodes.map((x) => (x.id === n.id ? { ...x, enabled: on } : x)) });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Hedefler')}</h1>
          <div className="sub">{t('Aynı yapılandırma bütün makinelerde kullanılır; uygulama çalıştığı makineyi kendisi tanır.')}</div>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder={t('Ara')} style={{ width: 200 }} />
        <Button icon={<RefreshCw size={14} className={probing ? 'spin' : undefined} />} onClick={() => void probe()}>
          {t('Erişimi sına')}
        </Button>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')} disabled={!boot.configWritable}>
          {t('Hedef ekle')}
        </Button>
      </div>
      <div className="page-body">
        <div className="targets-top">
          <div className="card identity-card">
            <div className="card-head">
              <div className={cls('icon-tile', id.node && 'accent')}>
                <Laptop size={15} />
              </div>
              <h2>{t('Bu makine')}</h2>
              <span className="spacer" />
              <span className="row" style={{ gap: 6 }}>
                <Pin size={13} className="faint" />
                <select className="select" style={{ height: 27, width: 200, fontSize: 12.5 }} value={boot.settings.localNodeId ?? ''} onChange={(e) => void saveSettings({ localNodeId: e.target.value || undefined })}>
                  <option value="">{t('Otomatik tanı')}</option>
                  {cfg.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.id})
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="card-body">
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div className="grow">
                  <div style={{ fontSize: 16, fontWeight: 650 }}>{id.node ? id.node.name : t('Tanımlanamadı')}</div>
                  <div className="muted" style={{ marginTop: 2 }}>
                    {id.reason}
                  </div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                    {id.hostname} • {id.addresses.filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && a !== '127.0.0.1').join(', ')}
                  </div>
                </div>
                {id.node && <span className="badge blue lg">{id.node.id}</span>}
              </div>
              {id.node && (
                <>
                  {relayState?.active && (
                    <div className="row" style={{ gap: 6, marginTop: 10, fontSize: 12.5 }} data-tip={relayState.dir}>
                      <Share2 size={13} color="var(--accent)" />
                      <span>
                        {t('Bu makine {group} grubunun rölesi', { group: relayState.group ?? '-' })} •{' '}
                        {relayState.jobs ? t('{n} iş alındı, son {ago}{ok}', { n: relayState.jobs, ago: ago(relayState.lastJobAt), ok: relayState.lastOk === false ? ` (${t('hatalı')})` : '' }) : t('henüz iş gelmedi')}
                      </span>
                    </div>
                  )}
                  <div className="section-title" style={{ marginTop: 14 }}>
                    {t('Yerel kökler')}
                  </div>
                  <div className="col" style={{ gap: 4 }}>
                    {id.node.localRoots.map((r) => (
                      <div key={r} className="row mono selectable" style={{ fontSize: 12 }}>
                        <HardDrive size={13} className="faint" /> {r}
                      </div>
                    ))}
                    {!id.node.localRoots.length && <span className="faint">{t('Yerel kök tanımlı değil: her şey tam yoluyla gönderilir.')}</span>}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <div className="icon-tile">
                <FileJson size={15} />
              </div>
              <h2>{t('Yapılandırma')}</h2>
              <span className="spacer" />
              {!boot.configWritable && <span className="badge amber">{t('salt okunur')}</span>}
            </div>
            <div className="card-body col" style={{ gap: 10 }}>
              <div className="mono selectable" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {boot.configPath}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                {t('{n} makine', { n: cfg.nodes.length })} • {t('{n} grup', { n: new Set(cfg.nodes.map((n) => n.group).filter(Boolean)).size })} • {t('{n} profil', { n: cfg.profiles.length })} •{' '}
                {t('{n} senkron işi', { n: cfg.syncJobs.length })}
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => void api.openPath(boot.configPath).catch((e) => toast('error', t('Açılamadı'), (e as Error).message))}>
                  {t('Düzenleyicide aç')}
                </Button>
                <Button size="sm" icon={<FileJson size={13} />} onClick={() => setEditingJson(true)}>
                  {t('JSON olarak düzenle…')}
                </Button>
                {editingJson && <ConfigEditor onClose={() => setEditingJson(false)} />}
                <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => useApp.getState().setPage('settings')}>
                  {t('Dosyayı değiştir…')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {cfg.nodes.length > 0 && <Inventory />}
        {!cfg.nodes.length ? (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty icon={<Server size={22} />} title={t('Henüz hedef yok')} action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>{t('İlk hedefi ekle')}</Button>}>
              {t('Bütün makineleri ekleyin. Her makinenin yerel kökü (kaynak olduğunda) ve paylaşım kökü (hedef olduğunda) ayrı tanımlanır.')}
            </Empty>
          </div>
        ) : (
          ordered.map(([g, list]) => (
            <div key={g || '_'} style={{ marginTop: 20 }}>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className={g ? 'section-title keep-case' : 'section-title'} style={{ margin: 0 }}>
                  {g || t('Gruba ait olmayanlar')}
                </span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {t('{n} makine', { n: list.length })} • {t('{n} erişilebilir', { n: list.filter((n) => probes[n.id]?.ok).length })}
                </span>
              </div>
              <div className="target-grid">
                {list.map((n) => {
                  const p = probes[n.id];
                  const isLocal = n.id === id.node?.id;
                  return (
                    <div key={n.id} className={cls('card target-card', !n.enabled && 'disabled', isLocal && 'local')}>
                      <div className="row" style={{ gap: 10 }}>
                        <span className={cls('dot', isLocal ? 'ok' : p ? (p.ok ? 'ok' : 'bad') : probing ? 'pending' : '')} />
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="ellipsis" style={{ fontWeight: 620 }}>
                            {n.name}
                          </div>
                          <div className="faint mono ellipsis" style={{ fontSize: 11.5 }}>
                            {n.id}
                          </div>
                        </div>
                        {isLocal ? <span className="badge blue">{t('bu makine')}</span> : <Switch on={n.enabled} onChange={(v) => void toggleEnabled(n, v)} disabled={!boot.configWritable} />}
                      </div>
                      <div className="target-root mono selectable" title={rootPreview(n, boot.platform)}>
                        {n.transport === 'sftp' ? <KeyRound size={12} /> : n.transport === 'path' ? <HardDrive size={12} /> : <Network size={12} />}
                        <span className="ellipsis">{rootPreview(n, boot.platform)}</span>
                      </div>
                      {!isLocal && lastSend.get(n.id) && (() => {
                        const l = lastSend.get(n.id)!;
                        const pace = l.bytes > 0 && l.ms >= 500 ? t('{speed}/sn', { speed: bytes((l.bytes / l.ms) * 1000) }) : null;
                        return (
                          <div className="row faint" style={{ fontSize: 11.5, gap: 5 }} data-tip={t('Bu makineye son gönderim')}>
                            <Gauge size={12} color={l.status === 'ok' ? 'var(--green)' : l.status === 'cancelled' ? undefined : 'var(--red)'} />
                            <span className="ellipsis">
                              {t('son gönderim')}: {pace ? `${pace} • ` : ''}
                              {duration(l.ms)} • {ago(l.at)}
                              {l.via ? ` • ${t('{relay} üzerinden', { relay: l.via })}` : ''}
                            </span>
                          </div>
                        );
                      })()}
                      <div className="row" style={{ gap: 6 }}>
                        {!isLocal &&
                          (p ? (
                            <span className={cls('row faint')} style={{ fontSize: 11.5, gap: 4 }} data-tip={p.detail}>
                              {p.ok ? <Wifi size={12} color="var(--green)" /> : <WifiOff size={12} color="var(--red)" />}
                              {p.ok ? `${p.latencyMs ?? '?'} ms` : t('erişilemedi')} • {ago(p.checkedAt)}
                            </span>
                          ) : (
                            <span className="faint" style={{ fontSize: 11.5 }}>
                              {t('yoklanmadı')}
                            </span>
                          ))}
                        {!isLocal && speed[n.id] && speed[n.id] !== 'running' && (
                          <span className="faint tabular" style={{ fontSize: 11.5 }} data-tip={t('Yazma / okuma hızı ve gecikme (3 MB ile ölçüldü)')}>
                            ↑{(speed[n.id] as SpeedTestResult).writeMBps.toFixed(1)} ↓{(speed[n.id] as SpeedTestResult).readMBps.toFixed(1)} MB/sn • {(speed[n.id] as SpeedTestResult).latencyMs} ms
                          </span>
                        )}
                        <span className="spacer" />
                        {!isLocal && (
                          <Button size="sm" variant="ghost" iconOnly icon={<Gauge size={13} />} tip={t('Hız sına: 3 MB yazar, geri okur, siler')} loading={speed[n.id] === 'running'} disabled={!p?.ok} onClick={() => void testSpeed(n)} />
                        )}
                        {n.relay && (
                          <span
                            className={cls('badge', p?.relayAlive === false ? 'red' : 'violet')}
                            data-tip={p?.relayAlive === false ? t('Röle olarak işaretli ama orada SamSync çalışmıyor; gönderimler doğrudan yapılır') : t('Grubundaki diğer makinelere dosyaları bu makine iletir')}
                          >
                            {p?.relayAlive === false ? t('röle kapalı') : p?.relayAlive ? t('röle açık') : t('röle')}
                          </span>
                        )}
                        <span className="badge">{t('{n} kök', { n: n.localRoots.length })}</span>
                        <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={13} />} tip={t('Düzenle')} onClick={() => setEditing(n)} disabled={!boot.configWritable} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
      {editing && <NodeEditor node={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NodeEditor({ node, onClose }: { node: NodeConfig | null; onClose: () => void }) {
  const boot = useApp((s) => s.boot!);
  const cfg = boot.config;
  const saveConfig = useApp((s) => s.saveConfig);
  const toast = useApp((s) => s.toast);
  const [n, setN] = useState<NodeConfig>(
    node ?? { id: '', name: '', address: '', localRoots: [], networkRoot: 'Share\\Release', enabled: true, transport: 'smb' },
  );
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<NodeConfig>) => setN((x) => ({ ...x, ...p }));
  const transport: TransportKind = n.transport ?? 'smb';
  const groups = [...new Set(cfg.nodes.map((x) => x.group).filter(Boolean))] as string[];

  const errors: Record<string, string> = {};
  if (!n.id) errors.id = t('Gerekli');
  else if (!ID_RE.test(n.id)) errors.id = t('Yalnızca harf, rakam, nokta, alt çizgi, tire');
  else if (cfg.nodes.some((x) => x !== node && x.id.toLowerCase() === n.id.toLowerCase())) errors.id = t('Bu kimlik kullanılıyor');
  if (n.group && !ID_RE.test(n.group)) errors.group = t('Yalnızca harf, rakam, nokta, alt çizgi, tire');
  if (transport === 'smb' && !n.address) errors.address = t('Gerekli');
  if (transport === 'smb' && !n.networkRoot) errors.networkRoot = t('Gerekli');
  if (transport === 'path' && !n.path) errors.path = t('Gerekli');
  if (transport === 'sftp' && !n.sftp?.username) errors.sftpUser = t('Gerekli');
  const valid = Object.keys(errors).length === 0;

  const save = async () => {
    setSaving(true);
    const clean: NodeConfig = { ...n, name: n.name || n.id };
    if (transport !== 'sftp') delete clean.sftp;
    if (transport !== 'path' && !clean.path) delete clean.path;
    if (!clean.group) delete clean.group;
    const nodes = node ? cfg.nodes.map((x) => (x === node ? clean : x)) : [...cfg.nodes, clean];
    const ok = await saveConfig({ ...cfg, nodes });
    if (ok && transport === 'sftp' && password) {
      const stored = await api.setSecret(clean.id, password);
      if (!stored) toast('warn', t('Parola saklanamadı'), t('Bu sistemde şifreli saklama kullanılamıyor.'));
    }
    setSaving(false);
    if (ok) {
      toast('ok', node ? t('Hedef güncellendi') : t('Hedef eklendi'), clean.name);
      onClose();
      void useApp.getState().probe([clean.id]);
    }
  };

  const remove = async () => {
    if (!node || !confirm(t('{name} silinsin mi?', { name: node.name }))) return;
    if (await saveConfig({ ...cfg, nodes: cfg.nodes.filter((x) => x !== node), profiles: cfg.profiles.map((p) => ({ ...p, targetIds: p.targetIds.filter((tid) => tid !== node.id) })) })) onClose();
  };

  return (
    <Modal
      size="medium"
      title={node ? t('{name} düzenle', { name: node.name }) : t('Yeni hedef')}
      icon={
        <div className="icon-tile accent">
          <Server size={16} />
        </div>
      }
      onClose={onClose}
      footer={
        <>
          {node && (
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => void remove()}>
              {t('Sil')}
            </Button>
          )}
          {node && (
            <Button
              variant="ghost"
              icon={<CopyIcon size={14} />}
              onClick={() => {
                setN({ ...n, id: `${n.id}-kopya`, name: t('{name} (kopya)', { name: n.name }) });
              }}
            >
              {t('Çoğalt')}
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" disabled={!valid} loading={saving} onClick={() => void save()}>
            {t('Kaydet')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('Görünen ad')}>
          <input className="input" value={n.name} onChange={(e) => set({ name: e.target.value })} placeholder="PC-1 - 10.10.1.11" autoFocus />
        </Field>
        <Field label={t('Kimlik (id)')} error={n.id ? errors.id : undefined} help={t('Komutlar ve profiller bu anahtarı kullanır')}>
          <input className="input mono" value={n.id} onChange={(e) => set({ id: e.target.value.trim() })} placeholder="LabA-PC1" />
        </Field>
        <Field label={t('Grup')} error={errors.group} help={t('Aynı gruptaki makineler birlikte seçilebilir')}>
          <input className="input" list="samsync-groups" value={n.group ?? ''} onChange={(e) => set({ group: e.target.value.trim() || undefined })} placeholder="Lab-A" />
          <datalist id="samsync-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field label={t('Adres')} error={n.address ? undefined : errors.address} help={t('IPv4 ya da bilgisayar adı')}>
          <input className="input mono" value={n.address} onChange={(e) => set({ address: e.target.value.trim() })} placeholder="10.10.1.11" />
        </Field>
      </div>
      {transport !== 'sftp' && (
        <ToggleRow
          icon={<Share2 size={16} className="faint" />}
          title={t('Röle: grubundaki diğer makinelere bu makine iletir')}
          desc={t('Bu makineyle birlikte seçilen grup makinelerine dosyalar önce buraya, buradaki SamSync tarafından oradan gider. Bu makinede SamSync çalışmalı; ilk yerel kökü paylaşımın klasörü olmalı.')}
          on={!!n.relay}
          onChange={(v) => set({ relay: v || undefined })}
          disabled={!n.group}
        />
      )}

      <div className="divider" />
      <Field label={t('Bağlantı türü')}>
        <Segmented
          value={transport}
          onChange={(kind) => set({ transport: kind, sftp: kind === 'sftp' ? n.sftp ?? { username: '', root: '/' } : n.sftp })}
          options={[
            { value: 'smb', label: t('Windows paylaşımı (SMB)'), icon: <Network size={14} /> },
            { value: 'path', label: t('Klasör / bağlı sürücü'), icon: <HardDrive size={14} /> },
            { value: 'sftp', label: 'SFTP (SSH)', icon: <KeyRound size={14} /> },
          ]}
        />
      </Field>
      <div className="form-grid" style={{ marginTop: 12 }}>
        {transport === 'smb' && (
          <>
            <Field label={t('Paylaşım kökü (networkRoot)')} error={errors.networkRoot} help={t('Paylaşım adıyla başlar: Share\\Release → \\\\adres\\Share\\Release')}>
              <input className="input mono" value={n.networkRoot} onChange={(e) => set({ networkRoot: e.target.value })} placeholder="Share\Release" />
            </Field>
            <Field label={t('Yol geçersiz kılma (isteğe bağlı)')} help={t('macOS/Linux’ta bağlama noktası, örn. /Volumes/Share/Release')}>
              <input className="input mono" value={n.path ?? ''} onChange={(e) => set({ path: e.target.value || undefined })} placeholder={t('(otomatik)')} />
            </Field>
          </>
        )}
        {transport === 'path' && (
          <Field label={t('Hedef klasör')} error={errors.path} style={{ gridColumn: '1 / -1' }}>
            <div className="row">
              <input className="input mono" value={n.path ?? ''} onChange={(e) => set({ path: e.target.value })} placeholder={t('D:\\Yedek\\Sim  ya da  \\\\sunucu\\paylaşım\\klasör')} />
              <Button
                iconOnly
                icon={<FolderOpen size={14} />}
                disabled={!boot.isElectron}
                onClick={async () => {
                  const [p] = await api.pick({ folders: true });
                  if (p) set({ path: p });
                }}
              />
            </div>
          </Field>
        )}
        {transport === 'sftp' && (
          <>
            <Field label={t('Kullanıcı')} error={errors.sftpUser}>
              <input className="input mono" value={n.sftp?.username ?? ''} onChange={(e) => set({ sftp: { ...(n.sftp ?? { root: '/' }), username: e.target.value } as NodeConfig['sftp'] })} placeholder="sim" />
            </Field>
            <Field label={t('Uzak kök')}>
              <input className="input mono" value={n.sftp?.root ?? ''} onChange={(e) => set({ sftp: { ...(n.sftp ?? { username: '' }), root: e.target.value } as NodeConfig['sftp'] })} placeholder="/srv/release" />
            </Field>
            <Field label={t('Port')}>
              <input className="input" type="number" value={n.sftp?.port ?? 22} onChange={(e) => set({ sftp: { ...n.sftp!, port: Number(e.target.value) || 22 } })} />
            </Field>
            <Field label={t('Özel anahtar (isteğe bağlı)')}>
              <input className="input mono" value={n.sftp?.privateKeyPath ?? ''} onChange={(e) => set({ sftp: { ...n.sftp!, privateKeyPath: e.target.value || undefined } })} placeholder="~/.ssh/id_ed25519" />
            </Field>
            <Field label={t('Parola (isteğe bağlı)')} help={t('Yalnızca bu bilgisayarda, işletim sisteminin şifreli deposunda saklanır')}>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" autoComplete="new-password" />
            </Field>
            <Field label={t('SSH agent')}>
              <label className="check-label" style={{ height: 32 }}>
                <Switch on={!!n.sftp?.useAgent} onChange={(v) => set({ sftp: { ...n.sftp!, useAgent: v } })} /> {t('Agent’taki anahtarları kullan')}
              </label>
            </Field>
          </>
        )}
      </div>
      <div className="root-preview">
        <span className="faint">{t('Hedef kökü:')}</span> <span className="mono selectable">{rootPreview(n, boot.platform)}</span>
      </div>

      <div className="divider" />
      <Field label={t('Yerel kökler')} help={t('Bu makine kaynak olduğunda göreli yol bu köklerden hesaplanır; en uzun eşleşen kök kullanılır')}>
        <RootsEditor value={n.localRoots} onChange={(localRoots) => set({ localRoots })} />
      </Field>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label={t('Bilgisayar adları (localNames)')} help={t('IP’si değişken makinelerin tanınması için')}>
          <TagInput value={n.localNames ?? []} onChange={(v) => set({ localNames: v.length ? v : undefined })} placeholder="IG-14" />
        </Field>
        <Field label={t('Notlar')}>
          <input className="input" value={n.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
        </Field>
      </div>
      <div className="toggle-row" style={{ marginTop: 6 }} onClick={() => set({ enabled: !n.enabled })}>
        <div className="grow">
          <div className="t-title">{t('Etkin')}</div>
          <div className="t-desc">{t('Kapalı hedefler listelerde ve “tümü” gönderimlerinde yer almaz')}</div>
        </div>
        <Switch on={n.enabled} onChange={(v) => set({ enabled: v })} />
      </div>
    </Modal>
  );
}

function RootsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const isElectron = useApp((s) => s.boot!.isElectron);
  const [text, setText] = useState('');
  return (
    <div className="col" style={{ gap: 6 }}>
      {value.map((r, i) => (
        <div key={i} className="row">
          <HardDrive size={14} className="faint" />
          <input className="input sm mono grow" value={r} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={13} />} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="row">
        <input
          className="input sm mono grow"
          value={text}
          placeholder="D:\Release"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              onChange([...value, text.trim()]);
              setText('');
            }
          }}
        />
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={async () => {
            if (text.trim()) {
              onChange([...value, text.trim()]);
              setText('');
              return;
            }
            if (!isElectron) return;
            const p = await api.pick({ folders: true, multi: true });
            if (p.length) onChange([...value, ...p]);
          }}
        >
          {text.trim() ? t('Ekle') : t('Klasör seç')}
        </Button>
      </div>
    </div>
  );
}
