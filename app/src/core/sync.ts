import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Category, CompareItem, CompareResult, CompareStats, CustomActions, Endpoint, FileMeta, PairResult, SyncAction, SyncJob, SyncPair, SyncVariant, RunDetail } from '../shared/types';
import type { CoreContext } from './context';
import { makeFilter, withTopDirsExcluded } from './filter';
import { otherBackupRoots } from './backups';
import { scanTree } from './scan';
import { transportForEndpoint, endpointLabel, type Transport, type Entry } from './transport';
import { compareMeta, sameTime, streamsEqual, type TimeOptions } from './compare';
import type { ExecGroup, ExecOp, ExecSettings } from './executor';
import { IGNORE_FILE, readIgnore } from './ignore';
import { CancelToken, errMessage, mapLimit, newId } from './util';
import { joinRoot } from './paths';
import { t } from '../shared/i18n';
import { RELAY_FOLDER } from '../shared/relay';
import { OWN_FILE_PATTERNS } from '../shared/files';

export const VARIANT_ACTIONS: Record<Exclude<SyncVariant, 'twoWay' | 'custom'>, CustomActions> = {
  mirror: { leftOnly: 'copyRight', rightOnly: 'deleteRight', leftNewer: 'copyRight', rightNewer: 'copyRight', different: 'copyRight' },
  update: { leftOnly: 'copyRight', rightOnly: 'none', leftNewer: 'copyRight', rightNewer: 'none', different: 'copyRight' },
};

interface DbSide {
  s: number;
  m: number;
}
interface DbEntry {
  d?: 1;
  l: DbSide;
  r: DbSide;
  /** The two versions were kept side by side: nothing is proposed until one of them changes again. */
  k?: 1;
}
type SyncDb = Record<string, DbEntry>;

function dbFile(ctx: CoreContext, jobId: string, pairId: string): string {
  const safe = (s: string) => s.replace(/[^\w.-]/g, '_');
  return path.join(ctx.userDataPath, 'syncdb', safe(jobId), `${safe(pairId)}.json`);
}

export async function loadDb(ctx: CoreContext, jobId: string, pairId: string): Promise<SyncDb> {
  try {
    return JSON.parse(await fsp.readFile(dbFile(ctx, jobId, pairId), 'utf8')) as SyncDb;
  } catch {
    return {};
  }
}

async function saveDb(ctx: CoreContext, jobId: string, pairId: string, db: SyncDb): Promise<void> {
  const f = dbFile(ctx, jobId, pairId);
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, JSON.stringify(db), 'utf8');
}

export async function resetDb(ctx: CoreContext, jobId: string): Promise<void> {
  await fsp.rm(path.dirname(dbFile(ctx, jobId, 'x')), { recursive: true, force: true });
}

function meta(e?: Entry): FileMeta | undefined {
  return e ? { size: e.size, mtimeMs: e.mtimeMs, isDir: e.isDir } : undefined;
}

function changedSince(m: FileMeta, side: DbSide | undefined, tol: TimeOptions): boolean {
  if (!side) return true;
  if (m.isDir) return false;
  return m.size !== side.s || !sameTime(m.mtimeMs, side.m, tol);
}

interface PairCtx {
  left: Transport;
  right: Transport;
  time: TimeOptions;
  job: SyncJob;
  db: SyncDb;
}

async function classify(p: PairCtx, rel: string, l: Entry | undefined, r: Entry | undefined): Promise<{ category: Category; conflict?: string }> {
  if (l && !r) return { category: 'leftOnly' };
  if (r && !l) return { category: 'rightOnly' };
  const L = l!;
  const R = r!;
  if (L.isDir !== R.isDir) return { category: 'conflict', conflict: t('Bir tarafta klasör, öbür tarafta dosya') };
  if (L.isDir) return { category: 'equal' };
  const v = compareMeta(L, R, p.job.compare, p.time);
  if (v === 'equal') return { category: 'equal' };
  if (v === 'needsContent') {
    const eq = await streamsEqual(await p.left.readStream(rel), await p.right.readStream(rel));
    return { category: eq ? 'equal' : 'different' };
  }
  if (v === 'srcNewer') return { category: 'leftNewer' };
  if (v === 'dstNewer') return { category: 'rightNewer' };
  return { category: 'different' };
}

