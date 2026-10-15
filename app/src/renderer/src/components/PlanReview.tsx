import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeftRight, CheckCircle2, ClipboardList, FlaskConical, Send, WifiOff, AlertTriangle, Copy, HardDrive, FolderPlus } from 'lucide-react';
import type { PlanCategory, PlanOp, TargetPlan, DiffResult, SourceSpec } from '@shared/types';
import { useApp } from '../store/app';
import { Button, Checkbox, Modal, SearchInput, Progress, Switch } from './ui';
import { DiffView } from './DiffView';
import { api } from '../lib/api';
import { bytes, cls, duration, num, shortDateTime, splitPath } from '../lib/format';
import { tx } from '../lib/i18n';
import { t, tk } from '@shared/i18n';

export const SIGN: Record<PlanCategory, string> = { new: '+', changed: '~', targetNewer: '!', extra: '−', deleted: '−', same: '=' };

export function opStatus(op: PlanOp, selected: boolean): string {
  switch (op.category) {
    case 'new':
      return op.isDir ? t('yeni klasör') : t('yeni');
    case 'changed':
      return op.replaceType ? t('tür değişecek') : t('güncellenecek');
    case 'targetNewer':
      return selected ? t('hedef daha yeni — üzerine yazılacak') : t('hedef daha yeni — atlanacak');
    case 'extra':
      return selected ? t('hedefte fazla — silinecek') : t('hedefte fazla');
    case 'deleted':
      return selected ? t('silinecek') : t('silinmiş (atlanacak)');
    default:
      return t('aynı');
  }
}

type Filter = 'all' | 'new' | 'changed' | 'targetNewer' | 'remove';

const FILTERS: { id: Filter; label: string; match: (o: PlanOp) => boolean }[] = [
  { id: 'all', label: tk('Tümü'), match: () => true },
  { id: 'new', label: tk('Yeni'), match: (o) => o.category === 'new' },
  { id: 'changed', label: tk('Değişen'), match: (o) => o.category === 'changed' },
  { id: 'targetNewer', label: tk('Hedef daha yeni'), match: (o) => o.category === 'targetNewer' },
  { id: 'remove', label: tk('Fazla / silinecek'), match: (o) => o.category === 'extra' || o.category === 'deleted' },
];

