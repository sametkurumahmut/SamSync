// Two machines side by side: the same folder on A and on B, what only one of them has, what differs and
// which side is newer, with the line diff of the file you pick. For machines that should be identical.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Play, Search, FileText, Folder, WifiOff, Equal } from 'lucide-react';
import type { Category, CompareItem, CompareMethod, CompareResult, DiffResult, SyncJob } from '@shared/types';
import { OWN_FILE_PATTERNS } from '@shared/files';
import { RELAY_FOLDER } from '@shared/relay';
import { useApp } from '../store/app';
import { api, newTaskId } from '../lib/api';
import { Button, Empty, Segmented } from './ui';
import { DiffView } from './DiffView';
import { useTargetNodes } from './TargetPicker';
import { compareOptions } from '../pages/SendPage';
import { bytes, cls, shortDateTime } from '../lib/format';
import { readStored, writeStored } from '../lib/persist';
import { t } from '@shared/i18n';

const SHOWN: Category[] = ['leftOnly', 'rightOnly', 'different', 'leftNewer', 'rightNewer', 'conflict'];
const TONE: Record<Category, string> = { leftOnly: 'green', rightOnly: 'red', different: 'accent', leftNewer: 'amber', rightNewer: 'amber', conflict: 'red', equal: '' };

export function MachineCompare() {
  const nodes = useTargetNodes(true);
  const compare = useApp((s) => s.options.compare);
  const setOptions = useApp((s) => s.setOptions);
  const copy = useApp((s) => s.boot!.config.copy);
  const toast = useApp((s) => s.toast);
  const [left, setLeft] = useState(() => readStored<string>('samsync.compare.left', nodes[0]?.id ?? ''));
  const [right, setRight] = useState(() => readStored<string>('samsync.compare.right', nodes[1]?.id ?? ''));
  const [sub, setSub] = useState(() => readStored<string>('samsync.compare.sub', ''));
  const [result, setResult] = useState<CompareResult | null>(null);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ diff: DiffResult | null; loading: boolean; error?: string }>({ diff: null, loading: false });

  useEffect(() => writeStored('samsync.compare.left', left), [left]);
  useEffect(() => writeStored('samsync.compare.right', right), [right]);
  useEffect(() => writeStored('samsync.compare.sub', sub), [sub]);

  const names = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);
  const A = names.get(left) ?? left;
  const B = names.get(right) ?? right;
  const CAT: Record<Category, string> = {
    leftOnly: t('yalnız {name}', { name: A }),
    rightOnly: t('yalnız {name}', { name: B }),
    different: t('farklı'),
    leftNewer: t('{name} daha yeni', { name: A }),
    rightNewer: t('{name} daha yeni', { name: B }),
    conflict: t('çakışma'),
    equal: t('aynı'),
  };

  const run = async () => {
    if (!left || !right || left === right) return toast('warn', t('İki farklı makine seçin'));
    const taskId = newTaskId();
    const subPath = sub.trim().replace(/^[\\/]+|[\\/]+$/g, '');
    const job: SyncJob = {
      id: 'adhoc-compare',
      name: t('{a} ⇄ {b}', { a: A, b: B }),
      pairs: [{ id: 'p', left: { kind: 'node', nodeId: left, subPath }, right: { kind: 'node', nodeId: right, subPath } }],
      compare: compare as CompareMethod,
      variant: 'twoWay',
      filter: { include: [], exclude: [...OWN_FILE_PATTERNS, `${copy.backupFolderName}/`, `${RELAY_FOLDER}/`] },
      deletion: 'versioning',
      versioningKeep: 0,
    };
    useApp.setState({ planning: { taskId, message: t('Karşılaştırılıyor…') } });
    try {
      const r = await api.compareJob(job, taskId);
      if (useApp.getState().planning?.taskId !== taskId) return;
      setResult(r);
      setKey(null);
    } catch (e) {
      if (!(e as Error).message.includes(t('İptal edildi'))) toast('error', t('Karşılaştırılamadı'), (e as Error).message);
    } finally {
      useApp.setState((s) => (s.planning?.taskId === taskId ? { planning: null } : {}));
    }
  };

  const pair = result?.pairs[0];
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (pair?.items ?? []).filter((it) => it.category !== 'equal' && (filter === 'all' || it.category === filter) && (!q || it.rel.toLowerCase().includes(q)));
  }, [pair, filter, query]);
  const item = items.find((it) => it.key === key) ?? null;
  const counts = result?.stats.byCategory;

  useEffect(() => {
    if (!item) return setDiff({ diff: null, loading: false });
    if (item.isDir) return setDiff({ diff: null, loading: false, error: t('Klasörün içeriği listede ayrı satırlar olarak görünür.') });
    setDiff({ diff: null, loading: true });
    let live = true;
    const subPath = sub.trim().replace(/^[\\/]+|[\\/]+$/g, '');
    const rel = subPath ? `${subPath}/${item.rel}` : item.rel;
    api
      .diffNodes(left, right, rel)
      .then((d) => live && setDiff({ diff: d, loading: false }))
      .catch((e) => live && setDiff({ diff: null, loading: false, error: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [item?.key, left, right]);

  const side = (m: CompareItem['left']) => (m ? (m.isDir ? t('klasör') : `${bytes(m.size)} • ${shortDateTime(m.mtimeMs)}`) : '—');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 32%) minmax(0, 1fr)', gap: 14, minHeight: 0, height: '100%' }}>
      <div className="col" style={{ gap: 14, minHeight: 0 }}>
        <div className="card">
          <div className="card-head">
            <div className="icon-tile accent">
              <ArrowLeftRight size={15} />
            </div>
            <h2>{t('İki makine')}</h2>
          </div>
          <div className="card-body col" style={{ gap: 10 }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="faint" style={{ fontSize: 11.5 }}>
                A
              </span>
              <select className="select" value={left} onChange={(e) => setLeft(e.target.value)}>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="faint" style={{ fontSize: 11.5 }}>
                B
              </span>
              <select className="select" value={right} onChange={(e) => setRight(e.target.value)}>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="faint" style={{ fontSize: 11.5 }}>
                {t('Klasör (köke göre; boş: kökün tamamı)')}
              </span>
              <input className="input mono" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Data/EntityConfigurations" spellCheck={false} />
            </label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Segmented size="sm" value={compare} onChange={(c) => setOptions({ compare: c })} options={compareOptions()} />
              <span className="spacer" />
              <Button variant="primary" icon={<Play size={14} />} disabled={!left || !right || left === right} onClick={() => void run()}>
                {result ? t('Yeniden karşılaştır') : t('Karşılaştır')}
              </Button>
            </div>
            <div className="faint" style={{ fontSize: 11.5 }}>
              {t('Aynı olması gereken makineler (A ↔ B) arasındaki sapmayı gösterir; hiçbir şey yazılmaz. Eşitlemek için Senkron sayfasını kullanın.')}
            </div>
          </div>
        </div>
        {result && counts && (
          <div className="card">
            <div className="card-body col" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className={cls('chip', filter === 'all' && 'on')} onClick={() => setFilter('all')}>
                  {t('Tümü')} <b>{SHOWN.reduce((a, c) => a + counts[c], 0)}</b>
                </button>
                {SHOWN.filter((c) => counts[c] > 0).map((c) => (
                  <button key={c} className={cls('chip', filter === c && 'on')} onClick={() => setFilter(c)}>
                    <span className={cls('dot', TONE[c] === 'green' ? 'ok' : TONE[c] === 'red' ? 'bad' : 'pending')} /> {CAT[c]} <b>{counts[c]}</b>
                  </button>
                ))}
                <span className="chip static">
                  <Equal size={11} /> {t('aynı')} <b>{counts.equal}</b>
                </span>
              </div>
              {pair?.error && (
                <div className="alert warn">
                  <WifiOff size={14} /> {pair.error}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!result ? (
          <Empty art="compare" title={t('Henüz karşılaştırma yok')}>
            {t('İki makine ve bir klasör seçip Karşılaştır’a basın.')}
          </Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 42%) minmax(0, 1fr)', minHeight: 0, flex: 1 }}>
            <div className="col" style={{ minHeight: 0, borderRight: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 6, padding: 10 }}>
                <Search size={13} className="faint" />
                <input className="input sm grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Dosya ara')} />
              </div>
              <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>
                {items.length ? (
                  items.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      className={cls('list-row', it.key === key && 'active')}
                      style={{ width: '100%', textAlign: 'left', gap: 8, border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', background: it.key === key ? 'var(--bg-active)' : 'transparent', alignItems: 'flex-start', padding: '7px 10px' }}
                      onClick={() => setKey(it.key)}
                    >
                      {it.isDir ? <Folder size={13} className="faint" style={{ marginTop: 2 }} /> : <FileText size={13} className="faint" style={{ marginTop: 2 }} />}
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="row" style={{ gap: 6 }}>
                          <span className="mono ellipsis" style={{ fontSize: 12 }} title={it.rel}>
                            {it.rel}
                          </span>
                          <span className={cls('badge', TONE[it.category])}>{CAT[it.category]}</span>
                        </span>
                        <span className="faint row" style={{ fontSize: 10.5, gap: 8 }}>
                          <span>
                            A: {side(it.left)}
                          </span>
                          <span>
                            B: {side(it.right)}
                          </span>
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="faint" style={{ padding: 16, fontSize: 12.5 }}>
                    {pair?.items.some((it) => it.category !== 'equal') ? t('Bu süzgece uyan dosya yok.') : t('İki makine bu klasörde aynı.')}
                  </div>
                )}
              </div>
            </div>
            <div style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {item ? (
                <DiffView
                  diff={diff.diff}
                  loading={diff.loading}
                  error={diff.error}
                  title={
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      <span className="badge">{A}</span> → <span className="badge">{B}</span> • {CAT[item.category]}
                    </span>
                  }
                />
              ) : (
                <Empty art="search" title={t('Bir dosya seçin')}>
                  {t('Soldaki listeden bir dosyaya tıklayınca iki makinedeki hâlinin farkı burada görünür.')}
                </Empty>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