function defaultAction(job: SyncJob, item: Omit<CompareItem, 'action' | 'defaultAction'>, db: SyncDb, tol: TimeOptions): { action: SyncAction; conflict?: string; category?: Category } {
  const c = item.category;
  if (c === 'equal') return { action: 'none' };
  if (c === 'conflict') return { action: 'none' };
  if (job.variant === 'mirror' || job.variant === 'update') return { action: VARIANT_ACTIONS[job.variant][c] };
  if (job.variant === 'custom') return { action: (job.custom ?? VARIANT_ACTIONS.mirror)[c] ?? 'none' };

  // two way, using the state of the last synchronisation to tell deletions from creations
  const e = db[item.key];
  if (c === 'leftOnly') {
    if (!e) return { action: 'copyRight' };
    if (!changedSince(item.left!, e.l, tol)) return { action: 'deleteLeft' };
    return { action: 'copyRight', category: 'conflict', conflict: t('Sağda silinmiş ama solda değiştirilmiş') };
  }
  if (c === 'rightOnly') {
    if (!e) return { action: 'copyLeft' };
    if (!changedSince(item.right!, e.r, tol)) return { action: 'deleteRight' };
    return { action: 'copyLeft', category: 'conflict', conflict: t('Solda silinmiş ama sağda değiştirilmiş') };
  }
  if (e) {
    const lc = changedSince(item.left!, e.l, tol);
    const rc = changedSince(item.right!, e.r, tol);
    if (e.k && !lc && !rc) return { action: 'none', category: 'conflict', conflict: t('İki sürüm de saklanmıştı; bir taraf değişene dek dokunulmaz') };
    if (lc && !rc) return { action: 'copyRight' };
    if (rc && !lc) return { action: 'copyLeft' };
    if (lc && rc) return { action: 'none', category: 'conflict', conflict: t('İki tarafta da değiştirilmiş') };
  }
  if (c === 'leftNewer') return { action: 'copyRight' };
  if (c === 'rightNewer') return { action: 'copyLeft' };
  return { action: 'none', category: 'conflict', conflict: t('Tarihler aynı, içerik farklı') };
}

export function emptyStats(): CompareStats {
  return {
    byCategory: { leftOnly: 0, rightOnly: 0, leftNewer: 0, rightNewer: 0, different: 0, equal: 0, conflict: 0 },
    byAction: { copyRight: 0, copyLeft: 0, deleteLeft: 0, deleteRight: 0, keepBoth: 0, none: 0 },
    bytesToCopy: 0,
  };
}

export function computeStats(pairs: PairResult[]): CompareStats {
  const s = emptyStats();
  for (const p of pairs)
    for (const it of p.items) {
      s.byCategory[it.category]++;
      s.byAction[it.action]++;
      if (it.action === 'copyRight' && it.left && !it.left.isDir) s.bytesToCopy += it.left.size;
      if (it.action === 'copyLeft' && it.right && !it.right.isDir) s.bytesToCopy += it.right.size;
      if (it.action === 'keepBoth') {
        if (it.left && !it.left.isDir) s.bytesToCopy += it.left.size;
        if (it.right && !it.right.isDir) s.bytesToCopy += it.right.size;
      }
    }
  return s;
}

