import { useEffect, useState } from 'react';
import { ArchiveRestore, FilePlus, FolderPlus, Search, ArrowRight, AlertTriangle, History as HistoryIcon, WifiOff, Server } from 'lucide-react';
import type { BackupLookup } from '@shared/types';
import { useApp } from '../store/app';
import { api, pathForFile } from '../lib/api';
import { Button, Checkbox, Empty, ToggleRow, useDebounced } from '../components/ui';
import { TargetPicker } from '../components/TargetPicker';
import { bytes, cls, dateTime } from '../lib/format';

export function BackupsPage() {
  const isElectron = useApp((s) => s.boot!.isElectron);
  const folder = useApp((s) => s.boot!.config.copy.backupFolderName);
  const targets = useApp((s) => s.targets);
  const setTargets = useApp((s) => s.setTargets);
  const watchRun = useApp((s) => s.watchRun);
  const toast = useApp((s) => s.toast);
  const [input, setInput] = useState('');
  const [rel, setRel] = useState('');
  const [mapInfo, setMapInfo] = useState<{ outside: boolean; root?: string } | null>(null);
  const [results, setResults] = useState<BackupLookup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [backupCurrent, setBackupCurrent] = useState(true);
  const [over, setOver] = useState(false);
  const debounced = useDebounced(input, 300);

  // A full local path is turned into the target relative path; anything else is used as a rel path as is.
  useEffect(() => {
    const v = debounced.trim().replace(/^"|"$/g, '');
    if (!v) {
      setRel('');
      setMapInfo(null);
      return;
    }
    if (/^[A-Za-z]:[\\/]|^\\\\|^\//.test(v)) {
      void api.mapPath(v).then((m) => {
        setRel(m.rel);
        setMapInfo({ outside: m.outside, root: m.root });
      });
    } else {
      setRel(v.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
      setMapInfo(null);
    }
  }, [debounced]);

  const search = async () => {
    if (!rel || !targets.length) return;
    setLoading(true);
    setResults(null);
    try {
      const r = await api.findBackups(rel, targets);
      setResults(r);
      const p: Record<string, string | null> = {};
      for (const x of r) p[x.targetId] = x.versions[0]?.stamp ?? null;
      setPicks(p);
    } catch (e) {
      toast('error', 'Yedekler aranamadı', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const chosen = Object.entries(picks).filter(([, s]) => !!s) as [string, string][];
  const restore = async () => {
    if (!chosen.length) return;
    if (!confirm(`${chosen.length} hedefte “${rel}” seçilen yedekle değiştirilecek. Devam edilsin mi?`)) return;
    try {
      const id = await api.restore(
        rel,
        chosen.map(([targetId, stamp]) => ({ targetId, stamp })),
        backupCurrent,
      );
      watchRun(id);
    } catch (e) {
      toast('error', 'Geri alma başlatılamadı', (e as Error).message);
    }
  };

  const pick = async (folders: boolean) => {
    const [p] = await api.pick({ folders, files: !folders, title: 'Geri alınacak öğe' });
    if (p) setInput(p);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Yedekler</h1>
          <div className="sub">
            “Yedek al” ile gönderilen dosyaların eski hâlleri hedefte <span className="mono">{folder}</span> altında tarih klasörlerinde durur. Buradan geri yazabilirsiniz.
          </div>
        </div>
      </div>
      <div className="page-body fill">
        <div className="send-grid">
          <div className="col" style={{ gap: 14, minHeight: 0 }}>
            <div className="card">
              <div className="card-head">
                <div className="icon-tile">
                  <ArchiveRestore size={15} />
                </div>
                <h2>Geri alınacak öğe</h2>
              </div>
              <div
                className={cls('card-body drop-zone', over && 'over')}
                style={{ margin: 12, border: '1.5px dashed var(--border-strong)' }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  (e.nativeEvent as DragEvent & { samsyncHandled?: boolean }).samsyncHandled = true;
                  setOver(false);
                  const f = e.dataTransfer.files[0];
                  const p = f ? pathForFile(f) : null;
                  if (p) setInput(p);
                }}
              >
                <div className="row">
                  <input className="input mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Yerel yol (C:\…\Data\x.entity) ya da göreli yol (Data/x.entity)" spellCheck={false} />
                  <Button iconOnly icon={<FilePlus size={15} />} tip="Dosya seç" disabled={!isElectron} onClick={() => void pick(false)} />
                  <Button iconOnly icon={<FolderPlus size={15} />} tip="Klasör seç" disabled={!isElectron} onClick={() => void pick(true)} />
                </div>
                {rel && (
                  <div className="row mono" style={{ marginTop: 10, fontSize: 12, gap: 6 }}>
                    <ArrowRight size={13} className="faint" />
                    <span className="faint">hedefte:</span>
                    <span className="selectable">{rel}</span>
                    {mapInfo?.outside && <span className="badge amber">kök dışı</span>}
                  </div>
                )}
                <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                  Dosyayı ya da klasörü buraya da sürükleyebilirsiniz.
                </div>
              </div>
              <div className="row" style={{ padding: '0 12px 12px' }}>
                <ToggleRow icon={<HistoryIcon size={16} className="faint" />} title="Geri almadan önce şu anki hâli yedekle" desc="Geri alma da geri alınabilir olur" on={backupCurrent} onChange={setBackupCurrent} />
              </div>
              <div className="row" style={{ padding: '0 12px 12px', justifyContent: 'flex-end' }}>
                <Button variant="primary" icon={<Search size={14} />} loading={loading} disabled={!rel || !targets.length} onClick={() => void search()}>
                  Yedekleri ara
                </Button>
              </div>
            </div>
            <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="card-head">
                <h2>Sonuçlar</h2>
                {results && <span className="hint">{results.filter((r) => r.versions.length).length} hedefte yedek var</span>}
                <span className="spacer" />
                <Button variant="primary" icon={<ArchiveRestore size={14} />} disabled={!chosen.length} onClick={() => void restore()}>
                  Geri al ({chosen.length})
                </Button>
              </div>
              <div className="pane-scroll">
                {!results ? (
                  <Empty icon={<ArchiveRestore size={22} />} title={loading ? 'Aranıyor…' : 'Bir öğe seçip yedekleri arayın'}>
                    {loading ? undefined : 'Seçili hedeflerin yedek klasörleri taranır; her hedef için istediğiniz tarihi seçebilirsiniz.'}
                  </Empty>
                ) : (
                  results.map((r) => (
                    <div key={r.targetId} className="list-row" style={{ height: 'auto', minHeight: 54, padding: '8px 14px', opacity: r.versions.length ? 1 : 0.6 }}>
                      <Checkbox checked={!!picks[r.targetId]} disabled={!r.versions.length} onChange={(v) => setPicks((p) => ({ ...p, [r.targetId]: v ? r.versions[0]?.stamp ?? null : null }))} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 580 }}>{r.targetName}</div>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {!r.reachable ? (
                            <span className="row" style={{ gap: 4 }}>
                              <WifiOff size={12} /> {r.error}
                            </span>
                          ) : r.current ? (
                            `şu an: ${r.current.isDir ? 'klasör' : bytes(r.current.size)} • ${dateTime(r.current.mtimeMs)}`
                          ) : (
                            'şu an hedefte yok'
                          )}
                        </div>
                      </div>
                      {r.versions.length ? (
                        <select className="select" style={{ width: 260 }} value={picks[r.targetId] ?? r.versions[0].stamp} onChange={(e) => setPicks((p) => ({ ...p, [r.targetId]: e.target.value }))}>
                          {r.versions.map((v) => (
                            <option key={v.stamp} value={v.stamp}>
                              {dateTime(v.date)} — {v.isDir ? 'klasör' : bytes(v.size)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="faint" style={{ fontSize: 12 }}>
                          {r.reachable ? 'yedek yok' : ''}
                        </span>
                      )}
                    </div>
                  ))
                )}
                {results && results.every((r) => !r.versions.length) && (
                  <div className="alert warn" style={{ margin: 12 }}>
                    <AlertTriangle size={15} /> Bu öğe için hiçbir hedefte yedek bulunamadı. Yedekler, gönderimde “Yedek al” açıkken oluşur.
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="card targets-card">
            <div className="card-head">
              <div className="icon-tile">
                <Server size={15} />
              </div>
              <h2>Aranacak hedefler</h2>
            </div>
            <TargetPicker value={targets} onChange={setTargets} />
          </div>
        </div>
      </div>
    </div>
  );
}
