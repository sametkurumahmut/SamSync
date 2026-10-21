import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeftRight, CheckCircle2, ClipboardList, FlaskConical, Send, WifiOff, AlertTriangle, Copy, HardDrive, FolderPlus, Share2, ListTree, List, ChevronRight, ChevronDown, Folder, UnfoldVertical, FoldVertical, Layers, CalendarClock } from 'lucide-react';
import type { PlanCategory, PlanOp, PlanTargetProgress, TargetPlan, DiffResult, SourceSpec } from '@shared/types';
import { useApp } from '../store/app';
import { Button, Checkbox, Field, Modal, SearchInput, Progress, Switch } from './ui';
import { DiffView } from './DiffView';
import { MOD } from './Shortcuts';
import { api } from '../lib/api';
import { ago, bytes, cls, duration, num, shortDateTime, splitPath } from '../lib/format';
import { allFolders, buildOpTree, defaultExpanded, flattenTree, type TreeNode, type TreeRow } from '../lib/optree';
import { readStored, writeStored } from '../lib/persist';
import { tx } from '../lib/i18n';
import { locale, t, tk } from '@shared/i18n';
import { MODE_OPTIONS } from '../pages/SendPage';
import { BusyBadge } from './BusyBadge';

export const SIGN: Record<PlanCategory, string> = { new: '+', changed: '~', targetNewer: '!', extra: '−', deleted: '−', same: '=' };

/**
 * A staged send: the machines picked here get it first, the others once these went through (and their health
 * check said yes); then by themselves, or after a go in the run window. Off unless switched on for this send.
 */