/** "Data/doc.txt" with side "sol" → "Data/doc (sol).txt": where the other side's version lands when both are kept. */
export function conflictCopyName(rel: string, side: string): string {
  const i = rel.lastIndexOf('/');
  const dir = i >= 0 ? rel.slice(0, i + 1) : '';
  const base = rel.slice(i + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${dir}${stem} (${side})${ext}`;
}

export async function comparePair(ctx: CoreContext, job: SyncJob, pair: SyncPair, cancel: CancelToken, onProgress?: (n: number) => void): Promise<PairResult> {
  const leftLabel = endpointLabel(ctx.config, pair.left);
  const rightLabel = endpointLabel(ctx.config, pair.right);
  const res: PairResult = { pairId: pair.id, leftLabel, rightLabel, leftOk: false, rightOk: false, items: [] };
  let left: Transport | null = null;
  let right: Transport | null = null;
  try {
    left = await transportForEndpoint(ctx, pair.left);
    right = await transportForEndpoint(ctx, pair.right);
    const ci = left.caseInsensitive || right.caseInsensitive;
    const f = job.filter;
    // the ignore files at both roots add to the job's exclusions; they are never copied themselves
    const ignored = [...new Set((await Promise.all([left, right].map((x) => readIgnore(x)))).flat())];
    const filter = makeFilter({
      include: f.include,
      exclude: [...f.exclude, ...ignored],
      excludeFiles: [IGNORE_FILE, ...OWN_FILE_PATTERNS],
      minSize: f.minSizeKb != null ? f.minSizeKb * 1024 : undefined,
      maxSize: f.maxSizeKb != null ? f.maxSizeKb * 1024 : undefined,
      newerThan: f.newerThanDays ? Date.now() - f.newerThanDays * 86400_000 : undefined,
      alwaysExcludeDirs: [ctx.config.copy.backupFolderName, RELAY_FOLDER],
      caseInsensitive: ci,
    });
    // an older backup folder at either root (a machine root kept by the PowerShell tool) is left out on both sides
    const kept = [...new Set((await Promise.all([left, right].map((x) => otherBackupRoots(x, ctx.config.copy.backupFolderName)))).flat())];
    const scanFilter = withTopDirsExcluded(filter, kept);
    let counted = 0;
    const tick = (n: number) => onProgress?.(counted + n);
    const [ls, rs] = await Promise.all([
      scanTree(left, '', { filter: scanFilter, cancel, caseInsensitive: ci, onProgress: tick }),
      scanTree(right, '', { filter: scanFilter, cancel, caseInsensitive: ci, onProgress: tick }),
    ]);
    counted = ls.entries.size + rs.entries.size;
    res.leftOk = ls.exists;
    res.rightOk = rs.exists || pair.right.kind === 'node';
    if (!ls.exists) throw new Error(t('Sol klasör bulunamadı: {path}', { path: leftLabel }));
    const errs = [...ls.errors.map((e) => t('sol {path}: {error}', { path: e.rel, error: e.error })), ...rs.errors.map((e) => t('sağ {path}: {error}', { path: e.rel, error: e.error }))];
    if (errs.length) res.error = errs.slice(0, 5).join('\n');

    const db = await loadDb(ctx, job.id, pair.id);
    const time = { toleranceMs: ctx.config.copy.timeToleranceSec * 1000, ignoreDstShift: ctx.config.copy.ignoreDstShift };
    const pc: PairCtx = { left, right, time, job, db };
    const keys = [...new Set([...ls.entries.keys(), ...rs.entries.keys()])].sort();
    res.items = await mapLimit(keys, 16, async (key) => {
      cancel.throwIfCancelled();
      const l = ls.entries.get(key);
      const r = rs.entries.get(key);
      const rel = (l ?? r)!.rel;
      const { category, conflict } = await classify(pc, rel, l, r);
      const base = { key, rel, isDir: (l ?? r)!.isDir, left: meta(l), right: meta(r), category, conflict };
      const d = defaultAction(job, base, db, time);
      return { ...base, category: d.category ?? category, conflict: d.conflict ?? conflict, action: d.action, defaultAction: d.action };
    });
  } catch (e) {
    if (cancel.cancelled) throw e;
    res.error = errMessage(e);
  } finally {
    await left?.close().catch(() => undefined);
    await right?.close().catch(() => undefined);
  }
  return res;
}

export async function compareJob(ctx: CoreContext, job: SyncJob, cancel = new CancelToken(), onProgress?: (msg: string) => void): Promise<CompareResult> {
  const started = Date.now();
  const pairs = await mapLimit(job.pairs, 2, (p) =>
    comparePair(ctx, job, p, cancel, (n) => onProgress?.(t('{left} ⇄ {right}: {n} öğe', { left: endpointLabel(ctx.config, p.left), right: endpointLabel(ctx.config, p.right), n }))),
  );
  return { id: newId('cmp-'), jobId: job.id, createdAt: Date.now(), durationMs: Date.now() - started, pairs, stats: computeStats(pairs) };
}

/** Turns the (possibly user edited) compare result into executor groups: one per side that receives writes. */
export function syncGroups(ctx: CoreContext, job: SyncJob, cmp: CompareResult): ExecGroup[] {
  const groups: ExecGroup[] = [];
  for (const pr of cmp.pairs) {
    const pair = job.pairs.find((p) => p.id === pr.pairId);
    if (!pair) continue;
    const openL = () => transportForEndpoint(ctx, pair.left);
    const openR = () => transportForEndpoint(ctx, pair.right);
    const toR: ExecOp[] = [];
    const toL: ExecOp[] = [];
    for (const it of pr.items) {
      const id = it.key;
      if (it.action === 'copyRight' && it.left) {
        const src = pair.left.kind === 'local' ? { kind: 'fs' as const, abs: joinRoot(pair.left.path, it.rel) } : { kind: 'endpoint' as const, key: 'L', rel: it.rel };
        toR.push({ id, kind: it.left.isDir ? 'mkdir' : 'copy', rel: it.rel, isDir: it.left.isDir, size: it.left.size, mtimeMs: it.left.mtimeMs, src, replaceType: !!it.right && it.right.isDir !== it.left.isDir });
      } else if (it.action === 'copyLeft' && it.right) {
        const src = pair.right.kind === 'local' ? { kind: 'fs' as const, abs: joinRoot(pair.right.path, it.rel) } : { kind: 'endpoint' as const, key: 'R', rel: it.rel };
        toL.push({ id, kind: it.right.isDir ? 'mkdir' : 'copy', rel: it.rel, isDir: it.right.isDir, size: it.right.size, mtimeMs: it.right.mtimeMs, src, replaceType: !!it.left && it.left.isDir !== it.right.isDir });
      } else if (it.action === 'deleteRight' && it.right) {
        toR.push({ id, kind: 'delete', rel: it.rel, isDir: it.right.isDir, size: 0 });
      } else if (it.action === 'deleteLeft' && it.left) {
        toL.push({ id, kind: 'delete', rel: it.rel, isDir: it.left.isDir, size: 0 });
      } else if (it.action === 'keepBoth' && it.left && it.right && !it.left.isDir && !it.right.isDir) {
        // each side gets the other's version next to its own; nothing is overwritten, the two can be merged by hand
        const srcL = pair.left.kind === 'local' ? { kind: 'fs' as const, abs: joinRoot(pair.left.path, it.rel) } : { kind: 'endpoint' as const, key: 'L', rel: it.rel };
        const srcR = pair.right.kind === 'local' ? { kind: 'fs' as const, abs: joinRoot(pair.right.path, it.rel) } : { kind: 'endpoint' as const, key: 'R', rel: it.rel };
        toR.push({ id: `${id}#L`, kind: 'copy', rel: conflictCopyName(it.rel, t('sol')), isDir: false, size: it.left.size, mtimeMs: it.left.mtimeMs, src: srcL, dstExists: false });
        toL.push({ id: `${id}#R`, kind: 'copy', rel: conflictCopyName(it.rel, t('sağ')), isDir: false, size: it.right.size, mtimeMs: it.right.mtimeMs, src: srcR, dstExists: false });
      }
    }
    const endpoints = { L: openL, R: openR };
    const node = (ep: SyncPair['left']) => (ep.kind === 'node' ? ctx.config.nodes.find((n) => n.id === ep.nodeId) : undefined);
    const trash = (ep: SyncPair['left']) => (job.deletion === 'recycle' && canTrash(ep) ? ctx.trash : undefined);
    if (toR.length) groups.push({ key: `${pr.pairId}:R`, title: t('{name} (sağ)', { name: shortLabel(pr.rightLabel) }), rootLabel: pr.rightLabel, open: openR, ops: toR, endpoints, node: node(pair.right), trash: trash(pair.right) });
    if (toL.length) groups.push({ key: `${pr.pairId}:L`, title: t('{name} (sol)', { name: shortLabel(pr.leftLabel) }), rootLabel: pr.leftLabel, open: openL, ops: toL, endpoints, node: node(pair.left), trash: trash(pair.left) });
  }
  return groups;
}

