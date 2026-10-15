import { useEffect, useMemo, useState } from 'react';
import { GitCompare, Play, Send, Search, WifiOff, Folder, FileText } from 'lucide-react';
import type { DiffResult, PlanCategory, PlanOp, SendPlan, SourceSpec } from '@shared/types';
import { useApp } from '../store/app';
import { api, newTaskId } from '../lib/api';
import { Button, Empty, Segmented } from '../components/ui';
import { TargetPicker } from '../components/TargetPicker';
import { DiffView } from '../components/DiffView';
import { SIGN, opStatus } from '../components/PlanReview';
import { compareOptions } from './SendPage';
import { bytes, cls } from '../lib/format';
import { t, tk } from '@shared/i18n';
import { tx } from '../lib/i18n';

type Filter = 'all' | PlanCategory;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: tk('Tümü') },
  { value: 'new', label: tk('Yeni') },
  { value: 'changed', label: tk('Değişen') },
  { value: 'targetNewer', label: tk('Hedefte daha yeni') },
  { value: 'extra', label: tk('Fazla') },
];
const CAT_COLOR: Partial<Record<PlanCategory, string>> = { new: 'green', changed: 'accent', targetNewer: 'amber', extra: 'red', deleted: 'red' };

const srcFor = (op: PlanOp): SourceSpec | null => {
  if (!op.src) return null;
  if (op.src.kind === 'fs') return { kind: 'fs', path: op.src.abs };
  if (op.src.kind === 'git') return { kind: 'git', repo: op.src.repo, rev: op.src.rev, path: op.src.path };
  return null;
};

/**
 * Compares the Send page's sources with the targets without sending anything: per target the files that
 * are new, changed, newer on the target or extra there, and the line diff of the one you pick.
 */
