import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { CategoryCounts, NodeConfig, PlanCategory, PlanOp, SendPlan, SendRequest, SourceInfo, TargetPlan } from '../shared/types';
import type { CoreContext } from './context';
import { expandTargetIds } from './context';
import { makeFilter, type PathFilter } from './filter';
import { mapToRel, normalizeAbs, relKey, relIsWithin, relJoin } from './paths';
import { scanTree } from './scan';
import { FsTransport, transportForNode, nodeRootLabel, type Transport, type Entry } from './transport';
import { compareMeta, gitBlobId, streamsEqual } from './compare';
import { blobInfo } from './git';
import { probeNode } from './probe';
import { CancelToken, errMessage, formatBytes, mapLimit, newId } from './util';
import { t } from '../shared/i18n';

type Unit =
  | { kind: 'file'; sourceIndex: number; rel: string; abs: string; size: number; mtimeMs: number; blob?: string }
  | { kind: 'dir'; sourceIndex: number; rel: string; abs: string; entries: Map<string, Entry> }
  | { kind: 'git'; sourceIndex: number; rel: string; repo: string; rev: string; path: string; blob: string; size: number; mtimeMs: number }
  | { kind: 'delete'; sourceIndex: number; rel: string; abs: string };

export function emptyCounts(): CategoryCounts {
  return { new: 0, changed: 0, targetNewer: 0, extra: 0, deleted: 0, same: 0 };
}

export interface PlanProgress {
  message: string;
  done?: number;
  total?: number;
}

export function sendFilter(ctx: CoreContext, req: SendRequest): PathFilter {
  return makeFilter({
    excludeFiles: req.options.excludeFiles,
    excludeDirs: req.options.excludeDirs,
    alwaysExcludeDirs: [ctx.config.copy.backupFolderName],
  });
}

/** Counts files and bytes below a folder, giving up (capped = true) after a file or time budget. */
async function countTree(dir: string, maxFiles = 20000, budgetMs = 2500): Promise<{ files: number; bytes: number; capped: boolean }> {
  const started = Date.now();
  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    if (files >= maxFiles || Date.now() - started > budgetMs) return { files, bytes, capped: true };
    const d = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    const fileEnts = ents.filter((e) => e.isFile());
    for (const e of ents) if (e.isDirectory()) stack.push(`${d}/${e.name}`);
    const sizes = await mapLimit(fileEnts, 32, async (e) => (await fsp.stat(`${d}/${e.name}`).catch(() => null))?.size ?? 0);
    files += fileEnts.length;
    for (const n of sizes) bytes += n;
  }
  return { files, bytes, capped: false };
}

/** Describes the sources (for the header chips and the plan) without touching any target. */
export async function describeSources(ctx: CoreContext, paths: string[], count = true): Promise<SourceInfo[]> {
  return mapLimit(paths, 8, async (p) => {
    const abs = normalizeAbs(p);
    const m = mapToRel(abs, ctx.localRoots);
    try {
      const st = await fsp.stat(abs);
      if (st.isDirectory() && count) {
        const c = await countTree(abs);
        return { path: abs, exists: true, isDir: true, size: c.bytes, fileCount: c.files, fileCountCapped: c.capped, mtimeMs: st.mtimeMs, rel: m.rel, root: m.root, outsideRoots: m.outside };
      }
      return { path: abs, exists: true, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs, rel: m.rel, root: m.root, outsideRoots: m.outside };
    } catch (e) {
      return { path: abs, exists: false, isDir: false, size: 0, mtimeMs: 0, rel: m.rel, root: m.root, outsideRoots: m.outside, error: errMessage(e) };
    }
  });
}