export function PlanningOverlay() {
  const planning = useApp((s) => s.planning);
  const cancel = useApp((s) => s.cancelPlan);
  if (!planning) return null;
  const pct = planning.total ? ((planning.done ?? 0) / planning.total) * 100 : 0;
  return (
    <div className="scrim">
      <div className="modal" style={{ width: 420 }}>
        <div className="modal-body" style={{ padding: 24 }}>
          <div className="row" style={{ gap: 14, marginBottom: 16 }}>
            <div className="icon-tile accent lg">
              <ClipboardList size={18} />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 650, fontSize: 14.5 }}>{t('Hedefler inceleniyor')}</div>
              <div className="muted ellipsis" style={{ fontSize: 12.5 }}>
                {planning.message}
              </div>
            </div>
          </div>
          <Progress value={pct} indeterminate={!planning.total} />
          <div className="row" style={{ marginTop: 14 }}>
            <span className="faint" style={{ fontSize: 12 }}>
              {t('Hedeflere hiçbir şey yazılmaz.')}
            </span>
            <span className="spacer" />
            <Button size="sm" onClick={cancel}>
              {t('Vazgeç')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PlanReview() {
  const review = useApp((s) => s.review);
  const close = useApp((s) => s.closeReview);
  const setSel = useApp((s) => s.setReviewSelection);
  const execute = useApp((s) => s.executeReview);
  const [active, setActive] = useState<string | null>(null);
  const [dry, setDry] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = review?.plan;
  const selected = review?.selected ?? {};
  const targets = plan?.targets ?? [];
  useEffect(() => setActive(null), [plan?.id]);
  const current =
    targets.find((tp) => tp.targetId === active) ?? targets.find((tp) => tp.reachable && tp.ops.length) ?? targets.find((tp) => tp.reachable) ?? targets[0];

  const totals = useMemo(() => {
    const r = { new: 0, changed: 0, targetNewer: 0, remove: 0, same: 0, ops: 0, bytes: 0, targets: 0, unreachable: 0 };
    for (const tp of targets) {
      if (!tp.reachable) {
        r.unreachable++;
        continue;
      }
      const sel = selected[tp.targetId] ?? new Set();
      let any = false;
      for (const o of tp.ops) {
        if (!sel.has(o.id)) continue;
        any = true;
        r.ops++;
        if (o.kind === 'copy') r.bytes += o.size;
        if (o.category === 'new') r.new++;
        else if (o.category === 'changed') r.changed++;
        else if (o.category === 'targetNewer') r.targetNewer++;
        else if (o.category === 'extra' || o.category === 'deleted') r.remove++;
      }
      r.same += tp.counts.same;
      if (any) r.targets++;
    }
    return r;
  }, [targets, selected]);

  if (!review || !plan) return null;
  const dryRun = dry ?? plan.request.options.dryRun;

  const applyToAll = () => {
    if (!current) return;
    const cur = selected[current.targetId];
    const chosen = new Set(current.ops.filter((o) => cur.has(o.id)).map((o) => `${o.kind}|${o.rel.toLowerCase()}`));
    const known = new Set(current.ops.map((o) => `${o.kind}|${o.rel.toLowerCase()}`));
    for (const tp of targets) {
      if (tp === current || !tp.reachable) continue;
      const next = new Set<string>();
      for (const o of tp.ops) {
        const k = `${o.kind}|${o.rel.toLowerCase()}`;
        if (known.has(k) ? chosen.has(k) : (selected[tp.targetId]?.has(o.id) ?? false)) next.add(o.id);
      }
      setSel(tp.targetId, next);
    }
  };

  return (
    <Modal
      size="wide"
      closeOnScrim={false}
      title={
        <span className="row" style={{ gap: 10 }}>
          {t('Gönderim planı')}
          <span className="badge">{plan.request.label || (plan.request.origin === 'git' ? 'Git' : t('Gönder'))}</span>
          <span className="faint" style={{ fontSize: 12.5, fontWeight: 500 }}>
            {t('{n} kaynak', { n: plan.sources.length })} → {t('{n} hedef', { n: targets.length })} • {t('{time} içinde incelendi', { time: duration(plan.durationMs) })}
          </span>
        </span>
      }
      icon={
        <div className="icon-tile accent">
          <ClipboardList size={16} />
        </div>
      }
      onClose={close}
      footer={
        <>
          <span className="tabular">
            {tx('{ops} işlem • {size} • {n} hedef', { ops: <b>{num(totals.ops)}</b>, size: <b>{bytes(totals.bytes)}</b>, n: <b>{totals.targets}</b> }, { opsCount: totals.ops, count: totals.targets })}
          </span>
          {totals.unreachable > 0 && <span className="badge red">{t('{n} erişilemedi', { n: totals.unreachable })}</span>}
          <span className="spacer" />
          <label className="check-label" onClick={() => setDry(!dryRun)}>
            <Switch on={dryRun} onChange={(v) => setDry(v)} />
            <FlaskConical size={14} /> {t('Deneme (yazma)')}
          </label>
          <Button onClick={close}>{t('Vazgeç')}</Button>
          <Button
            variant="primary"
            size="lg"
            icon={<Send size={15} />}
            disabled={!totals.ops}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await execute(dryRun);
              setBusy(false);
              setDry(null);
            }}
          >
            {dryRun ? t('Denemeyi başlat') : t('Gönder')}
          </Button>
        </>
      }
    >
      <div className="plan">
        <div className="plan-stats">
          <Stat label={t('Yeni')} value={totals.new} cls="new" />
          <Stat label={t('Güncellenecek')} value={totals.changed} cls="changed" />
          <Stat label={t('Hedef daha yeni')} value={totals.targetNewer} cls="targetNewer" />
          <Stat label={t('Silinecek')} value={totals.remove} cls="deleted" />
          <Stat label={t('Aynı (atlanır)')} value={totals.same} cls="same" />
          <Stat label={t('Yazılacak veri')} value={bytes(totals.bytes)} cls="bytes" />
        </div>
        {plan.warnings.length > 0 && (
          <div className="alert warn" style={{ marginBottom: 12 }}>
            <AlertTriangle size={16} />
            <div>
              <b>{t('Dikkat')}</b>
              <ul>
                {plan.warnings.slice(0, 6).map((w, i) => (
                  <li key={i} className="selectable">
                    {w}
                  </li>
                ))}
                {plan.warnings.length > 6 && <li>{t('… ve {n} uyarı daha', { n: plan.warnings.length - 6 })}</li>}
              </ul>
            </div>
          </div>
        )}
        <div className="plan-split">
          <div className="plan-targets">
            {targets.map((tp) => {
              const sel = selected[tp.targetId] ?? new Set();
              return (
                <button key={tp.targetId} className={cls('plan-target', current?.targetId === tp.targetId && 'active', !tp.reachable && 'down')} onClick={() => setActive(tp.targetId)}>
                  <div className="row">
                    <span className={cls('dot', tp.reachable ? 'ok' : 'bad')} />
                    <span className="ellipsis grow" style={{ fontWeight: 580 }}>
                      {tp.targetName}
                    </span>
                    {tp.reachable && <span className="faint tabular" style={{ fontSize: 11.5 }}>{sel.size}</span>}
                  </div>
                  {tp.reachable ? (
                    <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                      {tp.counts.new > 0 && <span className="badge green">+{tp.counts.new}</span>}
                      {tp.counts.changed > 0 && <span className="badge blue">~{tp.counts.changed}</span>}
                      {tp.counts.targetNewer > 0 && <span className="badge amber">!{tp.counts.targetNewer}</span>}
                      {tp.counts.extra + tp.counts.deleted > 0 && <span className="badge violet">−{tp.counts.extra + tp.counts.deleted}</span>}
                      {tp.ops.length === 0 && <span className="badge">{t('güncel')}</span>}
                    </div>
                  ) : (
                    <div className="faint ellipsis" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {tp.error}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {current && <TargetOps key={current.targetId} plan={current} selected={selected[current.targetId] ?? new Set()} onChange={(s) => setSel(current.targetId, s)} sources={plan.request.sources} onApplyAll={targets.length > 1 ? applyToAll : undefined} />}
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value, cls: c }: { label: string; value: number | string; cls: string }) {
  return (
    <div className={cls('plan-stat', c)}>
      <div className="k">{label}</div>
      <div className="v">{typeof value === 'number' ? num(value) : value}</div>
    </div>
  );
}

function TargetOps({
  plan,
  selected,
  onChange,
  sources,
  onApplyAll,
}: {
  plan: TargetPlan;
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  sources: SourceSpec[];
  onApplyAll?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [diffOp, setDiffOp] = useState<PlanOp | null>(null);
  const parent = useRef<HTMLDivElement>(null);

  const ql = q.trim().toLowerCase();
  const f = FILTERS.find((x) => x.id === filter)!;
  const rows = useMemo(() => plan.ops.filter((o) => f.match(o) && (!ql || o.rel.toLowerCase().includes(ql))), [plan.ops, f, ql]);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 34, overscan: 20 });

  if (!plan.reachable)
    return (
      <div className="plan-ops">
        <div className="empty" style={{ flex: 1 }}>
          <div className="empty-icon">
            <WifiOff size={22} />
          </div>
          <h3>{t('{name} erişilemedi', { name: plan.targetName })}</h3>
          <p className="selectable">{plan.error}</p>
          <p className="faint mono" style={{ fontSize: 11.5 }}>
            {plan.root}
          </p>
        </div>
      </div>
    );

  const visSel = rows.filter((o) => selected.has(o.id)).length;
  const toggle = (op: PlanOp, on: boolean) => {
    const next = new Set(selected);
    const affected = op.isDir && op.kind !== 'mkdir' ? plan.ops.filter((o) => o === op || o.rel.toLowerCase().startsWith(op.rel.toLowerCase() + '/')) : [op];
    for (const o of affected) on ? next.add(o.id) : next.delete(o.id);
    // a skipped new folder takes its new contents with it
    if (op.kind === 'mkdir' && !on) for (const o of plan.ops) if (o.rel.toLowerCase().startsWith(op.rel.toLowerCase() + '/') && o.category === 'new') next.delete(o.id);
    onChange(next);
  };
  const setAll = (on: boolean) => {
    const next = new Set(selected);
    for (const o of rows) on ? next.add(o.id) : next.delete(o.id);
    onChange(next);
  };

  const srcFor = (op: PlanOp): SourceSpec | null => {
    if (!op.src) return null;
    if (op.src.kind === 'fs') return { kind: 'fs', path: op.src.abs };
    if (op.src.kind === 'git') return { kind: 'git', repo: op.src.repo, rev: op.src.rev, path: op.src.path };
    return null;
  };

  return (
    <div className="plan-ops">
      <div className="plan-ops-head">
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <b style={{ fontSize: 14 }}>{plan.targetName}</b>
            <span className="faint">{t('{n} değişiklik', { n: num(plan.ops.length) })}</span>
            {plan.counts.same > 0 && <span className="badge">{t('{n} aynı', { n: num(plan.counts.same) })}</span>}
          </div>
          <div className="row faint mono" style={{ fontSize: 11.5 }}>
            <HardDrive size={12} /> <span className="ellipsis selectable">{plan.root}</span>
            {plan.freeBytes != null && <span className="nowrap">• {t('{size} boş', { size: bytes(plan.freeBytes) })}</span>}
          </div>
        </div>
        <span className="spacer" />
        {onApplyAll && (
          <Button size="sm" icon={<Copy size={13} />} onClick={onApplyAll} tip={t('Bu hedefte düşürdüğünüz/eklediğiniz öğeleri diğer hedeflerde de aynı yapar')}>
            {t('Seçimi tüm hedeflere uygula')}
          </Button>
        )}
      </div>
      <div className="row" style={{ padding: '8px 12px', gap: 6, borderBottom: '1px solid var(--border)' }}>
        {FILTERS.map((x) => {
          const n = plan.ops.filter(x.match).length;
          if (x.id !== 'all' && !n) return null;
          return (
            <button key={x.id} className={cls('chip', filter === x.id && 'on')} onClick={() => setFilter(x.id)}>
              {t(x.label)} <span className="faint tabular">{num(n)}</span>
            </button>
          );
        })}
        <span className="spacer" />
        <SearchInput value={q} onChange={setQ} placeholder={t('Yolda ara')} style={{ width: 200 }} />
      </div>
      {rows.length === 0 ? (
        <div className="empty" style={{ flex: 1 }}>
          <div className="empty-icon">
            <CheckCircle2 size={22} color="var(--green)" />
          </div>
          <h3>{plan.ops.length ? t('Filtreye uyan öğe yok') : t('Bu hedef zaten güncel')}</h3>
          {!plan.ops.length && <p>{t('Kaynaktaki her şey hedefte aynı; gönderilecek bir şey yok.')}</p>}
        </div>
      ) : (
        <>
          <div className="table-head">
            <Checkbox checked={visSel === rows.length} mixed={visSel > 0 && visSel < rows.length} onChange={setAll} />
            <span style={{ width: 20 }} />
            <span className="grow">{t('Göreli yol')}</span>
            <span style={{ width: 210 }}>{t('Durum')}</span>
            <span style={{ width: 80, textAlign: 'right' }}>{t('Boyut')}</span>
            <span style={{ width: 170 }}>{t('Kaynak → hedef tarihi')}</span>
            <span style={{ width: 28 }} />
          </div>
          <div ref={parent} className="plan-ops-scroll">
            <div style={{ height: v.getTotalSize(), position: 'relative' }}>
              {v.getVirtualItems().map((vi) => {
                const o = rows[vi.index];
                const on = selected.has(o.id);
                const { dir, name } = splitPath(o.rel);
                const canDiff = o.kind === 'copy' && !o.isDir && o.dstSize != null;
                return (
                  <div key={o.id} className={cls('list-row', 'op-row', !on && 'off')} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size }} onClick={() => toggle(o, !on)}>
                    <Checkbox checked={on} onChange={(val) => toggle(o, val)} />
                    <span className={cls('sign', o.category)}>{o.isDir && o.category === 'new' ? <FolderPlus size={12} /> : SIGN[o.category]}</span>
                    <span className="path grow" title={o.note ? `${o.rel}\n${o.note}` : o.rel}>
                      {dir && <span className="dir">{'\u200e' + dir + '\u200e'}</span>}
                      <span className="name">
                        {name}
                        {o.isDir ? '/' : ''}
                      </span>
                    </span>
                    <span className={cls('op-status', o.category)} style={{ width: 210 }}>
                      {opStatus(o, on)}
                    </span>
                    <span className="faint tabular" style={{ width: 80, textAlign: 'right' }}>
                      {o.isDir ? '' : bytes(o.kind === 'delete' ? o.dstSize ?? o.size : o.size)}
                    </span>
                    <span className="faint tabular nowrap" style={{ width: 170, fontSize: 11.5 }}>
                      {o.srcMtime ? shortDateTime(o.srcMtime) : '–'} → {o.dstMtime ? shortDateTime(o.dstMtime) : '–'}
                    </span>
                    <span style={{ width: 28 }}>
                      {canDiff && (
                        <button
                          className="btn ghost icon sm"
                          data-tip={t('Kaynak ile hedefi karşılaştır')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDiffOp(o);
                          }}
                        >
                          <ArrowLeftRight size={13} />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {diffOp && <CompareModal op={diffOp} targetId={plan.targetId} targetName={plan.targetName} src={srcFor(diffOp)} onClose={() => setDiffOp(null)} />}
    </div>
  );
}

export function CompareModal({ op, targetId, targetName, src, onClose }: { op: PlanOp; targetId: string; targetName: string; src: SourceSpec | null; onClose: () => void }) {
  const [state, setState] = useState<{ diff: DiffResult | null; loading: boolean; error?: string }>({ diff: null, loading: true });
  useEffect(() => {
    if (!src) {
      setState({ diff: null, loading: false, error: t('Kaynak okunamıyor') });
      return;
    }
    api
      .compareWithTarget(src, targetId, op.rel)
      .then((diff) => setState({ diff, loading: false }))
      .catch((e) => setState({ diff: null, loading: false, error: (e as Error).message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(src), targetId, op.rel]);
  return (
    <Modal
      size="wide"
      title={
        <span className="row" style={{ gap: 8 }}>
          {t('Karşılaştır')} <span className="faint mono" style={{ fontSize: 12, fontWeight: 500 }}>{op.rel}</span>
        </span>
      }
      icon={
        <div className="icon-tile accent">
          <ArrowLeftRight size={16} />
        </div>
      }
      onClose={onClose}
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DiffView
          diff={state.diff}
          loading={state.loading}
          error={state.error}
          title={
            <span className="muted" style={{ fontSize: 12.5 }}>
              {tx('{target} {name} → {source} yazılacak içerik', { target: <span className="badge red">{t('hedef')}</span>, source: <span className="badge green">{t('kaynak')}</span> }, { name: targetName })}
            </span>
          }
        />
      </div>
    </Modal>
  );
}