/** "Send later": the reviewed send at a time of its own, planned again then; the machines that are off can be woken before. */
function LaterModal({ planId, onClose, onDone }: { planId: string; onClose: () => void; onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  // tonight at 22:00, or in an hour when that has passed
  const initial = (() => {
    const d = new Date();
    d.setHours(22, 0, 0, 0);
    if (d.getTime() < Date.now() + 10 * 60_000) d.setTime(Date.now() + 3600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [when, setWhen] = useState(initial);
  const [wake, setWake] = useState(false);
  const [busy, setBusy] = useState(false);
  const at = new Date(when).getTime();
  const save = async () => {
    setBusy(true);
    try {
      await api.scheduleSend(planId, at, wake);
      toast('ok', t('Gönderim zamanlandı'), new Date(at).toLocaleString(locale()));
      onDone();
    } catch (e) {
      toast('error', t('Zamanlanamadı'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Sonra gönder')}
      icon={<CalendarClock size={16} />}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Vazgeç')}</Button>
          <Button variant="primary" loading={busy} disabled={!Number.isFinite(at) || at < Date.now()} onClick={() => void save()}>
            {t('Zamanla')}
          </Button>
        </>
      }
    >
      <Field label={t('Ne zaman')} help={t('Bu bilgisayar o saatte açık ve SamSync çalışıyor olmalı; kaçırılan saat SamSync açılınca çalışır.')}>
        <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <label className="check-label" style={{ marginTop: 10 }} onClick={() => setWake(!wake)}>
        <Switch on={wake} onChange={(v) => setWake(v)} />
        {t('Kapalı makineleri 5 dakika önce uyandır')}
      </label>
      <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
        {t('O saatte kaynaklar yeniden karşılaştırılır ve bütün farklar gönderilir; burada kaldırdığınız satırlar dikkate alınmaz.')}
      </p>
    </Modal>
  );
}

function StagesCard({ targets, selected }: { targets: TargetPlan[]; selected: Record<string, Set<string>> }) {
  const stages = useApp((s) => s.review?.stages);
  const setStages = useApp((s) => s.setReviewStages);
  // machines written to from here (a relay takes its group along); one with nothing to write is not worth a stage
  const eligible = targets.filter((tp) => !tp.via && tp.reachable && ((selected[tp.targetId]?.size ?? 0) > 0 || targets.some((x) => x.via === tp.targetId)));
  if (eligible.length < 2) return null;
  const on = !!stages;
  const first = new Set(stages?.first ?? []);
  const toggle = (id: string) => {
    const next = new Set(first);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // at least one first, and never all of them
    if (next.size === 0 || next.size >= eligible.length) return;
    setStages({ first: [...next], auto: stages?.auto ?? false });
  };
  return (
    <div className={cls('stages-card', on && 'on')}>
      <div className="row" style={{ gap: 8 }}>
        <Layers size={15} className="faint" />
        <div className="grow">
          <b style={{ fontSize: 12.5 }}>{t('Aşamalı gönder')}</b>
          <div className="faint" style={{ fontSize: 12 }}>
            {t('Önce seçtiğiniz makinelere gider; onlar sorunsuz biterse ötekilere')}
          </div>
        </div>
        <Switch on={on} label={t('Aşamalı gönder')} onChange={(v) => setStages(v ? { first: [eligible[0].targetId], auto: false } : undefined)} />
      </div>
      {on && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <span className="faint" style={{ fontSize: 12 }}>
              {t('Önce:')}
            </span>
            {eligible.map((tp) => (
              <button key={tp.targetId} className={cls('chip', first.has(tp.targetId) && 'on')} aria-pressed={first.has(tp.targetId)} onClick={() => toggle(tp.targetId)}>
                {tp.targetName}
                {targets.some((x) => x.via === tp.targetId) ? ` + ${t('grubu')}` : ''}
              </button>
            ))}
          </div>
          <label className="check-label" style={{ marginTop: 8 }} onClick={() => setStages({ first: [...first], auto: !stages!.auto })}>
            <Switch on={stages!.auto} onChange={(v) => setStages({ first: [...first], auto: v })} />
            {t('Sorunsuz biterse ötekilere kendiliğinden geç (kapalıyken çalıştırma penceresinden onay beklenir)')}
          </label>
        </>
      )}
    </div>
  );
}

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

/** What one target is doing while the review is prepared, in a few words. */
function targetStep(x: PlanTargetProgress): string {
  switch (x.phase) {
    case 'wait':
      return t('sırada');
    case 'probe':
      return t('erişim deneniyor');
    case 'scan':
      return t('hedefteki klasörler listeleniyor: {n} öğe', { n: num(x.listed ?? 0) });
    case 'compare': {
      const files = t('{done} / {total} dosya karşılaştırıldı', { done: num(Math.min(x.done, x.total)), total: num(x.total) });
      return x.read ? `${files} • ${t('{size} içerik okundu', { size: bytes(x.read) })}` : files;
    }
    case 'done':
      return x.read ? `${t('bitti')} • ${t('{size} içerik okundu', { size: bytes(x.read) })}` : t('bitti');
    case 'failed':
      return t('erişilemedi');
  }
}

export function PlanningOverlay() {
  const planning = useApp((s) => s.planning);
  const cancel = useApp((s) => s.cancelPlan);
  if (!planning) return null;
  const pct = planning.total ? ((planning.done ?? 0) / planning.total) * 100 : 0;
  const targets = planning.targets ?? [];
  return (
    <div className="scrim">
      <div className="modal" style={{ width: targets.length ? 520 : 420 }}>
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
          {targets.length > 0 && (
            <div className="plan-progress" role="list" aria-label={t('Hedeflerin durumu')}>
              {targets.map((x) => {
                const share = x.phase === 'done' || x.phase === 'failed' ? 100 : x.total ? Math.min(100, (x.done / x.total) * 100) : 0;
                return (
                  <div key={x.id} role="listitem" className={cls('plan-progress-row', x.phase === 'failed' && 'failed', x.phase === 'done' && 'done')}>
                    <span className="name ellipsis">{x.name}</span>
                    <span className="step ellipsis">{targetStep(x)}</span>
                    <span className="pct tabular">{Math.floor(share)}%</span>
                  </div>
                );
              })}
            </div>
          )}
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
  const [later, setLater] = useState(false);

  const plan = review?.plan;
  const selected = review?.selected ?? {};
  const targets = plan?.targets ?? [];
  useEffect(() => setActive(null), [plan?.id]);
  // Ctrl Enter sends, Ctrl Shift Enter runs it as a dry run
  const runRef = useRef<((asDry: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    if (!plan) return;
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      e.preventDefault();
      void runRef.current?.(e.shiftKey);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [plan]);
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
  const run = async (asDry: boolean) => {
    if (busy || !totals.ops) return;
    setBusy(true);
    await execute(asDry);
    setBusy(false);
    setDry(null);
  };
  runRef.current = run;

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
          {!dryRun && (
            <Button icon={<CalendarClock size={14} />} disabled={!totals.ops} tip={t('Bu gönderimi seçtiğiniz bir saatte yapar')} onClick={() => setLater(true)}>
              {t('Sonra gönder…')}
            </Button>
          )}
          {later && <LaterModal planId={plan.id} onClose={() => setLater(false)} onDone={() => {
                setLater(false);
                close();
              }} />}
          <Button
            variant="primary"
            size="lg"
            icon={<Send size={15} />}
            disabled={!totals.ops}
            loading={busy}
            tip={`${MOD} Enter`}
            onClick={() => void run(dryRun)}
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
        {!dryRun && <StagesCard targets={targets} selected={selected} />}
        <div className="plan-split">
          <div className="plan-targets">
            {targets.map((tp) => {
              const sel = selected[tp.targetId] ?? new Set();
              return (
                <button key={tp.targetId} className={cls('plan-target', current?.targetId === tp.targetId && 'active', !tp.reachable && 'down')} onClick={() => setActive(tp.targetId)}>
                  <div className="row">
                    <span className={cls('dot', !tp.reachable ? 'bad' : tp.busyBy?.length ? 'busy' : 'ok')} />
                    <span className="ellipsis grow" style={{ fontWeight: 580 }}>
                      {tp.targetName}
                    </span>
                    {tp.reachable && !!tp.busyBy?.length && <BusyBadge nodeId={tp.targetId} name={tp.targetName} programs={tp.busyBy} held={tp.held} small />}
                    {tp.reachable && <span className="faint tabular" style={{ fontSize: 11.5 }}>{sel.size}</span>}
                  </div>
                  {(tp.mode !== plan.request.options.mode || tp.backup !== plan.request.options.backup) && (
                    <div className="row" style={{ gap: 4, marginTop: 4 }} data-tip={t('Bu hedefe özel kip ve yedek')}>
                      {tp.mode !== plan.request.options.mode && <span className={cls('badge', tp.mode === 'mirror' ? 'violet' : 'outline')}>{t(MODE_OPTIONS.find((m) => m.value === tp.mode)?.label ?? tp.mode)}</span>}
                      {tp.backup !== plan.request.options.backup && <span className={cls('badge', tp.backup ? 'blue' : 'outline')}>{tp.backup ? t('yedekli') : t('yedeksiz')}</span>}
                    </div>
                  )}
                  {tp.lock && (
                    <div className="row" style={{ gap: 4, marginTop: 4 }} data-tip={t('{user} ({host}) şu anda bu makineye yazıyor: {label}', { user: tp.lock.user, host: tp.lock.host, label: tp.lock.label })}>
                      <span className="badge amber">
                        <AlertTriangle size={11} /> {t('{user} yazıyor', { user: tp.lock.user })}
                      </span>
                    </div>
                  )}
                  {tp.via && tp.reachable ? (
                    <div className="row" style={{ gap: 4, marginTop: 6 }}>
                      <span className="badge violet">{t('{relay} üzerinden', { relay: targets.find((x) => x.targetId === tp.via)?.targetName ?? tp.via })}</span>
                    </div>
                  ) : tp.reachable ? (
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
  // the list as a folder tree or flat; the choice is kept
  const [view, setViewState] = useState<'tree' | 'flat'>(() => (readStored<string>('samsync.review.view', 'tree') === 'flat' ? 'flat' : 'tree'));
  const setView = (val: 'tree' | 'flat') => {
    setViewState(val);
    writeStored('samsync.review.view', val);
  };
  /** Folders the user unfolded; null until touched, then the first level opens by itself. */
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  const ql = q.trim().toLowerCase();
  const f = FILTERS.find((x) => x.id === filter)!;
  const rows = useMemo(() => plan.ops.filter((o) => f.match(o) && (!ql || o.rel.toLowerCase().includes(ql))), [plan.ops, f, ql]);
  const tree = useMemo(() => (view === 'tree' ? buildOpTree(rows) : null), [rows, view]);
  const open = useMemo(() => expanded ?? new Set(tree ? defaultExpanded(tree) : []), [expanded, tree]);
  // while searching, every match stays in sight
  const isOpen = (p: string) => !!ql || open.has(p);
  const items = useMemo<TreeRow[]>(() => (tree ? flattenTree(tree, isOpen) : rows.map((op) => ({ kind: 'op', op, depth: 0 }))), [tree, rows, open, ql]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: () => 34, overscan: 20 });
  const toggleFolder = (p: string) => {
    const next = new Set(open);
    next.has(p) ? next.delete(p) : next.add(p);
    setExpanded(next);
  };
  const branchState = (n: TreeNode) => {
    const sel = n.all.filter((o) => selected.has(o.id)).length;
    return { all: sel === n.all.length && sel > 0, some: sel > 0 && sel < n.all.length, sel };
  };

  if (plan.via && plan.reachable)
    return (
      <div className="plan-ops">
        <div className="empty" style={{ flex: 1 }}>
          <div className="empty-icon">
            <Share2 size={22} />
          </div>
          <h3>{t('{name} dosyaları röle üzerinden alacak', { name: plan.targetName })}</h3>
          <p>{t('Dosyalar önce röle makinesine gider; oradaki SamSync karşılaştırıp bu makineye dağıtır. Sonuç gönderim bitince burada görünür.')}</p>
          <p className="faint mono" style={{ fontSize: 11.5 }}>
            {plan.root}
          </p>
        </div>
      </div>
    );
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
  const toggleBranch = (n: TreeNode, on: boolean) => {
    const next = new Set(selected);
    for (const o of n.all) on ? next.add(o.id) : next.delete(o.id);
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
            {plan.self && (
              <span className="badge accent" data-tip={t('Bu makinenin kendisi: dosyalar ağ paylaşımı yerine doğrudan yerel köke, kendi diskine yazılır')}>
                {t('bu makine')}
              </span>
            )}
            <span className="faint">{t('{n} değişiklik', { n: num(plan.ops.length) })}</span>
            {plan.counts.same > 0 && <span className="badge">{t('{n} aynı', { n: num(plan.counts.same) })}</span>}
            {plan.agent && (
              <span className="badge green" data-tip={t('SamSync orada çalışıyor: gönderimler sıkıştırılmış paket olarak gider, makine kendisi uygular')}>
                {t('ajan')}
              </span>
            )}
            {!!plan.agentHashed && (
              <span className="badge blue" data-tip={t('{n} dosyanın içerik özeti hedef makinede, kendi diskinde hesaplandı; bu dosyalar ağ üzerinden okunmadı', { n: num(plan.agentHashed) })}>
                {t('{n} özet orada', { n: num(plan.agentHashed) })}
              </span>
            )}
            {plan.fromManifest && (
              <>
                <span className="badge blue" data-tip={t('Hedefin klasörleri ağ üzerinden gezilmedi: SamSync’in {ago} bıraktığı manifestten alındı, bir örnekle doğrulandı. Karşılaştır sayfası her zaman doğrudan bakar.', { ago: ago(plan.fromManifest) })}>
                  {t('manifestten')}
                </span>
                <button
                  className="link-btn"
                  style={{ fontSize: 11.5 }}
                  data-tip={t('Bu incelemeyi kapatır ve hedefleri ağ üzerinden baştan tarayarak yeniden planlar')}
                  onClick={() => {
                    const st = useApp.getState();
                    const req = st.review?.plan.request;
                    if (!req) return;
                    st.closeReview();
                    void st.startPlan({ ...req, options: { ...req.options, fullScan: true } });
                  }}
                >
                  {t('Tam tara')}
                </button>
              </>
            )}
          </div>
          <div className="row faint mono" style={{ fontSize: 11.5 }}>
            <HardDrive size={12} />{' '}
            <span className="ellipsis selectable" title={plan.root}>
              {plan.root}
            </span>
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
      {plan.missingFromPack && plan.missingFromPack.length > 0 && (
        <div className="alert warn" style={{ margin: '8px 12px 0', fontSize: 12 }}>
          <AlertTriangle size={14} />
          <span>
            {t('Artımlı paket {n} dosyayı bu makinede bekliyordu ama yok ya da farklı: {files}. Bunlar için tam paket gerekir.', {
              n: plan.missingFromPack.length,
              files: plan.missingFromPack.slice(0, 5).join(', ') + (plan.missingFromPack.length > 5 ? ` +${plan.missingFromPack.length - 5}` : ''),
            })}
          </span>
        </div>
      )}
      {plan.inUse && plan.inUse.length > 0 && (
        <div className="alert warn" style={{ margin: '8px 12px 0', fontSize: 12 }}>
          <AlertTriangle size={14} />
          <span>
            {t('{n} dosya bu makinede kullanımda: {files}. Bir program açık tutuyor; kapatılmazsa bu dosyalar yazılamaz (içerik zaten aynıysa yalnızca tarihleri eşitlenir).', {
              n: plan.inUse.length,
              files: plan.inUse.slice(0, 5).join(', ') + (plan.inUse.length > 5 ? ` +${plan.inUse.length - 5}` : ''),
            })}
          </span>
        </div>
      )}
      {plan.lock && (
        <div className="alert warn" style={{ margin: '8px 12px 0', fontSize: 12 }}>
          <AlertTriangle size={14} />
          <span>{t('{user} ({host}) {ago} bu makineye yazmaya başladı: {label}. Aynı anda gönderirseniz iki gönderim aynı dosyalara yazabilir; bitmesini beklemek daha güvenli.', { user: plan.lock.user, host: plan.lock.host, ago: ago(plan.lock.startedAt), label: plan.lock.label })}</span>
        </div>
      )}
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
        {view === 'tree' && tree && (
          <>
            <Button size="sm" variant="ghost" iconOnly icon={<UnfoldVertical size={13} />} tip={t('Tümünü aç')} onClick={() => setExpanded(new Set(allFolders(tree)))} />
            <Button size="sm" variant="ghost" iconOnly icon={<FoldVertical size={13} />} tip={t('Tümünü kapat')} onClick={() => setExpanded(new Set())} />
          </>
        )}
        <span className="segmented sm" role="group">
          <button className={cls(view === 'tree' && 'on')} data-tip={t('Klasör ağacı')} onClick={() => setView('tree')}>
            <ListTree size={13} />
          </button>
          <button className={cls(view === 'flat' && 'on')} data-tip={t('Düz liste')} onClick={() => setView('flat')}>
            <List size={13} />
          </button>
        </span>
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
            <span style={{ width: 180 }}>{t('Durum')}</span>
            <span style={{ width: 80, textAlign: 'right' }}>{t('Boyut')}</span>
            <span style={{ width: 150 }}>{t('Kaynak → hedef tarihi')}</span>
            <span style={{ width: 28 }} />
          </div>
          <div ref={parent} className="plan-ops-scroll">
            <div style={{ height: v.getTotalSize(), position: 'relative' }}>
              {v.getVirtualItems().map((vi) => {
                const item = items[vi.index];
                const place = { position: 'absolute' as const, top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size };
                if (item.kind === 'folder') {
                  const n = item.node;
                  const st = branchState(n);
                  const isOn = isOpen(n.path);
                  return (
                    <div key={`d:${n.path}`} className={cls('list-row', 'op-row', 'tree-row', !st.all && !st.some && 'off')} style={{ ...place, paddingLeft: 12 + (n.depth - 1) * 18 }} onClick={() => toggleFolder(n.path)}>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={st.all} mixed={st.some} onChange={(val) => toggleBranch(n, val)} />
                      </span>
                      <span className="tree-chevron">{isOn ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                      <Folder size={13} className="tree-folder-icon" />
                      <span className="path grow" title={n.path}>
                        <span className="name">{n.label}</span>
                      </span>
                      <span className="row tree-counts" style={{ gap: 4 }}>
                        {n.counts.new > 0 && <span className="badge green">+{num(n.counts.new)}</span>}
                        {n.counts.changed > 0 && <span className="badge blue">~{num(n.counts.changed)}</span>}
                        {n.counts.targetNewer > 0 && <span className="badge amber">!{num(n.counts.targetNewer)}</span>}
                        {n.counts.remove > 0 && <span className="badge violet">{'\u2212' + num(n.counts.remove)}</span>}
                        <span className="faint tabular" style={{ fontSize: 11.5, marginLeft: 4 }}>
                          {st.sel === n.counts.ops ? num(n.counts.ops) : `${num(st.sel)}/${num(n.counts.ops)}`}
                        </span>
                      </span>
                      <span className="faint tabular" style={{ width: 80, textAlign: 'right' }}>
                        {n.counts.bytes ? bytes(n.counts.bytes) : ''}
                      </span>
                      <span style={{ width: 150 }} />
                      <span style={{ width: 28 }} />
                    </div>
                  );
                }
                const o = item.op;
                const on = selected.has(o.id);
                const { dir, name } = splitPath(o.rel);
                const canDiff = o.kind === 'copy' && !o.isDir && o.dstSize != null;
                return (
                  <div key={o.id} className={cls('list-row', 'op-row', !on && 'off')} style={{ ...place, paddingLeft: view === 'tree' ? 12 + item.depth * 18 + 20 : undefined }} onClick={() => toggle(o, !on)}>
                    <Checkbox checked={on} onChange={(val) => toggle(o, val)} />
                    <span className={cls('sign', o.category)}>{o.isDir && o.category === 'new' ? <FolderPlus size={12} /> : SIGN[o.category]}</span>
                    <span className="path grow" title={o.note ? `${o.rel}\n${o.note}` : o.rel}>
                      {view === 'flat' && dir && <span className="dir">{'\u200e' + dir + '\u200e'}</span>}
                      <span className="name">
                        {name}
                        {o.isDir ? '/' : ''}
                      </span>
                    </span>
                    <span className={cls('op-status', o.category)} style={{ width: 180 }}>
                      {opStatus(o, on)}
                    </span>
                    <span className="faint tabular" style={{ width: 80, textAlign: 'right' }}>
                      {o.isDir ? '' : bytes(o.kind === 'delete' ? o.dstSize ?? o.size : o.size)}
                    </span>
                    <span className="faint tabular nowrap" style={{ width: 150, fontSize: 11.5 }}>
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
