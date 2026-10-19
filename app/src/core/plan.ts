import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { CategoryCounts, NodeConfig, PackWriteResult, PlanCategory, PlanOp, PlanTargetProgress, SendPlan, SendRequest, SourceInfo, TargetPlan } from '../shared/types';
import type { CoreContext } from './context';
import { expandTargetIds } from './context';
import { makeFilter, withTopDirsExcluded, type PathFilter } from './filter';
import { isUnder, mapSource, mapToRel, normalizeAbs, outsidePlaces, relKey, relIsWithin, relJoin, toPosix, type SourceMapping } from './paths';
import { scanTree } from './scan';
import { FsTransport, transportForNode, nodeRootLabel, type Transport, type Entry } from './transport';
import { compareMeta, gitBlobId, hashStream, streamsEqual } from './compare';
import { blobInfo, blobStream } from './git';
import { openPackEntry, type PackEntry, type PackSource } from './pack';
import { isPackFile, packFileEntry, packSubtreeEntries, readPackIndex, writePackFile, type PackIndex, type PackSubtree } from './packfile';
import { PackLockedError, PackPasswordError } from './packcrypt';
import { probeNode } from './probe';
import { otherBackupRoots } from './backups';
import { IGNORE_FILE, ignoreExcludes, readLocalIgnore } from './ignore';
import { CancelToken, errMessage, formatBytes, mapLimit, newId } from './util';
import { t } from '../shared/i18n';
import { targetOptions } from '../shared/options';
import { RELAY_FOLDER, relayRouting } from '../shared/relay';
import { OWN_FILE_PATTERNS } from '../shared/files';
import { heartbeatFresh, readHeartbeat } from './relay';
import { myLock, otherLock } from './lock';
import { manifestEntries } from './manifest';

type PackedEntry = Entry & { member?: PackEntry };

type Unit =
  | { kind: 'file'; sourceIndex: number; rel: string; abs: string; size: number; mtimeMs: number; blob?: string }
  | { kind: 'dir'; sourceIndex: number; rel: string; abs: string; entries: Map<string, Entry> }
  | { kind: 'git'; sourceIndex: number; rel: string; repo: string; rev: string; path: string; blob: string; size: number; mtimeMs: number }
  | { kind: 'delete'; sourceIndex: number; rel: string; abs: string }
  /** A file or a folder carried in a pack file (.samsync-pack); members are read straight out of it. */
  | { kind: 'packfile'; sourceIndex: number; rel: string; file: string; size: number; mtimeMs: number; member: PackEntry }
  | { kind: 'packdir'; sourceIndex: number; rel: string; file: string; entries: Map<string, PackedEntry> };

const packRef = (file: string, m: PackEntry) => ({ kind: 'pack' as const, file, offset: m.offset, length: m.length, method: m.method });

/** How long a reachability check from the window counts for a plan. */
const RECENT_PROBE_MS = 60_000;

export function emptyCounts(): CategoryCounts {
  return { new: 0, changed: 0, targetNewer: 0, extra: 0, deleted: 0, same: 0 };
}

export interface PlanProgress {
  message: string;
  done?: number;
  total?: number;
  /** While the targets are looked at: each one's progress. */
  targets?: PlanTargetProgress[];
}

/** The source files a target gets compared against (folders count by the files in them). */
function fileCount(units: Unit[]): number {
  let n = 0;
  for (const u of units) {
    if (u.kind === 'dir' || u.kind === 'packdir') {
      for (const e of u.entries.values()) if (!e.isDir) n++;
    } else n++;
  }
  return n;
}

/**
 * This machine may take the send itself when nothing comes from the folder it would write to: every source is a
 * pack, or lies outside this machine's local roots (a release on a USB disk, say) and does not hold its first root.
 */
function selfTargetOk(ctx: CoreContext, req: SendRequest): boolean {
  const own = ctx.localRoots[0];
  if (!own || !req.sources.length) return false;
  return req.sources.every((s) => s.kind === 'fs' && (isPackFile(s.path) || (mapToRel(s.path, ctx.localRoots).outside && !isUnder(own, s.path))));
}

/** The send's exclusions plus the patterns of the sent folders' ignore files; the ignore file itself is never sent. */
export function sendFilter(ctx: CoreContext, req: SendRequest, ignored: readonly string[] = []): PathFilter {
  const extra = ignoreExcludes(ignored);
  return makeFilter({
    excludeFiles: [...req.options.excludeFiles, ...extra.excludeFiles, IGNORE_FILE, ...OWN_FILE_PATTERNS],
    excludeDirs: [...req.options.excludeDirs, ...extra.excludeDirs],
    alwaysExcludeDirs: [ctx.config.copy.backupFolderName, RELAY_FOLDER],
  });
}

