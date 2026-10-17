// Which release each machine holds: one row per sent folder, one column per machine, from the manifests
// SamSync leaves behind. The newest state of a folder is the reference; a machine behind it is marked.
import { useEffect, useMemo, useState } from 'react';
import { Boxes, RefreshCw, WifiOff, Minus, Check, Clock, Package } from 'lucide-react';
import type { InventoryEntry, InventoryRow } from '@shared/types';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { Button } from './ui';
import { ago, bytes, cls, dateTime, num } from '../lib/format';
import { t } from '@shared/i18n';

/** Two writes closer than this count as the same release (a group sent in one go). */
const SAME_MS = 10 * 60_000;

function cellTip(e: InventoryEntry): string {
  const who = e.by?.user ? `${e.by.user}@${e.by.host ?? ''}` : (e.by?.host ?? '');
  return [e.label || '', dateTime(e.writtenAt), who ? t('gönderen: {who}', { who }) : '', `${t('{n} dosya', { n: num(e.files) })} • ${bytes(e.size)}`, e.by?.version ? `SamSync ${e.by.version}` : ''].filter(Boolean).join('\n');
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
          <div className="inventory-scroll">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th className="inv-folder">{t('Klasör')}</th>
                  {columns.map((c) => (
                    <th key={c.nodeId} className={cls(!c.reachable && 'down')} title={c.error}>
                      <div className="ellipsis">{c.name}</div>
                      <div className="faint ellipsis" style={{ fontSize: 10.5, fontWeight: 500 }}>
                        {c.nodeId === localId ? t('bu makine') : (c.group ?? '')}
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