async function expandUnits(ctx: CoreContext, req: SendRequest, filter: PathFilter, cancel: CancelToken, progress: (p: PlanProgress) => void) {
  const units: Unit[] = [];
  const warnings: string[] = [];
  const sources: SourceInfo[] = [];
  const gitGroups = new Map<string, { repo: string; rev: string; items: { i: number; path: string }[] }>();

  for (let i = 0; i < req.sources.length; i++) {
    cancel.throwIfCancelled();
    const s = req.sources[i];
    if (s.kind === 'git') {
      const key = `${s.repo}\n${s.rev}`;
      if (!gitGroups.has(key)) gitGroups.set(key, { repo: s.repo, rev: s.rev, items: [] });
      gitGroups.get(key)!.items.push({ i, path: s.path });
      continue;
    }
    const abs = normalizeAbs(s.path);
    const m = mapToRel(abs, ctx.localRoots);
    if (s.kind === 'delete') {
      units.push({ kind: 'delete', sourceIndex: i, rel: m.rel, abs });
      sources.push({ path: abs, exists: false, isDir: false, size: 0, mtimeMs: 0, rel: m.rel, root: m.root, outsideRoots: m.outside });
      continue;
    }
    let st: fs.Stats;
    try {
      st = await fsp.stat(abs);
    } catch (e) {
      warnings.push(t('Kaynak bulunamadı: {path} ({error})', { path: abs, error: errMessage(e) }));
      sources.push({ path: abs, exists: false, isDir: false, size: 0, mtimeMs: 0, rel: m.rel, root: m.root, outsideRoots: m.outside, error: errMessage(e) });
      continue;
    }
    if (!m.rel) {
      warnings.push(t('{path} yerel kökün kendisi: kökün tamamı gönderilecek.', { path: abs }));
    }
    if (st.isDirectory()) {
      progress({ message: t('Kaynak taranıyor: {path}', { path: abs }) });
      const scan = await scanTree(new FsTransport(abs), '', { filter, cancel, caseInsensitive: true });
      for (const e of scan.errors) warnings.push(t('Okunamadı: {path} ({error})', { path: `${abs}/${e.rel}`, error: e.error }));
      units.push({ kind: 'dir', sourceIndex: i, rel: m.rel, abs, entries: scan.entries });
      let size = 0;
      let files = 0;
      for (const e of scan.entries.values()) if (!e.isDir) {
        size += e.size;
        files++;
      }
      sources.push({ path: abs, exists: true, isDir: true, size, fileCount: files, mtimeMs: st.mtimeMs, rel: m.rel, root: m.root, outsideRoots: m.outside });
    } else {
      units.push({ kind: 'file', sourceIndex: i, rel: m.rel, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      sources.push({ path: abs, exists: true, isDir: false, size: st.size, mtimeMs: st.mtimeMs, rel: m.rel, root: m.root, outsideRoots: m.outside });
    }
    if (m.outside) warnings.push(t('{path} hiçbir yerel kökün altında değil; tam yoluyla ({rel}) gönderilecek.', { path: abs, rel: m.rel }));
  }

  for (const g of gitGroups.values()) {
    const info = await blobInfo(g.repo, g.rev, g.items.map((x) => x.path));
    const { gitText } = await import('./git');
    const at = Number((await gitText(g.repo, ['show', '-s', '--format=%ct', g.rev]).catch(() => '0')).trim()) * 1000;
    for (const it of g.items) {
      const abs = normalizeAbs(`${g.repo}/${it.path}`);
      const m = mapToRel(abs, ctx.localRoots);
      const b = info.get(it.path);
      if (!b) {
        units.push({ kind: 'delete', sourceIndex: it.i, rel: m.rel, abs });
        sources.push({ path: abs, exists: false, isDir: false, size: 0, mtimeMs: 0, rel: m.rel, root: m.root, outsideRoots: m.outside });
        continue;
      }
      // When the working file still holds exactly the committed content, send it from disk:
      // faster, and the target keeps the real modification time instead of the commit time.
      const localSt = await fsp.stat(abs).catch(() => null);
      if (localSt && localSt.isFile() && localSt.size === b.size && (await gitBlobId(fs.createReadStream(abs), b.size)) === b.blob) {
        units.push({ kind: 'file', sourceIndex: it.i, rel: m.rel, abs, size: b.size, mtimeMs: Math.floor(localSt.mtimeMs), blob: b.blob });
      } else {
        units.push({ kind: 'git', sourceIndex: it.i, rel: m.rel, repo: g.repo, rev: g.rev, path: it.path, blob: b.blob, size: b.size, mtimeMs: at || Date.now() });
      }
      sources.push({ path: abs, exists: true, isDir: false, size: b.size, mtimeMs: at, rel: m.rel, root: m.root, outsideRoots: m.outside });
      if (m.outside) warnings.push(t('{path} hiçbir yerel kökün altında değil; tam yoluyla ({rel}) gönderilecek.', { path: it.path, rel: m.rel }));
    }
  }

  // A file inside a selected folder is already covered by the folder; the same rel twice is sent once.
  const dirs = units.filter((u) => u.kind === 'dir');
  const seen = new Set<string>();
  const deduped: Unit[] = [];
  for (const u of units) {
    const k = relKey(u.rel, true);
    if (u.kind !== 'dir' && dirs.some((d) => relIsWithin(u.rel, d.rel, true))) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(u);
  }
  return { units: deduped, warnings, sources };
}

interface OpBuilder {
  ops: PlanOp[];
  counts: CategoryCounts;
}

function push(b: OpBuilder, op: Omit<PlanOp, 'id'>) {
  b.counts[op.category]++;
  if (op.category === 'same') return;
  b.ops.push({ ...op, id: String(b.ops.length) });
}

async function planTarget(ctx: CoreContext, req: SendRequest, node: NodeConfig, units: Unit[], filter: PathFilter, cancel: CancelToken): Promise<TargetPlan> {
  const opt = req.options;
  const base: TargetPlan = {
    targetId: node.id,
    targetName: node.name,
    root: nodeRootLabel(ctx.config, node),
    reachable: true,
    ops: [],
    counts: emptyCounts(),
    bytes: 0,
  };
  const probe = await probeNode(ctx.config, node);
  if (!probe.ok) return { ...base, reachable: false, error: probe.detail };

  let tgt: Transport;
  try {
    tgt = await transportForNode(ctx, node);
  } catch (e) {
    return { ...base, reachable: false, error: errMessage(e) };
  }
  const b: OpBuilder = { ops: [], counts: emptyCounts() };
  const time = { toleranceMs: ctx.config.copy.timeToleranceSec * 1000, ignoreDstShift: ctx.config.copy.ignoreDstShift };

  const classify = async (src: { size: number; mtimeMs: number }, dst: Entry, readSrc: () => Promise<NodeJS.ReadableStream>, rel: string): Promise<PlanCategory> => {
    const v = compareMeta(src, dst, opt.compare, time);
    if (v === 'equal') return 'same';
    if (v === 'needsContent') return (await streamsEqual((await readSrc()) as any, await tgt.readStream(rel))) ? 'same' : 'changed';
    if (v === 'dstNewer') return 'targetNewer';
    return 'changed';
  };

  try {
    await mapLimit(units, 12, async (u) => {
      cancel.throwIfCancelled();
      if (u.kind === 'delete') {
        const dst = await tgt.stat(u.rel);
        if (!dst) return push(b, { kind: 'delete', rel: u.rel, isDir: false, category: 'same', size: 0, selected: false, sourceIndex: u.sourceIndex });
        push(b, { kind: 'delete', rel: u.rel, isDir: dst.isDir, category: 'deleted', size: dst.size, dstMtime: dst.mtimeMs, dstSize: dst.size, selected: opt.propagateDeletes, sourceIndex: u.sourceIndex });
        return;
      }
      if (u.kind === 'file' || u.kind === 'git') {
        const dst = await tgt.stat(u.rel);
        const src = u.kind === 'file' ? ({ kind: 'fs', abs: u.abs } as const) : ({ kind: 'git', repo: u.repo, rev: u.rev, path: u.path, blob: u.blob } as const);
        const common = { kind: 'copy' as const, rel: u.rel, isDir: false, src, size: u.size, srcMtime: u.mtimeMs, sourceIndex: u.sourceIndex };
        if (!dst) return push(b, { ...common, category: 'new', selected: true });
        if (dst.isDir) return push(b, { ...common, category: 'changed', selected: true, dstMtime: dst.mtimeMs, replaceType: true, note: t('Hedefte aynı adda klasör var; klasör kaldırılıp dosya yazılacak.') });
        let cat: PlanCategory;
        if (u.kind === 'git' || u.blob) {
          // Commit content: the blob id tells equality exactly, time stamps mean nothing here.
          if (dst.size !== u.size) cat = 'changed';
          else cat = (await gitBlobId(await tgt.readStream(u.rel), dst.size)) === u.blob ? 'same' : 'changed';
        } else {
          cat = await classify(u, dst, async () => fs.createReadStream(u.abs), u.rel);
        }
        return push(b, { ...common, category: cat, dstMtime: dst.mtimeMs, dstSize: dst.size, selected: cat === 'targetNewer' ? opt.mode !== 'update' : cat !== 'same' });
      }
      // folder
      const dstRoot = await tgt.stat(u.rel);
      if (dstRoot && !dstRoot.isDir) {
        push(b, { kind: 'mkdir', rel: u.rel, isDir: true, category: 'changed', size: 0, selected: true, sourceIndex: u.sourceIndex, replaceType: true, note: t('Hedefte aynı adda dosya var; dosya kaldırılıp klasör oluşturulacak.') });
      } else if (!dstRoot) {
        push(b, { kind: 'mkdir', rel: u.rel, isDir: true, category: 'new', size: 0, selected: true, sourceIndex: u.sourceIndex });
      }
      const dstScan = dstRoot?.isDir ? await scanTree(tgt, u.rel, { filter, cancel, caseInsensitive: true }) : null;
      const dstEntries = dstScan?.entries ?? new Map<string, Entry>();
      const local = new FsTransport(u.abs);
      const files: [string, Entry][] = [];
      for (const [key, e] of u.entries) {
        const rel = relJoin(u.rel, e.rel);
        const d = dstEntries.get(key);
        if (e.isDir) {
          if (!d) push(b, { kind: 'mkdir', rel, isDir: true, category: 'new', size: 0, selected: true, sourceIndex: u.sourceIndex });
          else if (!d.isDir) push(b, { kind: 'mkdir', rel, isDir: true, category: 'changed', size: 0, selected: true, sourceIndex: u.sourceIndex, replaceType: true, note: t('Hedefte aynı adda dosya var.') });
        } else files.push([key, e]);
      }
      await mapLimit(files, 8, async ([key, e]) => {
        cancel.throwIfCancelled();
        const rel = relJoin(u.rel, e.rel);
        const d = dstEntries.get(key);
        const common = { kind: 'copy' as const, rel, isDir: false, src: { kind: 'fs' as const, abs: local.localPath(e.rel) }, size: e.size, srcMtime: e.mtimeMs, sourceIndex: u.sourceIndex };
        if (!d) return push(b, { ...common, category: 'new', selected: true });
        if (d.isDir) return push(b, { ...common, category: 'changed', selected: true, dstMtime: d.mtimeMs, replaceType: true, note: t('Hedefte aynı adda klasör var.') });
        const cat = await classify(e, d, () => local.readStream(e.rel), rel);
        push(b, { ...common, category: cat, dstMtime: d.mtimeMs, dstSize: d.size, selected: cat === 'targetNewer' ? opt.mode !== 'update' : cat !== 'same' });
      });
      // extras: on the target but not in the source
      const extras = [...dstEntries.entries()].filter(([k]) => !u.entries.has(k)).map(([, e]) => e).sort((x, y) => x.rel.localeCompare(y.rel));
      const removedDirs: string[] = [];
      for (const e of extras) {
        if (removedDirs.some((d) => relIsWithin(e.rel, d, true))) continue;
        if (e.isDir) removedDirs.push(e.rel);
        push(b, { kind: 'delete', rel: relJoin(u.rel, e.rel), isDir: e.isDir, category: 'extra', size: e.size, dstMtime: e.mtimeMs, dstSize: e.size, selected: opt.mode === 'mirror', sourceIndex: u.sourceIndex });
      }
    });
  } catch (e) {
    await tgt.close();
    if (cancel.cancelled) throw e;
    return { ...base, reachable: false, error: errMessage(e), counts: b.counts, ops: b.ops };
  }

  b.ops.sort((x, y) => x.rel.localeCompare(y.rel));
  b.ops.forEach((op, i) => (op.id = String(i)));
  const bytes = b.ops.filter((o) => o.selected && o.kind === 'copy').reduce((s, o) => s + o.size, 0);
  const freeBytes = await tgt.freeSpace();
  await tgt.close();
  return { ...base, ops: b.ops, counts: b.counts, bytes, freeBytes };
}

export async function buildSendPlan(
  ctx: CoreContext,
  req: SendRequest,
  opts: { cancel?: CancelToken; onProgress?: (p: PlanProgress) => void } = {},
): Promise<SendPlan> {
  const started = Date.now();
  const cancel = opts.cancel ?? new CancelToken();
  const progress = opts.onProgress ?? (() => undefined);
  const filter = sendFilter(ctx, req);
  const { units, warnings, sources } = await expandUnits(ctx, req, filter, cancel, progress);

  const requested = req.targetIds;
  const nodes = expandTargetIds(ctx.config, requested, ctx.localNodeId);
  if (ctx.localNodeId && requested.some((id) => id.toLowerCase() === ctx.localNodeId!.toLowerCase()))
    warnings.push(t('Bu makinenin kendisi hedef listesinden çıkarıldı (kaynak ile hedef aynı olurdu).'));
  if (!nodes.length) warnings.push(t('Gönderilecek etkin hedef yok.'));

  let done = 0;
  progress({ message: t('Hedefler inceleniyor'), done, total: nodes.length });
  const targets = await mapLimit(nodes, 6, async (n) => {
    const tp = await planTarget(ctx, req, n, units, filter, cancel);
    progress({ message: t('{name} incelendi', { name: n.name }), done: ++done, total: nodes.length });
    return tp;
  });

  for (const tp of targets) {
    if (tp.freeBytes != null && tp.bytes > tp.freeBytes)
      warnings.push(t('{name}: hedefte {free} boş alan var, {size} yazılacak.', { name: tp.targetName, free: formatBytes(tp.freeBytes), size: formatBytes(tp.bytes) }));
  }
  if (req.options.mode === 'mirror') {
    const del = targets.reduce((s, tp) => s + tp.ops.filter((o) => o.selected && o.kind === 'delete').length, 0);
    if (del) warnings.push(t('Ayna kipi: hedeflerde toplam {n} fazla öğe silinecek.', { n: del }));
  }
  return { id: newId('plan-'), createdAt: Date.now(), request: req, targets, sources, warnings, durationMs: Date.now() - started };
}
