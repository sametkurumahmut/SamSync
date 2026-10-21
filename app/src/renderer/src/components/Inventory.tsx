// Which release each machine holds: one row per sent folder, one column per machine, from the manifests
// SamSync leaves behind. The newest state of a folder is the reference; a machine behind it is marked.
import { useEffect, useMemo, useState } from 'react';
import { Boxes, RefreshCw, WifiOff, Minus, Check, Clock, Package, ScanSearch, AlertTriangle } from 'lucide-react';
import type { DriftReport, InventoryEntry, InventoryRow } from '@shared/types';
import { useApp } from '../store/app';
import { api, newTaskId, onEvent } from '../lib/api';
import { driftCounts, drifted } from '@shared/drift';
import { Button } from './ui';
import { ago, bytes, cls, dateTime, num } from '../lib/format';
import { t } from '@shared/i18n';
import { machineLabel } from '@shared/machine';

/** Two writes closer than this count as the same release (a group sent in one go). */
const SAME_MS = 10 * 60_000;

function cellTip(e: InventoryEntry): string {
  const who = e.by?.user ? `${e.by.user}@${e.by.host ?? ''}` : (e.by?.host ?? '');
  return [e.label || '', dateTime(e.writtenAt), who ? t('gönderen: {who}', { who }) : '', `${t('{n} dosya', { n: num(e.files) })} • ${bytes(e.size)}`, e.by?.version ? `SamSync ${e.by.version}` : ''].filter(Boolean).join('\n');
}

/** A few of a drift list's paths, with how many more there are. */
function PathList({ mark, items, total }: { mark: string; items: string[]; total: number }) {
  if (!total) return null;
  const shown = items.slice(0, 40);
  return (
    <>
      {shown.map((p) => (
        <div key={mark + p} className="mono truncate" style={{ fontSize: 11.5 }}>
          <span className="faint">{mark}</span> {p}
        </div>
      ))}
      {total > shown.length && <div className="faint" style={{ fontSize: 11.5 }}>{t('… ve {n} tane daha', { n: total - shown.length })}</div>}
    </>
  );
}

/**
 * Drift: files on the machines that changed after the last send, from each machine's manifest. By hand, or every
 * few hours (the desktop and the team's channel hear of what is found).
 */
