import { useEffect, useState } from 'react';
import { ArchiveRestore, FilePlus, FolderPlus, Search, ArrowRight, AlertTriangle, History as HistoryIcon, WifiOff, Server } from 'lucide-react';
import type { BackupLookup, BackupVersion } from '@shared/types';
import { useApp } from '../store/app';
import { api, pathForFile } from '../lib/api';
import { Button, Checkbox, Empty, ToggleRow, useDebounced } from '../components/ui';
import { TargetPicker } from '../components/TargetPicker';
import { baseName, bytes, cls, dateTime } from '../lib/format';
import { t } from '@shared/i18n';
import { tx } from '../lib/i18n';

/** A version is a date folder inside one backup folder: the configured one or an older one at the target root. */
const versionKey = (v: BackupVersion) => `${v.folder}/${v.stamp}`;

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
  const restoreRequest = useApp((s) => s.restoreRequest);
  /** Items sent from the Explorer or Notepad++ menu; one is looked up at a time. */
  const [queue, setQueue] = useState<string[]>([]);
  const [autoSearch, setAutoSearch] = useState(false);

  // "Restore from backup" from a menu: take its items and look on every machine, as the old menu did
  useEffect(() => {
    if (!restoreRequest?.paths.length) return;
    const st = useApp.getState();
    const local = st.boot?.identity.node?.id;
    setQueue(restoreRequest.paths);
    setInput(restoreRequest.paths[0]);
    setTargets((st.boot?.config.nodes ?? []).filter((n) => n.enabled && n.id !== local).map((n) => n.id));
    setAutoSearch(true);
  }, [restoreRequest?.seq]);

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
      for (const x of r) p[x.targetId] = x.versions[0] ? versionKey(x.versions[0]) : null;
      setPicks(p);
    } catch (e) {
      toast('error', t('Yedekler aranamadı'), (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoSearch || !rel || debounced.trim() !== input.trim()) return;
    setAutoSearch(false);
    void search();
  }, [autoSearch, rel, debounced, input]);

  const chosen = Object.entries(picks).filter(([, s]) => !!s) as [string, string][];
  const restore = async () => {
    if (!chosen.length) return;
    if (!confirm(t('{n} hedefte “{path}” seçilen yedekle değiştirilecek. Devam edilsin mi?', { n: chosen.length, path: rel }))) return;
    try {
      const id = await api.restore(
        rel,
        chosen.map(([targetId, key]) => ({ targetId, folder: key.slice(0, key.lastIndexOf('/')), stamp: key.slice(key.lastIndexOf('/') + 1) })),
        backupCurrent,
      );
      watchRun(id);
    } catch (e) {
      toast('error', t('Geri alma başlatılamadı'), (e as Error).message);
    }
  };

  const pick = async (folders: boolean) => {
    const [p] = await api.pick({ folders, files: !folders, title: t('Geri alınacak öğe') });
    if (p) setInput(p);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Yedekler')}</h1>
          <div className="sub">
            {tx('“Yedek al” ile gönderilen dosyaların eski hâlleri hedefte {folder} altında tarih klasörlerinde durur. Buradan geri yazabilirsiniz.', { folder: <span className="mono">{folder}</span> })}{' '}
            {t('Hedef kökünde “_” ile başlayıp yalnızca tarih klasörleri içeren eski yedek klasörleri de taranır.')}
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
                <h2>{t('Geri alınacak öğe')}</h2>
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
                  <input className="input mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('Yerel yol (C:\\…\\Data\\x.entity) ya da göreli yol (Data/x.entity)')} spellCheck={false} />
                  <Button iconOnly icon={<FilePlus size={15} />} tip={t('Dosya seç')} disabled={!isElectron} onClick={() => void pick(false)} />
                  <Button iconOnly icon={<FolderPlus size={15} />} tip={t('Klasör seç')} disabled={!isElectron} onClick={() => void pick(true)} />
                </div>
                {rel && (
                  <div className="row mono" style={{ marginTop: 10, fontSize: 12, gap: 6 }}>
                    <ArrowRight size={13} className="faint" />
                    <span className="faint">{t('hedefte:')}</span>
                    <span className="selectable">{rel}</span>
                    {mapInfo?.outside && <span className="badge amber">{t('kök dışı')}</span>}
                  </div>
                )}
                {queue.length > 1 && (
                  <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {t('Menüden gelen öğeler:')}
                    </span>
                    {queue.map((p) => (
                      <Button
                        key={p}
                        size="sm"
                        variant={p === input ? 'primary' : 'default'}
                        tip={p}
                        onClick={() => {
                          setInput(p);
                          setAutoSearch(true);
                        }}
                      >
                        {baseName(p)}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                  {t('Dosyayı ya da klasörü buraya da sürükleyebilirsiniz.')}
                </div>
              </div>
              <div className="row" style={{ padding: '0 12px 12px' }}>
                <ToggleRow icon={<HistoryIcon size={16} className="faint" />} title={t('Geri almadan önce şu anki hâli yedekle')} desc={t('Geri alma da geri alınabilir olur')} on={backupCurrent} onChange={setBackupCurrent} />
              </div>
              <div className="row" style={{ padding: '0 12px 12px', justifyContent: 'flex-end' }}>
                <Button variant="primary" icon={<Search size={14} />} loading={loading} disabled={!rel || !targets.length} onClick={() => void search()}>
                  {t('Yedekleri ara')}
                </Button>
              </div>
            </div>
            <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="card-head">
                <h2>{t('Sonuçlar')}</h2>
                {results && <span className="hint">{t('{n} hedefte yedek var', { n: results.filter((r) => r.versions.length).length })}</span>}
                <span className="spacer" />
                <Button variant="primary" icon={<ArchiveRestore size={14} />} disabled={!chosen.length} onClick={() => void restore()}>
                  {t('Geri al ({n})', { n: chosen.length })}
                </Button>
              </div>
              <div className="pane-scroll">
                {!results ? (
                  <Empty icon={<ArchiveRestore size={22} />} title={loading ? t('Aranıyor…') : t('Bir öğe seçip yedekleri arayın')}>
                    {loading ? undefined : t('Seçili hedeflerin yedek klasörleri taranır; her hedef için istediğiniz tarihi seçebilirsiniz.')}
                  </Empty>
                ) : (
                  results.map((r) => (
                    <div key={r.targetId} className="list-row" style={{ height: 'auto', minHeight: 54, padding: '8px 14px', opacity: r.versions.length ? 1 : 0.6 }}>
                      <Checkbox checked={!!picks[r.targetId]} disabled={!r.versions.length} onChange={(v) => setPicks((p) => ({ ...p, [r.targetId]: v && r.versions[0] ? versionKey(r.versions[0]) : null }))} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 580 }}>{r.targetName}</div>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {!r.reachable ? (
                            <span className="row" style={{ gap: 4 }}>
                              <WifiOff size={12} /> {r.error}
                            </span>
                          ) : r.current ? (
                            t('şu an: {what} • {time}', { what: r.current.isDir ? t('klasör') : bytes(r.current.size), time: dateTime(r.current.mtimeMs) })
                          ) : (
                            t('şu an hedefte yok')
                          )}
                        </div>
                      </div>
                      {r.versions.length ? (
                        <select className="select" style={{ width: 260 }} value={picks[r.targetId] ?? versionKey(r.versions[0])} onChange={(e) => setPicks((p) => ({ ...p, [r.targetId]: e.target.value }))}>
                          {r.versions.map((v) => (
                            <option key={versionKey(v)} value={versionKey(v)}>
                              {dateTime(v.date)} — {v.isDir ? t('klasör') : bytes(v.size)}
                              {v.folder !== folder ? ` • ${v.folder}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="faint" style={{ fontSize: 12 }}>
                          {r.reachable ? t('yedek yok') : ''}
                        </span>
                      )}
                    </div>
                  ))
                )}
                {results && results.every((r) => !r.versions.length) && (
                  <div className="alert warn" style={{ margin: 12 }}>
                    <AlertTriangle size={15} /> {t('Bu öğe için hiçbir hedefte yedek bulunamadı. Yedekler, gönderimde “Yedek al” açıkken oluşur.')}
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
              <h2>{t('Aranacak hedefler')}</h2>
            </div>
            <TargetPicker value={targets} onChange={setTargets} />
          </div>
        </div>
      </div>
    </div>
  );
}
