import { useEffect, useMemo, useState } from 'react';
import { Server, Plus, RefreshCw, Pencil, Laptop, FileJson, FolderOpen, Trash2, Wifi, WifiOff, KeyRound, HardDrive, Network, Copy as CopyIcon, Pin, ExternalLink, Share2, Gauge, Radar, Clock, X, Tag, ArrowUpCircle, AlertTriangle, Power, RotateCw, PowerOff, Ban, Waypoints, History as HistoryIcon, ListChecks } from 'lucide-react';
import type { AgentUpdateResult, NodeConfig, ProbeResult, RunSummary, SpeedTestResult, TransportKind } from '@shared/types';
import { useApp } from '../store/app';
import { api, newTaskId } from '../lib/api';
import { compareVersions } from '@shared/version';
import { driftCounts } from '@shared/drift';
import { AgentChecks } from '../components/AgentSettings';
import { BusyBadge, busyOf, busyUnknown, dotClass } from '../components/BusyBadge';
import { DistributeDialog } from '../components/DistributeDialog';
import { MachineTimeline } from '../components/MachineTimeline';
import { BulkBar } from '../components/BulkBar';
import { MachinesCsvButtons } from '../components/MachinesCsv';
import { Button, Checkbox, Empty, Field, MenuButton, Modal, SearchInput, Segmented, Switch, TagInput, ToggleRow } from '../components/ui';
import { ago, bytes, cls, duration } from '../lib/format';
import { t } from '@shared/i18n';
import { tx } from '../lib/i18n';
import { ConfigEditor } from '../components/ConfigEditor';
import { Inventory } from '../components/Inventory';
import { MachineName } from '../components/MachineName';
import { PathLink } from '../components/PathLink';
import { DiscoverDialog, nodeFromHost } from '../components/DiscoverDialog';
import { LatencySpark } from '../components/charts';
import { lowOnSpace, machineLabel, normalizeMac } from '@shared/machine';

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
  const latency = useApp((s) => s.latency);
  const relayState = useApp((s) => s.relayState);
  const pendingSends = useApp((s) => s.pendingSends);
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
    const out = new Map<string, { at: number; ms: number; bytes: number; status: string; via?: string; runId: string }>();
    for (const r of history) {
      for (const tg of r.targets) {
        if (out.has(tg.key) || !tg.startedAt || !tg.finishedAt || tg.status === 'queued') continue;
        out.set(tg.key, { at: tg.finishedAt, ms: tg.finishedAt - tg.startedAt, bytes: tg.bytesDone, status: tg.status, via: tg.via, runId: r.id });
      }
    }
    return out;
  }, [history]);
  // a send marked as a release point shows its name on the machine's last-send line
  const releaseTags = useApp((s) => s.boot?.settings.releaseTags);
  const probing = useApp((s) => s.probing);
  const probe = useApp((s) => s.probe);
  const saveConfig = useApp((s) => s.saveConfig);
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const [editing, setEditing] = useState<NodeConfig | 'new' | { prefill: Partial<NodeConfig> } | null>(null);
  const [discover, setDiscover] = useState(false);
  const [q, setQ] = useState('');
  const id = boot.identity;

  const ql = q.trim().toLowerCase();
  const nodes = cfg.nodes.filter((n) => !ql || `${n.name} ${n.id} ${n.group ?? ''} ${n.address} ${(n.tags ?? []).map((x) => '#' + x).join(' ')}`.toLowerCase().includes(ql));
  const groups = new Map<string, NodeConfig[]>();
  for (const n of nodes) {
    const g = n.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])));

  const toggleEnabled = async (n: NodeConfig, on: boolean) => {
    await saveConfig({ ...cfg, nodes: cfg.nodes.map((x) => (x.id === n.id ? { ...x, enabled: on } : x)) });
  };

  // SamSync on other machines that is older than this one and installs updates sent to it
  const outdated = cfg.nodes.filter((n) => {
    const a = probes[n.id]?.agent;
    return n.enabled && n.id !== id.node?.id && a?.alive && a.updates && !!a.version && compareVersions(a.version, boot.appVersion) < 0;
  });
  // machines that are off but can be woken up: their MAC address is known
  const wakeable = (n: NodeConfig) => n.enabled && n.id !== id.node?.id && probes[n.id] && !probes[n.id].ok && !!probes[n.id].macs?.length;
  const [waking, setWaking] = useState<string[]>([]);
  const wakeNodes = async (ids: string[]) => {
    setWaking(ids);
    try {
      const r = await api.wake(ids);
      const ok = r.filter((x) => x.ok).length;
      const bad = r.filter((x) => !x.ok);
      if (ok) toast('ok', t('Uyandırma paketi gönderildi ({n} makine)', { n: ok }), t('Açılması bir iki dakika sürebilir; kart yeşile dönünce hazırdır.'));
      if (bad.length) toast('error', t('Uyandırılamadı'), bad.map((x) => `${cfg.nodes.find((n) => n.id === x.nodeId)?.name ?? x.nodeId}: ${x.error ?? ''}`).join('\n'));
      // a look again once they had time to start
      if (ok) setTimeout(() => void probe(ids), 60_000);
    } catch (e) {
      toast('error', t('Uyandırılamadı'), (e as Error).message);
    } finally {
      setWaking([]);
    }
  };
  // restart or shut down a machine whose SamSync allows it, a minute from now (or cancel that)
  const powerNode = async (n: NodeConfig, action: 'restart' | 'shutdown' | 'cancel') => {
    if (action !== 'cancel' && !confirm(action === 'restart' ? t('{name} bir dakika içinde yeniden başlatılsın mı? Ekranda uyarı çıkar.', { name: n.name }) : t('{name} bir dakika içinde kapatılsın mı? Ekranda uyarı çıkar.', { name: n.name }))) return;
    const [r] = await api.power([n.id], action);
    if (r?.ok) toast('ok', action === 'cancel' ? t('İptal edildi') : action === 'restart' ? t('{name} yeniden başlıyor', { name: n.name }) : t('{name} kapanıyor', { name: n.name }));
    else toast('error', t('Yapılamadı'), r?.error);
  };
  const [updating, setUpdating] = useState<string[]>([]);
  const [distributing, setDistributing] = useState<NodeConfig | null>(null);
  const [timeline, setTimeline] = useState<NodeConfig | null>(null);
  // Select: several machines at once for the actions of the bar
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pick = (ids: string[], on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      for (const x of ids) on ? next.add(x) : next.delete(x);
      return next;
    });
  const updateAgents = async (ids: string[]) => {
    if (!confirm(t('{n} makineye SamSync {version} kurulumu bırakılsın mı? Makineler ellerindeki iş bitince kurar ve yeniden açılır.', { n: ids.length, version: boot.appVersion }))) return;
    const nameOf = (nid: string) => cfg.nodes.find((n) => n.id === nid)?.name ?? nid;
    setUpdating(ids);
    try {
      let r: AgentUpdateResult[];
      try {
        r = await api.updateAgents(ids, newTaskId());
      } catch (e) {
        // no Setup of this version here (no internet, a development copy): one picked by hand will do
        toast('warn', t('Kurulum dosyası bulunamadı'), (e as Error).message);
        const picked = boot.remote ? [] : await api.pick({ title: t('SamSync kurulum dosyasını seçin'), filters: [{ name: 'SamSync Setup', extensions: ['exe'] }] });
        if (!picked.length) return;
        r = await api.updateAgents(ids, newTaskId(), picked[0]);
      }
      const ok = r.filter((x) => x.ok);
      const bad = r.filter((x) => !x.ok);
      if (ok.length) toast('ok', t('Kurulum {n} makineye bırakıldı', { n: ok.length }), t('Makineler boşta olunca kurup yeniden açılır; kartlar birkaç dakika içinde yeni sürümü gösterir.'));
      if (bad.length) toast('error', t('{n} makineye bırakılamadı', { n: bad.length }), bad.map((x) => `${nameOf(x.nodeId)}: ${x.error ?? ''}`).join('\n'));
    } catch (e) {
      toast('error', t('Güncelleme gönderilemedi'), (e as Error).message);
    } finally {
      setUpdating([]);
    }
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
        <Button icon={<Radar size={15} />} onClick={() => setDiscover(true)} disabled={!boot.configWritable} tip={t('Alt ağdaki makineleri bulur; bulunanlar tek tıkla hedef olur')}>
          {t('Ağı tara')}
        </Button>
        {outdated.length > 0 && (
          <Button icon={<ArrowUpCircle size={15} />} loading={updating.length > 0} onClick={() => void updateAgents(outdated.map((n) => n.id))} tip={outdated.map((n) => `${n.name}: ${probes[n.id]?.agent?.version}`).join('\n')}>
            {t('Ajanları güncelle ({n})', { n: outdated.length })}
          </Button>
        )}
        <Button
          icon={<ListChecks size={15} />}
          variant={picking ? 'primary' : undefined}
          tip={t('Birden çok makineyi seçip birlikte uyandırın, yeniden başlatın, etiketleyin…')}
          onClick={() => {
            setPicking(!picking);
            setPicked(new Set());
          }}
        >
          {t('Seç')}
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
                <select className="select" aria-label={t('Bu makine')} style={{ height: 27, width: 200, fontSize: 12.5 }} value={boot.settings.localNodeId ?? ''} onChange={(e) => void saveSettings({ localNodeId: e.target.value || undefined })}>
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
                        {relayState.role === 'agent' ? t('Bu makine gelen paketleri kendisi uygular') : t('Bu makine {group} grubunun rölesi', { group: relayState.group ?? '-' })} •{' '}
                        {relayState.jobs ? t('{n} iş alındı, son {ago}{ok}', { n: relayState.jobs, ago: ago(relayState.lastJobAt), ok: relayState.lastOk === false ? ` (${t('hatalı')})` : '' }) : relayState.role === 'agent' ? t('henüz paket gelmedi') : t('henüz iş gelmedi')}
                      </span>
                    </div>
                  )}
                  {relayState?.active && <AgentChecks />}
                  {relayState?.active && (relayState.busyBy?.length ?? 0) > 0 && (
                    <div className="row" style={{ gap: 6, marginTop: 6, fontSize: 12 }}>
                      <span className="dot busy" />
                      <span>{t('Hedef klasörü kullanan programlar: {programs}', { programs: [...new Set(relayState.busyBy!.map((x) => x.name))].join(', ') })}</span>
                    </div>
                  )}
                  {relayState?.active && relayState.drift && relayState.drift.changed + relayState.drift.added + relayState.drift.removed > 0 && (
                    <div className="row" style={{ gap: 6, marginTop: 6, fontSize: 12 }} data-tip={relayState.drift.sample.join('\n')}>
                      <AlertTriangle size={12} color="var(--amber)" />
                      <span>{t('Son gönderimden sonra bu makinede değişenler: {counts}', { counts: driftCounts(relayState.drift) })}</span>
                    </div>
                  )}
                  {relayState?.active && relayState.lastError && (
                    <div className="row faint" style={{ gap: 6, marginTop: 6, fontSize: 12 }}>
                      <AlertTriangle size={12} color="var(--amber)" />
                      <span className="selectable">{t('Son hata ({ago}): {text}', { ago: ago(relayState.lastError.at), text: relayState.lastError.text })}</span>
                    </div>
                  )}
                  {relayState?.active && (relayState.pending?.length ?? 0) > 0 && (
                    <div className="col" style={{ gap: 4, marginTop: 8, fontSize: 12.5 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <Clock size={13} color="var(--amber)" />
                        <b>{t('Teslimat kuyruğu')}</b>
                        <span className="faint">{t('kapalı makineler açılınca alır')}</span>
                      </div>
                      {relayState.pending!.map((p) => (
                        <div key={p.targetId} className="row faint" style={{ gap: 6, paddingLeft: 19 }} data-tip={p.lastError}>
                          <span style={{ color: 'var(--text)' }}>{machineLabel(p.name).title}</span>
                          <span>
                            {t('{n} iş', { n: p.jobs })} • {t('{ago} beri', { ago: ago(p.since) })}
                            {p.lastTry ? ` • ${t('son deneme {ago}', { ago: ago(p.lastTry) })}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {pendingSends.length > 0 && (
                    <div className="col" style={{ gap: 4, marginTop: 8, fontSize: 12.5 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <Clock size={13} color="var(--amber)" />
                        <b>{t('Açılınca gönderilecek')}</b>
                        <span className="faint">{t('makine açılınca kaynakların o anki hali gider')}</span>
                      </div>
                      {pendingSends.map((p) => (
                        <div key={p.id} className="row faint" style={{ gap: 6, paddingLeft: 19 }} data-tip={p.lastError}>
                          <span style={{ color: 'var(--text)' }}>{machineLabel(p.targetName).title}</span>
                          <span className="truncate">
                            {p.label || t('Gönderim')} • {t('{ago} beri', { ago: ago(p.createdAt) })}
                            {p.lastTry ? ` • ${t('son deneme {ago}', { ago: ago(p.lastTry) })}` : ''}
                          </span>
                          <Button size="sm" variant="ghost" iconOnly icon={<X size={12} />} tip={t('Bekleyen gönderimi iptal et')} onClick={() => void api.cancelPendingSend(p.id)} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="section-title" style={{ marginTop: 14 }}>
                    {t('Yerel kökler')}
                  </div>
                  <div className="col" style={{ gap: 4 }}>
                    {id.node.localRoots.map((r) => (
                      <PathLink key={r} path={r} open={() => api.openPath(r)} icon={<HardDrive size={13} className="faint" />} style={{ fontSize: 12 }} />
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
                <MachinesCsvButtons />
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
            <Empty art="targets" title={t('Henüz hedef yok')} hint={tx('Örnek: {name}, adres {ip}, paylaşım kökü {root}', { name: <code>PC-1</code>, ip: <code>10.10.1.11</code>, root: <code>Share\Release</code> })} action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>{t('İlk hedefi ekle')}</Button>}>
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
                {picking && (
                  <Checkbox
                    checked={list.every((n) => picked.has(n.id))}
                    mixed={list.some((n) => picked.has(n.id)) && !list.every((n) => picked.has(n.id))}
                    onChange={(v) => pick(list.filter((n) => n.id !== id.node?.id).map((n) => n.id), v)}
                    label={t('{group} grubunun tamamı', { group: g || '-' })}
                  />
                )}
                {list.filter(wakeable).length > 1 && (
                  <Button size="sm" variant="ghost" icon={<Power size={12} />} loading={waking.length > 1 && list.some((n) => waking.includes(n.id))} onClick={() => void wakeNodes(list.filter(wakeable).map((n) => n.id))} tip={list.filter(wakeable).map((n) => n.name).join('\n')}>
                    {t('Kapalıları uyandır ({n})', { n: list.filter(wakeable).length })}
                  </Button>
                )}
              </div>
              <div className="target-grid">
                {list.map((n) => {
                  const p = probes[n.id];
                  const isLocal = n.id === id.node?.id;
                  return (
                    <div key={n.id} className={cls('card target-card', !n.enabled && 'disabled', isLocal && 'local', picking && picked.has(n.id) && 'picked')}>
                      <div className="row" style={{ gap: 10 }}>
                        {picking && !isLocal && <Checkbox checked={picked.has(n.id)} onChange={(v) => pick([n.id], v)} label={n.name} />}
                        <span className={cls('dot', isLocal ? 'ok' : dotClass(p, probing))} data-tip={isLocal ? undefined : busyUnknown(p)} />
                        <MachineName
                          className="grow"
                          node={n}
                          size="lg"
                          sub={machineLabel(n.name, n.address).title !== n.id ? <span className="mono">{n.id}</span> : undefined}
                          tip={[n.name, [n.address, n.id].filter(Boolean).join(' • '), n.group ? t('Grup: {group}', { group: n.group }) : ''].filter(Boolean).join('\n')}
                        />
                        {isLocal ? <span className="badge blue">{t('bu makine')}</span> : <Switch on={n.enabled} onChange={(v) => void toggleEnabled(n, v)} disabled={!boot.configWritable} label={t('{name} hedef olarak kullanılsın', { name: n.name })} />}
                      </div>
                      <PathLink
                        className="target-root"
                        path={rootPreview(n, boot.platform)}
                        open={n.transport === 'sftp' ? null : () => api.openTarget(n.id)}
                        icon={n.transport === 'sftp' ? <KeyRound size={12} /> : n.transport === 'path' ? <HardDrive size={12} /> : <Network size={12} />}
                      />
                      {!isLocal && lastSend.get(n.id) && (() => {
                        const l = lastSend.get(n.id)!;
                        const pace = l.bytes > 0 && l.ms >= 500 ? t('{speed}/sn', { speed: bytes((l.bytes / l.ms) * 1000) }) : null;
                        const release = releaseTags?.find((x) => x.runId === l.runId)?.name;
                        return (
                          <div className="row faint" style={{ fontSize: 11.5, gap: 5 }} data-tip={t('Bu makineye son gönderim')}>
                            <Gauge size={12} color={l.status === 'ok' ? 'var(--green)' : l.status === 'cancelled' ? undefined : 'var(--red)'} />
                            <span className="ellipsis">
                              {t('son gönderim')}: {pace ? `${pace} • ` : ''}
                              {duration(l.ms)} • {ago(l.at)}
                              {l.via ? ` • ${t('{relay} üzerinden', { relay: l.via })}` : ''}
                            </span>
                            {release && (
                              <span className="badge accent nowrap" data-tip={t('Bu gönderim bir sürüm noktası olarak işaretli')}>
                                <Tag size={10} /> {release}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', rowGap: 4 }}>
                        {!isLocal &&
                          (p ? (
                            <span className={cls('row faint nowrap')} style={{ fontSize: 11.5, gap: 4 }} data-tip={p.detail}>
                              {p.ok ? <Wifi size={12} color="var(--green)" /> : <WifiOff size={12} color="var(--red)" />}
                              {p.ok ? `${p.latencyMs ?? '?'} ms` : t('erişilemedi')} • {ago(p.checkedAt)}
                              {!p.ok && p.lastSeenAt ? ` • ${t('son görülme {ago}', { ago: ago(p.lastSeenAt) })}` : ''}
                            </span>
                          ) : (
                            <span className="faint" style={{ fontSize: 11.5 }}>
                              {t('yoklanmadı')}
                            </span>
                          ))}
                        {!isLocal && <BusyBadge nodeId={n.id} name={n.name} programs={busyOf(p)} held={p?.agent?.holdWhileBusy} />}
                        {!isLocal && <AgentBadges node={n} p={p} own={boot.appVersion} updating={updating.includes(n.id)} onUpdate={() => void updateAgents([n.id])} />}
                        {!isLocal && p?.ok && p.freeBytes != null && (
                          <span className="row faint nowrap" style={{ fontSize: 11.5, gap: 4, color: lowOnSpace(p.freeBytes, boot.config.copy.minFreeGB) ? 'var(--red)' : undefined }} data-tip={t('Hedef diskinde boş alan')}>
                            <HardDrive size={12} /> {t('{size} boş', { size: bytes(p.freeBytes) })}
                          </span>
                        )}
                        {!isLocal && (latency[n.id]?.length ?? 0) > 2 && (
                          <span data-tip={t('Son {n} yoklamanın gecikmesi; kırmızı çizgi yanıt alınamayan yoklama', { n: latency[n.id].length })} style={{ display: 'inline-flex' }}>
                            <LatencySpark values={latency[n.id]} />
                          </span>
                        )}
                        {!isLocal && speed[n.id] && speed[n.id] !== 'running' && (
                          <span className="faint tabular" style={{ fontSize: 11.5 }} data-tip={t('Yazma / okuma hızı ve gecikme (3 MB ile ölçüldü)')}>
                            ↑{(speed[n.id] as SpeedTestResult).writeMBps.toFixed(1)} ↓{(speed[n.id] as SpeedTestResult).readMBps.toFixed(1)} MB/sn • {(speed[n.id] as SpeedTestResult).latencyMs} ms
                          </span>
                        )}
                        <span className="spacer" />
                        {!isLocal && <Button size="sm" variant="ghost" iconOnly icon={<HistoryIcon size={13} />} tip={t('Bu makinenin geçmişi: ona giden gönderimler, sürüm noktaları, denetimler')} onClick={() => setTimeline(n)} />}
                        {!isLocal && p?.ok && p.agent?.alive && (
                          <Button size="sm" variant="ghost" iconOnly icon={<Waypoints size={13} />} tip={t('Buradan dağıt: bu makinedeki klasörleri öbür makinelere onun ağı üzerinden gönderir')} disabled={boot.readOnly} onClick={() => setDistributing(n)} />
                        )}
                        {!isLocal && p?.ok && p.agent?.alive && p.agent.power && (
                          <MenuButton
                            align="end"
                            width={240}
                            buttonProps={{ size: 'sm', variant: 'ghost', iconOnly: true, tip: t('Yeniden başlat ya da kapat') }}
                            items={[
                              { label: t('Yeniden başlat (1 dk sonra)'), icon: <RotateCw size={15} />, onClick: () => void powerNode(n, 'restart') },
                              { label: t('Kapat (1 dk sonra)'), icon: <PowerOff size={15} />, onClick: () => void powerNode(n, 'shutdown') },
                              { sep: true },
                              { label: t('Bekleyeni iptal et'), icon: <Ban size={15} />, onClick: () => void powerNode(n, 'cancel') },
                            ]}
                          >
                            <RotateCw size={13} />
                          </MenuButton>
                        )}
                        {wakeable(n) && (
                          <Button size="sm" variant="ghost" iconOnly icon={<Power size={13} />} loading={waking.includes(n.id)} tip={t('Uyandır: ağ üzerinden açma paketi gönderir ({mac})', { mac: p!.macs!.join(', ') })} onClick={() => void wakeNodes([n.id])} />
                        )}
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
                        {(n.tags ?? []).map((tag) => (
                          <span key={tag} className="badge outline" data-tip={t('Etiket: tag:{tag} bu etiketli bütün makineleri seçer', { tag })}>
                            #{tag}
                          </span>
                        ))}
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
      {distributing && <DistributeDialog source={distributing} onClose={() => setDistributing(null)} />}
      {timeline && <MachineTimeline node={timeline} onClose={() => setTimeline(null)} />}
      {picking && picked.size > 0 && <BulkBar ids={[...picked]} onClear={() => setPicked(new Set())} onUpdate={(ids) => void updateAgents(ids)} onWake={(ids) => void wakeNodes(ids)} />}
      {editing && <NodeEditor node={editing === 'new' || 'prefill' in editing ? null : editing} prefill={editing !== 'new' && 'prefill' in editing ? editing.prefill : undefined} onClose={() => setEditing(null)} />}
      {discover && (
        <DiscoverDialog
          onClose={() => setDiscover(false)}
          onPick={(h) => {
            setDiscover(false);
            const root = id.node?.localRoots[0];
            setEditing({ prefill: nodeFromHost(h, { folder: root ? root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : undefined, group: id.node?.group }) });
          }}
        />
      )}
    </div>
  );
}

/** What SamSync on the machine said in its heartbeat: its version (an old one can be updated from here), a stopped one, its last error. */
function AgentBadges({ node, p, own, updating, onUpdate }: { node: NodeConfig; p?: ProbeResult; own: string; updating: boolean; onUpdate: () => void }) {
  const a = p?.agent;
  if (!a || !p?.ok) return null;
  const old = !!a.version && compareVersions(a.version, own) < 0;
  const tip = [
    a.alive ? t('SamSync orada çalışıyor: gönderimler sıkıştırılmış paket olarak gider, makine kendisi uygular') : '',
    a.version ? `SamSync ${a.version}${old ? ` • ${t('bu makinede {v}', { v: own })}` : ''}` : '',
    [a.host, a.root].filter(Boolean).join(' • '),
    a.lastJob ? t('Son iş {ago}: {label}{ok}', { ago: ago(a.lastJob.at), label: a.lastJob.label ?? '-', ok: a.lastJob.ok ? '' : ` (${t('hatalı')})` }) : '',
    a.pending ? t('Teslimat kuyruğunda {n} makine', { n: a.pending }) : '',
    old && !a.updates ? t('O makinede Ayarlar › Ajan › Ağdan güncellemeyi kabul et açılırsa buradan güncellenebilir') : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <>
      {!a.alive ? (
        <span className="badge" data-tip={t('SamSync orada {ago} çalışıyordu ama o zamandan beri yanıt vermiyor; kapanmış ya da takılmış olabilir', { ago: ago(a.seenAt) })}>
          {t('ajan durmuş')}
        </span>
      ) : (
        (!node.relay || old) && (
          <span className={cls('badge', old ? 'amber' : 'green')} data-tip={tip}>
            {node.relay ? '' : `${t('ajan')} `}
            {a.version ?? ''}
            {old ? ` • ${t('eski')}` : ''}
          </span>
        )
      )}
      {a.alive && a.drift && a.drift.changed + a.drift.added + a.drift.removed > 0 && (
        <span className="badge amber" data-tip={[t('Son gönderimden sonra bu makinede değişenler ({ago})', { ago: ago(a.drift.at) }), ...a.drift.sample].join('\n')}>
          {t('sapma {n}', { n: a.drift.changed + a.drift.added + a.drift.removed })}
        </span>
      )}
      {a.alive && old && a.updates && <Button size="sm" variant="ghost" iconOnly icon={<ArrowUpCircle size={13} />} loading={updating} tip={t('SamSync {v} sürümüne güncelle: kurulum makineye bırakılır, iş bitince kendisi kurar', { v: own })} onClick={onUpdate} />}
      {a.lastError && Date.now() - a.lastError.at < 7 * 86400_000 && (
        <span style={{ display: 'inline-flex' }} data-tip={t('Son hata ({ago}): {text}', { ago: ago(a.lastError.at), text: a.lastError.text })}>
          <AlertTriangle size={12} color="var(--amber)" />
        </span>
      )}
    </>
  );
}

function NodeEditor({ node, prefill, onClose }: { node: NodeConfig | null; prefill?: Partial<NodeConfig>; onClose: () => void }) {
  const boot = useApp((s) => s.boot!);
  const cfg = boot.config;
  const saveConfig = useApp((s) => s.saveConfig);
  const toast = useApp((s) => s.toast);
  const [n, setN] = useState<NodeConfig>(
    node ?? { id: '', name: '', address: '', localRoots: [], networkRoot: 'Share\\Release', enabled: true, transport: 'smb', ...prefill },
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
  if (n.mac && !normalizeMac(n.mac)) errors.mac = t('Geçerli bir MAC adresi değil');
  const learnedMacs = node ? useApp.getState().probes[node.id]?.macs?.filter((m) => m !== node.mac) : undefined;
  const valid = Object.keys(errors).length === 0;

  const save = async () => {
    setSaving(true);
    const clean: NodeConfig = { ...n, name: n.name || n.id };
    if (clean.mac) clean.mac = normalizeMac(clean.mac) ?? undefined;
    if (!clean.mac) delete clean.mac;
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
          <TagInput value={n.localNames ?? []} onChange={(v) => set({ localNames: v.length ? v : undefined })} placeholder="PC-14" />
        </Field>
        <Field label={t('Notlar')}>
          <input className="input" value={n.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
        </Field>
        <Field label={t('Etiketler')} help={t('Gruplardan bağımsız; hedef seçicide ve komut satırında tag:<ad> ile seçilir')}>
          <TagInput value={n.tags ?? []} onChange={(v) => set({ tags: v.length ? v.map((x) => x.trim().replace(/\s+/g, '-')).filter((x) => ID_RE.test(x)) : undefined })} placeholder="projeksiyon" />
        </Field>
        <Field
          label={t('MAC adresi (uyandırmak için)')}
          error={errors.mac}
          help={learnedMacs?.length ? t('Boşsa öğrenilen kullanılır: {macs}', { macs: learnedMacs.join(', ') }) : t('Boşsa makine açıkken kendiliğinden öğrenilir')}
        >
          <input className="input mono" value={n.mac ?? ''} onChange={(e) => set({ mac: e.target.value.trim() || undefined })} placeholder={learnedMacs?.[0] ?? 'aa:bb:cc:dd:ee:ff'} />
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