function DriftSection() {
  const hours = useApp((s) => s.boot!.settings.driftCheckHours ?? 0);
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const [reports, setReports] = useState<DriftReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api
      .lastDrift()
      .then((r) => r && setReports(r))
      .catch(() => undefined);
    return onEvent((e) => {
      if (e.type === 'drift') setReports(e.reports);
    });
  }, []);
  const check = async () => {
    setBusy(true);
    try {
      setReports(await api.driftCheck(null, newTaskId()));
    } catch (e) {
      toast('error', t('Sapma denetlenemedi'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const found = (reports ?? []).filter(drifted);
  const unknown = (reports ?? []).filter((r) => !drifted(r) && (r.error || !r.reachable || !r.manifest));
  const clean = (reports ?? []).filter((r) => !drifted(r) && !r.error && r.reachable && r.manifest);
  const at = reports?.length ? Math.max(...reports.map((r) => r.checkedAt)) : null;
  return (
    <div className="drift-section">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <ScanSearch size={14} className="faint" />
        <b style={{ fontSize: 12.5 }}>{t('Sapma denetimi')}</b>
        <span className="faint" style={{ fontSize: 12 }}>
          {t('son gönderimden sonra makinelerde değişen dosyalar')}
        </span>
        <span className="spacer" />
        <select className="select" style={{ height: 27, width: 'auto', fontSize: 12 }} aria-label={t('Otomatik sapma denetimi')} value={String(hours)} onChange={(e) => void saveSettings({ driftCheckHours: Number(e.target.value) || undefined })}>
          <option value="0">{t('Otomatik: kapalı')}</option>
          <option value="1">{t('Her saat')}</option>
          <option value="6">{t('6 saatte bir')}</option>
          <option value="24">{t('Günde bir')}</option>
        </select>
        <Button size="sm" icon={<ScanSearch size={13} />} loading={busy} onClick={() => void check()} tip={t('Her makinedeki gönderilmiş klasörleri oradaki manifestle karşılaştırır; SamSync çalışan makine kendi diskine bakar')}>
          {t('Sapma denetle')}
        </Button>
      </div>
      {reports && (
        <div className="col" style={{ gap: 6, marginTop: 8 }}>
          {found.length === 0 ? (
            <div className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <Check size={13} color="var(--green)" />
              {t('Sapma yok: {n} makine son gönderimdeki gibi', { n: clean.length })}
              {at && <span className="faint">• {ago(at)}</span>}
            </div>
          ) : (
            <div className="row" style={{ gap: 6, fontSize: 12.5 }}>
              <AlertTriangle size={13} color="var(--amber)" />
              {t('{n} makinede son gönderimden sonra değişiklik var', { n: found.length })}
              {at && <span className="faint">• {ago(at)}</span>}
            </div>
          )}
          {found.map((r) => (
            <details key={r.nodeId} className="drift-machine">
              <summary>
                <b>{machineLabel(r.name).title}</b> <span className="faint">{driftCounts(r)}</span>
              </summary>
              {r.subtrees
                .filter((s) => s.counts.changed + s.counts.added + s.counts.removed > 0)
                .map((s) => (
                  <div key={s.rel} className="col" style={{ gap: 1, margin: '6px 0 0 14px' }}>
                    <div style={{ fontSize: 12 }}>
                      <span className="mono">{s.rel || '/'}</span> <span className="faint">• {s.label || t('(adsız)')} • {ago(s.writtenAt)}</span>
                    </div>
                    <PathList mark="~" items={s.changed} total={s.counts.changed} />
                    <PathList mark="+" items={s.added} total={s.counts.added} />
                    <PathList mark="−" items={s.removed} total={s.counts.removed} />
                  </div>
                ))}
            </details>
          ))}
          {unknown.length > 0 && (
            <div className="faint" style={{ fontSize: 12 }}>
              {t('Denetlenemedi')}: {unknown.map((r) => `${machineLabel(r.name).title} (${r.error || (!r.reachable ? t('erişilemedi') : t('manifest yok'))})`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Inventory() {
  const nodes = useApp((s) => s.boot!.config.nodes);
  const localId = useApp((s) => s.boot!.identity.node?.id);
  const historyVersion = useApp((s) => s.historyVersion);
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await api.inventory());
      setAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // once when the card appears, and again after every finished run
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyVersion]);

  const columns = useMemo(() => {
    const order = new Map(nodes.map((n, i) => [n.id, i]));
    return [...(rows ?? [])].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0));
  }, [rows, nodes]);

  const folders = useMemo(() => {
    const m = new Map<string, Map<string, InventoryEntry>>();
    for (const r of columns) for (const e of r.entries) {
      if (!m.has(e.rel)) m.set(e.rel, new Map());
      m.get(e.rel)!.set(r.nodeId, e);
    }
    return [...m.entries()]
      .map(([rel, by]) => {
        const newest = Math.max(...[...by.values()].map((e) => e.writtenAt));
        return { rel, by, newest };
      })
      .sort((a, b) => a.rel.localeCompare(b.rel));
  }, [columns]);

  const behind = folders.reduce((n, f) => n + columns.filter((c) => c.reachable && f.by.has(c.nodeId) && f.newest - f.by.get(c.nodeId)!.writtenAt > SAME_MS).length, 0);
  const missing = folders.reduce((n, f) => n + columns.filter((c) => c.reachable && !f.by.has(c.nodeId)).length, 0);

  return (
    <div className="card inventory-card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div className="icon-tile accent">
          <Boxes size={15} />
        </div>
        <h2>{t('Makine envanteri')}</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          {t('Her makinede hangi sürüm var: oraya bırakılan manifestten')}
        </span>
        <span className="spacer" />
        {rows && folders.length > 0 && (
          <span className="row" style={{ gap: 6, fontSize: 12 }}>
            {behind > 0 && <span className="badge amber">{t('{n} geride', { n: behind })}</span>}
            {missing > 0 && <span className="badge">{t('{n} eksik', { n: missing })}</span>}
            {behind === 0 && missing === 0 && (
              <span className="badge green">
                <Check size={11} /> {t('hepsi aynı')}
              </span>
            )}
          </span>
        )}
        {at && (
          <span className="faint" style={{ fontSize: 11.5 }}>
            {ago(at)}
          </span>
        )}
        <Button size="sm" icon={<RefreshCw size={13} className={busy ? 'spin' : undefined} />} loading={busy} onClick={() => void refresh()}>
          {t('Yenile')}
        </Button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {error && (
          <div className="alert error" style={{ margin: 12 }}>
            {error}
          </div>
        )}
        {rows && !folders.length && !error && (
          <div className="faint" style={{ padding: '14px 16px', fontSize: 12.5 }}>
            {rows.some((r) => !r.reachable) ? t('Erişilebilen makinelerde manifest yok. ') : ''}
            {t('Bir gönderimden ya da paketten sonra her makinenin kökünde samsync-manifest.json kalır; tablo ondan dolar.')}
          </div>
        )}
        {folders.length > 0 && (
          <div className="inventory-scroll" tabIndex={0} role="region" aria-label={t('Makine envanteri')}>
            <table className="inventory-table">
              <thead>
                <tr>
                  <th className="inv-folder">{t('Klasör')}</th>
                  {columns.map((c) => (
                    <th key={c.nodeId} className={cls(!c.reachable && 'down')} title={c.error}>
                      <div className="ellipsis">{machineLabel(c.name).title}</div>
                      <div className="faint ellipsis" style={{ fontSize: 10.5, fontWeight: 500 }}>
                        {[machineLabel(c.name).sub, c.nodeId === localId ? t('bu makine') : c.group].filter(Boolean).join(' · ')}
                        {!c.reachable && (
                          <span className="row" style={{ gap: 3, color: 'var(--red)' }}>
                            <WifiOff size={10} /> {t('erişilemedi')}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.rel}>
                    <td className="inv-folder mono">{f.rel || '/'}</td>
                    {columns.map((c) => {
                      const e = f.by.get(c.nodeId);
                      if (!c.reachable)
                        return (
                          <td key={c.nodeId} className="inv-cell down">
                            <Minus size={12} />
                          </td>
                        );
                      if (!e)
                        return (
                          <td key={c.nodeId} className="inv-cell none" title={t('Bu klasör bu makineye hiç gönderilmemiş (ya da manifest yok)')}>
                            <Minus size={12} />
                          </td>
                        );
                      const old = f.newest - e.writtenAt > SAME_MS;
                      return (
                        <td key={c.nodeId} className={cls('inv-cell', old ? 'old' : 'current')} title={cellTip(e)}>
                          <div className="row" style={{ gap: 5 }}>
                            {old ? <Clock size={12} /> : <Check size={12} />}
                            <span className="ellipsis" style={{ fontWeight: 600 }}>
                              {e.label || t('(adsız)')}
                            </span>
                          </div>
                          <div className="faint tabular" style={{ fontSize: 11 }}>
                            {ago(e.writtenAt)} • {bytes(e.size)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && folders.length > 0 && <DriftSection />}
        {rows && folders.length > 0 && (
          <div className="row faint" style={{ padding: '8px 14px', fontSize: 11.5, gap: 14, borderTop: '1px solid var(--border)' }}>
            <span className="row" style={{ gap: 4 }}>
              <Check size={11} color="var(--green)" /> {t('en yeni hâl')}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Clock size={11} color="var(--amber)" /> {t('daha eski bir gönderim')}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Minus size={11} /> {t('hiç gönderilmemiş')}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Package size={11} /> {t('Diskle verilen sürümler de paket olarak uygulanınca burada görünür.')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