export function ComparePage() {
  const sendPaths = useApp((s) => s.sendPaths);
  const targets = useApp((s) => s.targets);
  const setTargets = useApp((s) => s.setTargets);
  const options = useApp((s) => s.options);
  const setOptions = useApp((s) => s.setOptions);
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const [plan, setPlan] = useState<SendPlan | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [opId, setOpId] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ diff: DiffResult | null; loading: boolean; error?: string }>({ diff: null, loading: false });

  const run = async () => {
    const taskId = newTaskId();
    useApp.setState({ planning: { taskId, message: t('Karşılaştırılıyor…') } });
    try {
      const p = await api.planSend({ sources: sendPaths.map((path) => ({ kind: 'fs', path })), targetIds: targets, options: { ...options, dryRun: true }, origin: 'send', label: t('Karşılaştırma') }, taskId);
      if (useApp.getState().planning?.taskId !== taskId) return; // cancelled
      setPlan(p);
      setTargetId((cur) => (cur && p.targets.some((x) => x.targetId === cur) ? cur : p.targets[0]?.targetId ?? null));
      setOpId(null);
    } catch (e) {
      if (!(e as Error).message.includes(t('İptal edildi'))) toast('error', t('Karşılaştırılamadı'), (e as Error).message);
    } finally {
      useApp.setState((s) => (s.planning?.taskId === taskId ? { planning: null } : {}));
    }
  };

  const tp = plan?.targets.find((x) => x.targetId === targetId) ?? null;
  const ops = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tp?.ops ?? []).filter((o) => o.kind !== 'mkdir' && (filter === 'all' || o.category === filter || (filter === 'extra' && o.category === 'deleted')) && (!q || o.rel.toLowerCase().includes(q)));
  }, [tp, filter, query]);
  const op = ops.find((o) => o.id === opId) ?? null;

  useEffect(() => {
    if (!op || !tp) return setDiff({ diff: null, loading: false });
    if (op.isDir) return setDiff({ diff: null, loading: false, error: t('Klasörün içeriği listede ayrı satırlar olarak görünür.') });
    const src = srcFor(op);
    if (!src && op.category !== 'extra' && op.category !== 'deleted') return setDiff({ diff: null, loading: false, error: t('Kaynak okunamıyor') });
    setDiff({ diff: null, loading: true });
    let live = true;
    api
      .compareWithTarget(src ?? { kind: 'delete', path: op.rel }, tp.targetId, op.rel)
      .then((d) => live && setDiff({ diff: d, loading: false }))
      .catch((e) => live && setDiff({ diff: null, loading: false, error: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [op?.id, tp?.targetId]);

  const sendThese = () => {
    if (!plan) return;
    const selected: Record<string, Set<string>> = {};
    for (const x of plan.targets) selected[x.targetId] = new Set(x.ops.filter((o) => o.selected).map((o) => o.id));
    useApp.setState({ review: { plan: { ...plan, request: { ...plan.request, options: { ...plan.request.options, dryRun: false } } }, selected } });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t('Karşılaştır')}</h1>
          <div className="sub">{t('Gönder sayfasındaki kaynakları hedeflerle karşılaştırın ve dosya dosya farklara bakın. Hiçbir şey gönderilmez.')}</div>
        </div>
        <Segmented value={options.compare} onChange={(compare) => setOptions({ compare })} options={compareOptions()} />
        <Button size="lg" variant="primary" icon={<Play size={15} />} disabled={!sendPaths.length || !targets.length} onClick={() => void run()}>
          {plan ? t('Yeniden karşılaştır') : t('Karşılaştır')}
        </Button>
      </div>
      <div className="page-body fill">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 32%) minmax(0, 1fr)', gap: 14, minHeight: 0, height: '100%' }}>
          <div className="col" style={{ gap: 14, minHeight: 0 }}>
            <div className="card">
              <div className="card-head">
                <h2>{t('Kaynaklar')}</h2>
                <span className="hint">{t('{n} öğe', { n: sendPaths.length })}</span>
                <span className="spacer" />
                <Button size="sm" variant="ghost" onClick={() => setPage('send')}>
                  {t('Düzenle')}
                </Button>
              </div>
              <div style={{ maxHeight: 120, overflow: 'auto', padding: '0 12px 10px' }}>
                {sendPaths.length ? (
                  sendPaths.map((p) => (
                    <div key={p} className="row mono ellipsis" style={{ fontSize: 11.5, gap: 6 }} title={p}>
                      <Folder size={12} className="faint" /> <span className="ellipsis">{p}</span>
                    </div>
                  ))
                ) : (
                  <div className="faint" style={{ fontSize: 12.5 }}>{t('Gönder sayfasında dosya ya da klasör ekleyin.')}</div>
                )}
              </div>
            </div>
            <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <TargetPicker value={targets} onChange={setTargets} />
            </div>
          </div>

          <div className="card" style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!plan ? (
              <Empty icon={<GitCompare size={22} />} title={t('Henüz karşılaştırma yok')}>
                {t('Kaynakları ve hedefleri seçip Karşılaştır’a basın.')}
              </Empty>
            ) : (
              <>
                <div className="row" style={{ gap: 6, padding: '10px 12px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
                  {plan.targets.map((x) => {
                    const n = x.ops.filter((o) => o.kind !== 'mkdir' && o.category !== 'same').length;
                    return (
                      <Button key={x.targetId} size="sm" variant={x.targetId === targetId ? 'primary' : 'default'} icon={x.reachable ? undefined : <WifiOff size={12} />} onClick={() => (setTargetId(x.targetId), setOpId(null))}>
                        {x.targetName} {x.reachable && <span className="badge">{n}</span>}
                      </Button>
                    );
                  })}
                  <span className="spacer" />
                  <Button size="sm" icon={<Send size={13} />} onClick={sendThese}>
                    {t('Bu farkları gönder…')}
                  </Button>
                </div>
                {tp && !tp.reachable ? (
                  <div className="alert warn" style={{ margin: 12 }}>
                    <WifiOff size={15} /> {tp.error || t('Hedefe erişilemiyor')}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 38%) minmax(0, 1fr)', minHeight: 0, flex: 1 }}>
                    <div className="col" style={{ minHeight: 0, borderRight: '1px solid var(--border)' }}>
                      <div className="col" style={{ gap: 8, padding: 10 }}>
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {FILTERS.map((f) => (
                            <Button key={f.value} size="sm" variant={filter === f.value ? 'primary' : 'ghost'} onClick={() => setFilter(f.value)}>
                              {t(f.label)}
                            </Button>
                          ))}
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <Search size={13} className="faint" />
                          <input className="input sm grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Dosya ara')} />
                        </div>
                      </div>
                      <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>
                        {ops.length ? (
                          ops.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              className={cls('list-row', o.id === opId && 'active')}
                              style={{ width: '100%', textAlign: 'left', gap: 8, border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', background: o.id === opId ? 'var(--bg-active)' : 'transparent' }}
                              onClick={() => setOpId(o.id)}
                            >
                              <span className={cls('badge', CAT_COLOR[o.category])} style={{ minWidth: 18, justifyContent: 'center' }}>
                                {SIGN[o.category]}
                              </span>
                              {o.isDir ? <Folder size={13} className="faint" /> : <FileText size={13} className="faint" />}
                              <span className="mono ellipsis grow" style={{ fontSize: 12 }} title={o.rel}>
                                {o.rel}
                              </span>
                              <span className="faint" style={{ fontSize: 11 }}>
                                {o.isDir ? '' : bytes(o.size)}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="faint" style={{ padding: 16, fontSize: 12.5 }}>{tp?.ops.length ? t('Bu süzgece uyan dosya yok.') : t('Bu hedef kaynaklarla aynı.')}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      {op ? (
                        <DiffView
                          diff={diff.diff}
                          loading={diff.loading}
                          error={diff.error}
                          title={
                            <span className="muted" style={{ fontSize: 12.5 }}>
                              {opStatus(op, op.selected)} •{' '}
                              {tx('{target} {name} → {source} yazılacak içerik', { target: <span className="badge red">{t('hedef')}</span>, source: <span className="badge green">{t('kaynak')}</span> }, { name: tp?.targetName ?? '' })}
                            </span>
                          }
                        />
                      ) : (
                        <Empty icon={<FileText size={22} />} title={t('Bir dosya seçin')}>
                          {t('Soldaki listeden bir dosyaya tıklayınca hedefteki ile kaynaktaki hâlinin farkı burada görünür.')}
                        </Empty>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