/**
 * The ignore file patterns of every folder in the send, merged: each applies inside every sent folder.
 * An ignore file that cannot be read stops the plan, as a mirror without its patterns could delete what it protects.
 */
export async function sendIgnorePatterns(req: SendRequest): Promise<string[]> {
  const patterns = new Set<string>();
  await mapLimit(req.sources, 8, async (s) => {
    if (s.kind !== 'fs') return;
    const abs = normalizeAbs(s.path);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isDirectory()) return;
    for (const p of await readLocalIgnore(abs)) patterns.add(p);
  });
  return [...patterns];
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
/** What the Send page shows for a pack file: its label, what is in it and where it came from. */
function packInfo(idx: PackIndex): NonNullable<SourceInfo['pack']> {
  return { label: idx.label, createdAt: idx.createdAt, from: idx.from.user ? `${idx.from.user}@${idx.from.host}` : idx.from.host, files: idx.files, size: idx.size, subtrees: idx.subtrees.map((s) => s.rel || '/'), encrypted: idx.encrypted || undefined };
}

/** A password-protected pack that could not be opened, as the Send page shows it (with the pack's size on disk). */
function lockedInfo(abs: string, st: fs.Stats, e: unknown): SourceInfo {
  return { path: abs, exists: true, isDir: false, size: st.size, mtimeMs: st.mtimeMs, rel: '', outsideRoots: false, locked: e instanceof PackPasswordError ? 'wrong' : 'password' };
}

/** The mapping fields of a SourceInfo; outside every root also the other places the source could take. */
function placeInfo(abs: string, isDir: boolean, m: SourceMapping): Pick<SourceInfo, 'rel' | 'root' | 'outsideRoots' | 'base' | 'full' | 'places'> {
  if (!m.outside) return { rel: m.rel, root: m.root, outsideRoots: false };
  return { rel: m.rel, outsideRoots: true, base: m.base, full: m.full, places: outsidePlaces(abs, isDir) };
}

/** What the review says about a source outside every root: where it is going to land. */
function outsideWarning(shown: string, m: SourceMapping): string {
  if (m.full) return t('{path} hiçbir yerel kökün altında değil; tam yoluyla ({rel}) gönderilecek.', { path: shown, rel: m.rel });
  if (!m.rel) return t('{path} hiçbir yerel kökün altında değil; içindekiler doğrudan hedeflerin köküne yazılacak.', { path: shown });
  return t('{path} hiçbir yerel kökün altında değil; hedeflerde {rel} yoluna yazılacak.', { path: shown, rel: m.rel });
}

/**
 * `secrets`: passwords for protected packs by path (as given); a pack opened once stays open for this process.
 * `rels`: target paths picked by hand, by path (as given).
 */