/** Only a folder of this computer has a trash to go to: a UNC path or a target machine keeps the versioning folder. */
export function canTrash(ep: Endpoint): boolean {
  return ep.kind === 'local' && !!ep.path && !/^[\\/]{2}/.test(ep.path);
}

/** Run settings of a sync job: the copy settings, with the job's own versioning (recycle falls back to it). */
export function syncExecSettings(ctx: CoreContext, job: SyncJob, label: string, cmp: CompareResult, groups: ExecGroup[], opts: { dryRun?: boolean; notify?: boolean } = {}): ExecSettings {
  const c = ctx.config.copy;
  const backup = job.deletion !== 'permanent';
  return {
    label,
    origin: 'sync',
    dryRun: !!opts.dryRun,
    backup,
    backupKeep: job.versioningKeep,
    backupMaxDays: job.versioningMaxDays,
    backupFolderName: c.backupFolderName,
    verify: c.verify,
    retryCount: c.retryCount,
    waitSeconds: c.waitSeconds,
    parallelGroups: c.parallelTargets,
    parallelFiles: c.parallelFiles,
    postCommandTimeoutSeconds: c.postCommandTimeoutSeconds,
    bandwidthMBps: c.bandwidthMBps,
    sources: cmp.pairs.map((p) => p.leftLabel),
    targetIds: groups.map((g) => g.key),
    options: { dryRun: !!opts.dryRun, backup, ...(opts.notify != null ? { notify: opts.notify } : {}) },
  };
}