export async function describeSources(ctx: CoreContext, paths: string[], count = true, secrets?: Record<string, string>, rels?: Record<string, string>): Promise<SourceInfo[]> {
  const outside = ctx.config.copy.outsideRoots ?? 'own';
  return mapLimit(paths, 8, async (p) => {
    const abs = normalizeAbs(p);
    let m = mapSource(abs, ctx.localRoots, false, outside, rels?.[p]);
    try {
      const st = await fsp.stat(abs);
      m = mapSource(abs, ctx.localRoots, st.isDirectory(), outside, rels?.[p]);
      if (!st.isDirectory() && isPackFile(abs)) {
        try {
          const idx = await readPackIndex(abs, secrets?.[p] ?? secrets?.[abs]);
          return { path: abs, exists: true, isDir: false, size: idx.size, fileCount: idx.files, mtimeMs: st.mtimeMs, rel: idx.subtrees.map((s) => s.rel || '/').join(', '), outsideRoots: false, pack: packInfo(idx) };
        } catch (e) {
          if (e instanceof PackLockedError || e instanceof PackPasswordError) return lockedInfo(abs, st, e);
          throw e;
        }
      }
      if (st.isDirectory() && count) {
        const c = await countTree(abs);
        return { path: abs, exists: true, isDir: true, size: c.bytes, fileCount: c.files, fileCountCapped: c.capped, mtimeMs: st.mtimeMs, ...placeInfo(abs, true, m) };
      }
      return { path: abs, exists: true, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs, ...placeInfo(abs, st.isDirectory(), m) };
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
  const outside = ctx.config.copy.outsideRoots ?? 'own';

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
    let m = mapSource(abs, ctx.localRoots, false, outside, s.rel);
    if (s.kind === 'delete') {
      units.push({ kind: 'delete', sourceIndex: i, rel: m.rel, abs });
      sources.push({ path: abs, exists: false, isDir: false, size: 0, mtimeMs: 0, rel: m.rel, root: m.root, outsideRoots: m.outside });
      continue;
    }
    if (isPackFile(abs)) {
      // a pack: its index says which target paths it holds; the members are read out of it when they are needed
      let idx: PackIndex;
      let fst: fs.Stats;
      try {
        progress({ message: t('Paket okunuyor: {path}', { path: abs }) });
        fst = await fsp.stat(abs);
        idx = await readPackIndex(abs);
      } catch (e) {
        if (e instanceof PackLockedError || e instanceof PackPasswordError) {
          // the pack is there but closed: the Send page asks for the password, the plan leaves it out
          warnings.push(t('Paket parola korumalı, atlandı: {path}. Gönder sayfasında parolasını girin.', { path: abs }));
          sources.push(lockedInfo(abs, await fsp.stat(abs), e));
          continue;
        }
        warnings.push(t('Paket okunamadı: {path} ({error})', { path: abs, error: errMessage(e) }));
        sources.push({ path: abs, exists: false, isDir: false, size: 0, mtimeMs: 0, rel: '', outsideRoots: false, error: errMessage(e) });
        continue;
      }
      for (const sub of idx.subtrees) {
        if (sub.isDir) units.push({ kind: 'packdir', sourceIndex: i, rel: sub.rel, file: abs, entries: filterEntries(packSubtreeEntries(idx, sub.rel), filter) });
        else {
          const member = packFileEntry(idx, sub.rel);
          if (member) units.push({ kind: 'packfile', sourceIndex: i, rel: sub.rel, file: abs, size: member.size, mtimeMs: member.mtimeMs, member });
        }
      }
      sources.push({ path: abs, exists: true, isDir: false, size: idx.size, fileCount: idx.files, mtimeMs: fst.mtimeMs, rel: idx.subtrees.map((x) => x.rel || '/').join(', '), outsideRoots: false, pack: packInfo(idx) });
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
    m = mapSource(abs, ctx.localRoots, st.isDirectory(), outside, s.rel);
    if (m.outside) warnings.push(outsideWarning(abs, m));
    else if (!m.rel) warnings.push(t('{path} yerel kökün kendisi: kökün tamamı gönderilecek.', { path: abs }));
    if (st.isDirectory()) {
      progress({ message: t('Kaynak taranıyor: {path}', { path: abs }) });
      const local = new FsTransport(abs);
      // a local root that once was a target may hold an older backup folder: it is never sent along
      const skip = m.rel ? [] : await otherBackupRoots(local, ctx.config.copy.backupFolderName);
      const scan = await scanTree(local, '', { filter: withTopDirsExcluded(filter, skip), cancel, caseInsensitive: true });
      for (const e of scan.errors) warnings.push(t('Okunamadı: {path} ({error})', { path: `${abs}/${e.rel}`, error: e.error }));
      units.push({ kind: 'dir', sourceIndex: i, rel: m.rel, abs, entries: scan.entries });
      let size = 0;
      let files = 0;
      for (const e of scan.entries.values()) if (!e.isDir) {
        size += e.size;
        files++;
      }
      sources.push({ path: abs, exists: true, isDir: true, size, fileCount: files, mtimeMs: st.mtimeMs, ...placeInfo(abs, true, m) });
    } else {
      units.push({ kind: 'file', sourceIndex: i, rel: m.rel, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      sources.push({ path: abs, exists: true, isDir: false, size: st.size, mtimeMs: st.mtimeMs, ...placeInfo(abs, false, m) });
    }
  }

  for (const g of gitGroups.values()) {
    const info = await blobInfo(g.repo, g.rev, g.items.map((x) => x.path));
    const { gitText } = await import('./git');
    const at = Number((await gitText(g.repo, ['show', '-s', '--format=%ct', g.rev]).catch(() => '0')).trim()) * 1000;
    for (const it of g.items) {
      const abs = normalizeAbs(`${g.repo}/${it.path}`);
      // a repository outside every root stands for the target root itself (the old way: the full path)
      const r = mapToRel(abs, ctx.localRoots);
      const m: SourceMapping = !r.outside ? r : outside === 'fullPath' ? { ...r, full: true } : { rel: relJoin(toPosix(it.path)), outside: true, base: normalizeAbs(g.repo) };
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
      if (m.outside) warnings.push(outsideWarning(it.path, m));
    }
  }

  // A file inside a selected folder is already covered by the folder; the same rel twice is sent once.
  const dirs = units.filter((u) => u.kind === 'dir' || u.kind === 'packdir');
  const seen = new Set<string>();
  const deduped: Unit[] = [];
  for (const u of units) {
    const k = relKey(u.rel, true);
    if (u.kind !== 'dir' && u.kind !== 'packdir' && dirs.some((d) => relIsWithin(u.rel, d.rel, true))) continue;
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

/** target id -> sent folder (relative to the root) -> the target's entries below it, as the plan compared them. */
export type PlanScans = Map<string, Map<string, Map<string, Entry>>>;

/** The manifest's (or a pack's) entries narrowed to what the current filter would have walked. */
function filterEntries<E extends Entry>(entries: Map<string, E>, filter: PathFilter): Map<string, E> {
  const out = new Map<string, E>();
  const dirOk = new Map<string, boolean>();
  const allowedDir = (rel: string): boolean => {
    if (!rel) return true;
    const cached = dirOk.get(rel);
    if (cached != null) return cached;
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const ok = allowedDir(parent) && filter.dir(rel);
    dirOk.set(rel, ok);
    return ok;
  };
  for (const [key, e] of entries) {
    const parent = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : '';
    if (!allowedDir(parent)) continue;
    if (e.isDir ? filter.dir(e.rel) : filter.file(e.rel, e.size, e.mtimeMs)) out.set(key, e);
  }
  return out;
}

async function planTarget(
  ctx: CoreContext,
  req: SendRequest,
  node: NodeConfig,
  units: Unit[],
  filter: PathFilter,
  cancel: CancelToken,
  warn: (message: string) => void,
  scans?: Map<string, Map<string, Entry>>,
  /** Updated as the work goes on; the caller passes it on to the window. */
  st: PlanTargetProgress = { id: node.id, name: node.name, phase: 'wait', done: 0, total: 0 },
): Promise<TargetPlan> {
  // this target's own mode and backup, when the send gives it exceptions
  const opt = targetOptions(req.options, node.id);
  // this machine itself is written on its own disk, in its first local root, not over its own share
  const isSelf = !!ctx.localNodeId && node.id === ctx.localNodeId && node.transport !== 'sftp' && !!ctx.localRoots[0];
  const base: TargetPlan = {
    targetId: node.id,
    targetName: node.name,
    root: isSelf ? ctx.localRoots[0] : nodeRootLabel(ctx.config, node),
    self: isSelf || undefined,
    mode: opt.mode,
    backup: opt.backup,
    reachable: true,
    ops: [],
    counts: emptyCounts(),
    bytes: 0,
  };
  // a machine the window saw reachable a moment ago is not asked again: one round trip less per send;
  // this machine itself is its own disk, nothing to probe
  const recent = ctx.recentProbe?.(node.id);
  if (!isSelf && !(recent?.ok && Date.now() - recent.checkedAt < RECENT_PROBE_MS)) {
    st.phase = 'probe';
    const probe = await probeNode(ctx.config, node, 1500, false);
    if (!probe.ok) {
      st.phase = 'failed';
      return { ...base, reachable: false, error: probe.detail };
    }
  }

  let tgt: Transport;
  try {
    tgt = await transportForNode(ctx, node);
  } catch (e) {
    st.phase = 'failed';
    return { ...base, reachable: false, error: errMessage(e) };
  }
  st.phase = 'compare';
  // asked now and read at the end: on a slow network it overlaps with the comparison below
  const freeSpace = tgt.freeSpace().catch(() => undefined);
  // a relay without a fresh heartbeat has no SamSync running: it is written to directly, nobody waits for it
  const heartbeat = node.relay && node.transport !== 'sftp' && !req.direct ? readHeartbeat(tgt).then((h) => heartbeatFresh(h)) : Promise.resolve(true);
  // someone else writing here right now shows in the review
  const lock = otherLock(tgt, myLock(req.label ?? '', ctx.appVersion)).catch(() => null);
  let fromManifest: number | undefined;
  const b: OpBuilder = { ops: [], counts: emptyCounts() };
  const time = { toleranceMs: ctx.config.copy.timeToleranceSec * 1000, ignoreDstShift: ctx.config.copy.ignoreDstShift };

  const classify = async (src: { size: number; mtimeMs: number }, dst: Entry, readSrc: () => Promise<NodeJS.ReadableStream>, rel: string, srcId: string): Promise<PlanCategory> => {
    const v = compareMeta(src, dst, opt.compare, time);
    if (v === 'equal') return 'same';
    if (v === 'needsContent') {
      // hashes remembered from an earlier comparison or copy spare the read over the network
      const cache = ctx.hashCache;
      if (!cache) {
        const same = await streamsEqual((await readSrc()) as any, await tgt.readStream(rel));
        st.read = (st.read ?? 0) + src.size + dst.size;
        return same ? 'same' : 'changed';
      }
      const dh = cache.get(tgt.root, rel, dst.size, dst.mtimeMs);
      const sh = cache.get('src', srcId, src.size, src.mtimeMs);
      if (dh && sh) return dh === sh ? 'same' : 'changed';
      if (dh) {
        const h = await hashStream((await readSrc()) as any);
        st.read = (st.read ?? 0) + src.size;
        cache.set('src', srcId, src.size, src.mtimeMs, h);
        return h === dh ? 'same' : 'changed';
      }
      const [a, b] = await Promise.all([hashStream((await readSrc()) as any), hashStream(await tgt.readStream(rel))]);
      st.read = (st.read ?? 0) + src.size + dst.size;
      cache.set('src', srcId, src.size, src.mtimeMs, a);
      cache.set(tgt.root, rel, dst.size, dst.mtimeMs, b);
      return a === b ? 'same' : 'changed';
    }
    if (v === 'dstNewer') return 'targetNewer';
    return 'changed';
  };

  try {
    await mapLimit(units, 12, async (u) => {
      cancel.throwIfCancelled();
      if (u.kind === 'delete') {
        const dst = await tgt.stat(u.rel);
        st.done++;
        if (!dst) return push(b, { kind: 'delete', rel: u.rel, isDir: false, category: 'same', size: 0, selected: false, sourceIndex: u.sourceIndex });
        push(b, { kind: 'delete', rel: u.rel, isDir: dst.isDir, category: 'deleted', size: dst.size, dstMtime: dst.mtimeMs, dstSize: dst.size, selected: opt.propagateDeletes, sourceIndex: u.sourceIndex });
        return;
      }
      if (u.kind === 'file' || u.kind === 'git' || u.kind === 'packfile') {
        // counted once this file is decided, whichever way it goes
        try {
          await fileUnit(u);
        } finally {
          st.done++;
        }
        return;
      }
      await dirUnit(u);
    });
  } catch (e) {
    await Promise.all([freeSpace, heartbeat, lock]);
    await tgt.close();
    st.phase = 'failed';
    if (cancel.cancelled) throw e;
    return { ...base, reachable: false, failed: true, error: errMessage(e), counts: b.counts, ops: b.ops };
  }

  async function fileUnit(u: Extract<Unit, { kind: 'file' | 'git' | 'packfile' }>): Promise<void> {
    const dst = await tgt.stat(u.rel);
    const src = u.kind === 'file' ? ({ kind: 'fs', abs: u.abs } as const) : u.kind === 'git' ? ({ kind: 'git', repo: u.repo, rev: u.rev, path: u.path, blob: u.blob } as const) : packRef(u.file, u.member);
    const common = { kind: 'copy' as const, rel: u.rel, isDir: false, src, size: u.size, srcMtime: u.mtimeMs, sourceIndex: u.sourceIndex };
    if (!dst) return push(b, { ...common, category: 'new', selected: true });
    if (dst.isDir) return push(b, { ...common, category: 'changed', selected: true, dstMtime: dst.mtimeMs, replaceType: true, note: t('Hedefte aynı adda klasör var; klasör kaldırılıp dosya yazılacak.') });
    let cat: PlanCategory;
    if (u.kind === 'git' || (u.kind === 'file' && u.blob)) {
      // Commit content: the blob id tells equality exactly, time stamps mean nothing here.
      if (dst.size !== u.size) cat = 'changed';
      else {
        cat = (await gitBlobId(await tgt.readStream(u.rel), dst.size)) === u.blob ? 'same' : 'changed';
        st.read = (st.read ?? 0) + dst.size;
      }
    } else if (u.kind === 'packfile') {
      cat = await classify(u, dst, async () => openPackEntry(u.file, u.member), u.rel, `${u.file}#${u.member.offset}`);
    } else {
      cat = await classify(u, dst, async () => fs.createReadStream(u.abs), u.rel, u.abs);
    }
    return push(b, { ...common, category: cat, dstMtime: dst.mtimeMs, dstSize: dst.size, selected: cat === 'targetNewer' ? opt.mode !== 'update' : cat !== 'same' });
  }

  async function dirUnit(u: Extract<Unit, { kind: 'dir' | 'packdir' }>): Promise<void> {
    const dstRoot = await tgt.stat(u.rel);
    if (dstRoot && !dstRoot.isDir) {
      push(b, { kind: 'mkdir', rel: u.rel, isDir: true, category: 'changed', size: 0, selected: true, sourceIndex: u.sourceIndex, replaceType: true, note: t('Hedefte aynı adda dosya var; dosya kaldırılıp klasör oluşturulacak.') });
    } else if (!dstRoot) {
      push(b, { kind: 'mkdir', rel: u.rel, isDir: true, category: 'new', size: 0, selected: true, sourceIndex: u.sourceIndex });
    }
    // older backup folders at the target root are neither compared, written to nor deleted (not even by a mirror)
    const kept = !u.rel && dstRoot?.isDir ? await otherBackupRoots(tgt, ctx.config.copy.backupFolderName) : [];
    const keptKeys = new Set(kept.map((k) => k.toLowerCase()));
    const inKept = (rel: string) => keptKeys.has(rel.split('/')[0].toLowerCase());
    if (kept.length && opt.mode === 'mirror') warn(t('{name}: {folders} yedek klasörü olarak tanındı; ayna kipinde silinmez.', { name: node.name, folders: kept.join(', ') }));
    // the manifest first: what SamSync left here last time, checked against a sample of the folder
    const unitFilter = withTopDirsExcluded(filter, kept);
    // (not for a comparison, a send that asks for a full scan, or when the settings turned the manifest off)
    const manifestDays = ctx.config.copy.manifestMaxDays ?? 7;
    const manifest = dstRoot?.isDir && !req.direct && !req.options.fullScan && manifestDays > 0 && tgt.kind === 'fs' ? await manifestEntries(tgt, u.rel, Date.now(), manifestDays * 86400_000).catch(() => null) : null;
    if (manifest) {
      fromManifest = Math.min(fromManifest ?? Infinity, manifest.writtenAt);
      ctx.log.info(t('Plan'), t('{name}: {path} manifestten alındı ({n} kayıt, {checked} örnek doğrulandı)', { name: node.name, path: u.rel || '/', n: manifest.entries.size, checked: manifest.checked }));
    }
    let listed = 0;
    const onListed = (n: number) => {
      if (st.phase === 'compare') st.phase = 'scan';
      st.listed = (st.listed ?? 0) + n - listed;
      listed = n;
    };
    const dstScan = manifest ? null : dstRoot?.isDir ? await scanTree(tgt, u.rel, { filter: unitFilter, cancel, caseInsensitive: true, onProgress: onListed }) : null;
    st.phase = 'compare';
    const dstEntries = manifest ? filterEntries(manifest.entries, unitFilter) : (dstScan?.entries ?? new Map<string, Entry>());
    scans?.set(u.rel, dstEntries);
    // a folder on disk is read from there; a folder in a pack straight out of the pack
    const local = u.kind === 'dir' ? new FsTransport(u.abs) : null;
    const srcOf = (e: PackedEntry) => (local ? ({ kind: 'fs', abs: local.localPath(e.rel) } as const) : packRef((u as { file: string }).file, e.member!));
    const readSrc = (e: PackedEntry) => (local ? local.readStream(e.rel) : Promise.resolve(openPackEntry((u as { file: string }).file, e.member!)));
    const files: [string, PackedEntry][] = [];
    for (const [key, e] of u.entries as Map<string, PackedEntry>) {
      if (inKept(e.rel)) {
        if (!e.isDir) st.done++;
        continue;
      }
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
      const common = { kind: 'copy' as const, rel, isDir: false, src: srcOf(e), size: e.size, srcMtime: e.mtimeMs, sourceIndex: u.sourceIndex };
      try {
        if (!d) return push(b, { ...common, category: 'new', selected: true });
        if (d.isDir) return push(b, { ...common, category: 'changed', selected: true, dstMtime: d.mtimeMs, replaceType: true, note: t('Hedefte aynı adda klasör var.') });
        const cat = await classify(e, d, () => readSrc(e), rel, local ? local.localPath(e.rel) : `${(u as { file: string }).file}#${e.member!.offset}`);
        push(b, { ...common, category: cat, dstMtime: d.mtimeMs, dstSize: d.size, selected: cat === 'targetNewer' ? opt.mode !== 'update' : cat !== 'same' });
      } finally {
        st.done++;
      }
    });
    // extras: on the target but not in the source
    const extras = [...dstEntries.entries()].filter(([k]) => !u.entries.has(k)).map(([, e]) => e).sort((x, y) => x.rel.localeCompare(y.rel));
    const removedDirs: string[] = [];
    for (const e of extras) {
      if (removedDirs.some((d) => relIsWithin(e.rel, d, true))) continue;
      if (e.isDir) removedDirs.push(e.rel);
      push(b, { kind: 'delete', rel: relJoin(u.rel, e.rel), isDir: e.isDir, category: 'extra', size: e.size, dstMtime: e.mtimeMs, dstSize: e.size, selected: opt.mode === 'mirror', sourceIndex: u.sourceIndex });
    }
  }

  st.phase = 'done';
  b.ops.sort((x, y) => x.rel.localeCompare(y.rel));
  b.ops.forEach((op, i) => (op.id = String(i)));
  const bytes = b.ops.filter((o) => o.selected && o.kind === 'copy').reduce((s, o) => s + o.size, 0);
  const freeBytes = await freeSpace;
  const alive = await heartbeat;
  const other = await lock;
  await tgt.close();
  if (other) warn(t('{name}: {user} ({host}) {ago} önce yazmaya başladı ({label}); aynı anda gönderirseniz dosyalar karışabilir.', { name: node.name, user: other.user, host: other.host, ago: agoMinutes(other.startedAt), label: other.label }));
  return { ...base, ops: b.ops, counts: b.counts, bytes, freeBytes, relayDown: alive ? undefined : true, lock: other ? { host: other.host, user: other.user, label: other.label, startedAt: other.startedAt } : undefined, fromManifest };
}

function agoMinutes(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? t('az') : t('{n} dk', { n: m });
}

export async function buildSendPlan(
  ctx: CoreContext,
  req: SendRequest,
  opts: {
    cancel?: CancelToken;
    onProgress?: (p: PlanProgress) => void;
    /** false: write to every machine yourself, even where a relay would take over (comparisons, a relay that did not answer) */
    relay?: boolean;
    /** Filled with what the plan saw on each target, so the run can leave an up-to-date manifest there. */
    scans?: PlanScans;
  } = {},
): Promise<SendPlan> {
  const started = Date.now();
  const cancel = opts.cancel ?? new CancelToken();
  const progress = opts.onProgress ?? (() => undefined);
  const filter = sendFilter(ctx, req, await sendIgnorePatterns(req));
  const { units, warnings, sources } = await expandUnits(ctx, req, filter, cancel, progress);

  const requested = req.targetIds;
  // a pack, or a release from somewhere outside this machine's roots, may be applied to this very machine
  const selfOk = selfTargetOk(ctx, req);
  const all = expandTargetIds(ctx.config, requested, selfOk ? undefined : ctx.localNodeId);
  if (!selfOk && ctx.localNodeId && requested.some((id) => id.toLowerCase() === ctx.localNodeId!.toLowerCase()))
    warnings.push(t('Bu makinenin kendisi hedef listesinden çıkarıldı (kaynak ile hedef aynı olurdu).'));
  if (!all.length) warnings.push(t('Gönderilecek etkin hedef yok.'));
  // a relay among the targets takes the other machines of its group: they are not looked at from here
  // (this machine itself, when a pack is applied here, is written directly: it would be its own relay)
  const routing = opts.relay === false || req.direct ? { direct: all, via: new Map<string, NodeConfig[]>() } : relayRouting(all.map((n) => (n.id === ctx.localNodeId ? { ...n, relay: false } : n)));
  const nodes = routing.direct;

  let done = 0;
  // each target's progress, sent on to the window a few times a second (and at every target that finishes)
  const files = fileCount(units);
  const states: PlanTargetProgress[] = nodes.map((n) => ({ id: n.id, name: n.name, phase: 'wait', done: 0, total: files }));
  const report = () => {
    const filesDone = states.reduce((s, x) => s + (x.phase === 'done' || x.phase === 'failed' ? x.total : Math.min(x.done, x.total)), 0);
    const filesTotal = states.reduce((s, x) => s + x.total, 0);
    progress({
      message: t('{done} / {total} makine incelendi', { done, total: nodes.length }),
      done: filesTotal ? filesDone : done,
      total: filesTotal || nodes.length,
      targets: states.map((x) => ({ ...x })),
    });
  };
  report();
  const ticker = setInterval(report, 300);
  const scansFor = (id: string) => {
    if (!opts.scans) return undefined;
    const m = opts.scans.get(id) ?? new Map<string, Map<string, Entry>>();
    opts.scans.set(id, m);
    return m;
  };
  let planned: TargetPlan[];
  try {
    planned = await mapLimit(nodes, 6, async (n, i) => {
      const tp = await planTarget(ctx, req, n, units, filter, cancel, (m) => warnings.push(m), scansFor(n.id), states[i]);
      if (!tp.reachable) states[i].phase = 'failed';
      done++;
      report();
      return tp;
    });
  } finally {
    clearInterval(ticker);
  }
  // a relay whose SamSync is not running: the machines behind it are looked at and written to from here
  const behindDown = new Map<string, NodeConfig[]>();
  for (const tp of planned) {
    if (!tp.relayDown || !routing.via.has(tp.targetId)) continue;
    const behind = routing.via.get(tp.targetId) ?? [];
    behindDown.set(tp.targetId, behind);
    routing.via.delete(tp.targetId);
    warnings.push(t('{name} röle olarak işaretli ama orada SamSync çalışmıyor; {names} doğrudan gönderilecek.', { name: tp.targetName, names: behind.map((n) => n.name).join(', ') }));
  }
  const directPlanned = new Map<string, TargetPlan>();
  await mapLimit([...behindDown.values()].flat(), 6, async (n) => {
    directPlanned.set(n.id, await planTarget(ctx, req, n, units, filter, cancel, (m) => warnings.push(m), scansFor(n.id)));
  });
  // the relayed machines follow their relay in the list, reachable as far as the relay is
  const targets: TargetPlan[] = [];
  for (const tp of planned) {
    targets.push(tp);
    for (const n of behindDown.get(tp.targetId) ?? []) {
      const d = directPlanned.get(n.id);
      if (d) targets.push(d);
    }
    for (const n of routing.via.get(tp.targetId) ?? []) {
      const opt = targetOptions(req.options, n.id);
      const base = { targetId: n.id, targetName: n.name, root: nodeRootLabel(ctx.config, n), mode: opt.mode, backup: opt.backup, ops: [], counts: emptyCounts(), bytes: 0, via: tp.targetId };
      targets.push(tp.reachable ? { ...base, reachable: true } : { ...base, reachable: false, error: t('Röle {name} erişilemedi', { name: tp.targetName }) });
    }
  }
  if (routing.via.size) warnings.push(t('{names} dosyaları {relays} üzerinden alacak: önce oraya gider, oradaki SamSync dağıtır.', { names: [...routing.via.values()].flat().map((n) => n.name).join(', '), relays: [...routing.via.keys()].map((id) => planned.find((p) => p.targetId === id)?.targetName ?? id).join(', ') }));

  for (const tp of targets) {
    if (tp.freeBytes != null && tp.bytes > tp.freeBytes)
      warnings.push(t('{name}: hedefte {free} boş alan var, {size} yazılacak.', { name: tp.targetName, free: formatBytes(tp.freeBytes), size: formatBytes(tp.bytes) }));
  }
  const mirrors = targets.filter((tp) => tp.mode === 'mirror');
  if (mirrors.length) {
    const del = mirrors.reduce((s, tp) => s + tp.ops.filter((o) => o.selected && o.kind === 'delete').length, 0);
    if (del) warnings.push(t('Ayna kipi: hedeflerde toplam {n} fazla öğe silinecek.', { n: del }));
  }
  return { id: newId('plan-'), createdAt: Date.now(), request: req, targets, sources, warnings, durationMs: Date.now() - started };
}

/**
 * Writes the sources of a send to a pack file instead of to machines: everything the plan would have compared,
 * with the send's exclusions and ignore files applied. The pack is a source like a folder afterwards.
 */
export async function writeSendPack(ctx: CoreContext, req: SendRequest, file: string, opts: { cancel?: CancelToken; onProgress?: (p: PlanProgress) => void; password?: string } = {}): Promise<PackWriteResult> {
  const cancel = opts.cancel ?? new CancelToken();
  const progress = opts.onProgress ?? (() => undefined);
  const filter = sendFilter(ctx, req, await sendIgnorePatterns(req));
  const { units, warnings } = await expandUnits(ctx, req, filter, cancel, progress);
  const files: PackSource[] = [];
  const dirs: string[] = [];
  const subtrees: PackSubtree[] = [];
  for (const u of units) {
    if (u.kind === 'delete') {
      warnings.push(t('{path} silme olarak işaretli; paket silme taşımaz, atlandı.', { path: u.abs }));
      continue;
    }
    subtrees.push({ rel: u.rel, isDir: u.kind === 'dir' || u.kind === 'packdir' });
    if (u.kind === 'file') files.push({ rel: u.rel, size: u.size, mtimeMs: u.mtimeMs, open: () => fs.createReadStream(u.abs, { highWaterMark: 1024 * 1024 }) });
    else if (u.kind === 'git') files.push({ rel: u.rel, size: u.size, mtimeMs: u.mtimeMs, open: () => blobStream(u.repo, u.rev, u.path) });
    else if (u.kind === 'packfile') files.push({ rel: u.rel, size: u.size, mtimeMs: u.mtimeMs, open: () => openPackEntry(u.file, u.member) });
    else {
      const local = u.kind === 'dir' ? new FsTransport(u.abs) : null;
      for (const e of u.entries.values() as Iterable<PackedEntry>) {
        const rel = relJoin(u.rel, e.rel);
        if (e.isDir) dirs.push(rel);
        else if (local) files.push({ rel, size: e.size, mtimeMs: e.mtimeMs, open: () => fs.createReadStream(local.localPath(e.rel), { highWaterMark: 1024 * 1024 }) });
        else files.push({ rel, size: e.size, mtimeMs: e.mtimeMs, open: () => openPackEntry((u as { file: string }).file, e.member!) });
      }
    }
  }
  if (!files.length && !dirs.length) throw new Error(t('Pakete yazılacak bir şey yok.'));
  const total = files.length;
  const label = req.label || t('Gönderim');
  progress({ message: t('Paket yazılıyor'), done: 0, total });
  const idx = await writePackFile(file, { label, subtrees, files, dirs, node: ctx.localNodeId, version: ctx.appVersion, signal: cancel.signal, password: opts.password }, (done, bytes) =>
    progress({ message: t('Paket yazılıyor: {done}/{total} dosya, {size}', { done, total, size: formatBytes(bytes) }), done, total }),
  );
  const packed = (await fsp.stat(file)).size;
  return { file, files: idx.files, size: idx.size, packed, warnings };
}