function shortLabel(s: string): string {
  const parts = s.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || s;
}

/** Stores the state after a sync so the next two way comparison can tell what changed where. */
export async function updateDbAfterRun(ctx: CoreContext, job: SyncJob, cmp: CompareResult, run: RunDetail): Promise<void> {
  const okByKey = new Map<string, boolean>();
  for (const r of run.results) okByKey.set(`${r.key.slice(0, r.key.lastIndexOf(':'))}\n${r.opId}`, r.ok);
  for (const pr of cmp.pairs) {
    if (pr.error && !pr.items.length) continue;
    const old = await loadDb(ctx, job.id, pr.pairId);
    const db: SyncDb = {};
    for (const it of pr.items) {
      const ok = okByKey.get(`${pr.pairId}\n${it.key}`);
      const side = (m?: FileMeta): DbSide => ({ s: m?.size ?? 0, m: m?.mtimeMs ?? 0 });
      if (it.action === 'none') {
        if (it.category === 'equal' && it.left && it.right) db[it.key] = { l: side(it.left), r: side(it.right), ...(it.isDir ? { d: 1 as const } : {}) };
        else if (old[it.key]) db[it.key] = old[it.key];
        continue;
      }
      if (it.action === 'keepBoth') {
        // both copies made: the pair is known as it is now, and stays quiet until a side changes
        const both = okByKey.get(`${pr.pairId}\n${it.key}#L`) && okByKey.get(`${pr.pairId}\n${it.key}#R`);
        if (both && !run.dryRun) db[it.key] = { l: side(it.left), r: side(it.right), k: 1 };
        else if (old[it.key]) db[it.key] = old[it.key];
        continue;
      }
      if (ok === undefined || run.dryRun) {
        if (old[it.key]) db[it.key] = old[it.key];
        continue;
      }
      if (!ok) {
        if (old[it.key]) db[it.key] = old[it.key];
        continue;
      }
      if (it.action === 'copyRight' && it.left) db[it.key] = { l: side(it.left), r: side(it.left) };
      else if (it.action === 'copyLeft' && it.right) db[it.key] = { l: side(it.right), r: side(it.right) };
      // successful deletions leave no entry
    }
    await saveDb(ctx, job.id, pr.pairId, db);
  }
}
