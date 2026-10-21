import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { CategoryCounts, NodeConfig, OutsideRoots, PackWriteResult, PlainSrc, PlanCategory, PlanOp, PlanTargetProgress, RelayStash, SendPlan, SendRequest, SourceInfo, SourcePlace, SrcRef, StashFile, TargetPlan } from '../shared/types';
import type { CoreContext } from './context';
import { expandTargetIds } from './context';
import { makeFilter, pathMatcher, withTopDirsExcluded, type PathFilter } from './filter';
import { isUnder, mapSource, mapToRel, normalizeAbs, outsidePlaces, pathKey, relKey, relIsWithin, relJoin, toPosix, type SourceMapping } from './paths';
import { scanTree } from './scan';
import { FsTransport, InUseError, transportForNode, nodeRootLabel, type Transport, type Entry } from './transport';
import { compareMeta, gitBlobId, hashStream, sameTime, streamsEqual } from './compare';
import { blobInfo, blobStream } from './git';
import { openPackEntry, type PackEntry, type PackSource } from './pack';
import { isPackFile, packFileEntry, packSubtreeEntries, readPackIndex, writePackFile, type PackIndex, type PackIndexEntry, type PackSubtree } from './packfile';
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
import { AgentHasher } from './agenthash';
import { myLock, otherLock } from './lock';
import { manifestEntries } from './manifest';
import { machineLabel } from '../shared/machine';
import { TEMPLATE_MAX, fillMachineVars, machineVars, readPlain, templateText } from './template';

/** member: where a pack holds the file. abs: a file merged in from another folder sent to the same place. */
/** overlay: the machine or group folder this entry came from (Settings › Copy › machine folder). */
type PackedEntry = Entry & { member?: PackEntry; abs?: string; ref?: boolean; overlay?: string };

type Unit =
  | { kind: 'file'; sourceIndex: number; rel: string; abs: string; size: number; mtimeMs: number; blob?: string }
  /** skip: parts below rel that another source of the send takes over on the targets (left alone here). */
  /** overlays: machine or group name (lower case) -> what the machine folder holds for it, laid over the entries. */
  | { kind: 'dir'; sourceIndex: number; rel: string; abs: string; entries: Map<string, PackedEntry>; skip?: string[]; overlays?: Map<string, Map<string, PackedEntry>> }
  | { kind: 'git'; sourceIndex: number; rel: string; repo: string; rev: string; path: string; blob: string; size: number; mtimeMs: number }
  | { kind: 'delete'; sourceIndex: number; rel: string; abs: string }
  /** A file or a folder carried in a pack file (.samsync-pack); members are read straight out of it. */
  | { kind: 'packfile'; sourceIndex: number; rel: string; file: string; size: number; mtimeMs: number; member: PackIndexEntry }
  | { kind: 'packdir'; sourceIndex: number; rel: string; file: string; entries: Map<string, PackedEntry>; skip?: string[]; overlays?: Map<string, Map<string, PackedEntry>> };

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
  return { label: idx.label, createdAt: idx.createdAt, from: idx.from.user ? `${idx.from.user}@${idx.from.host}` : idx.from.host, files: idx.files, size: idx.size, subtrees: idx.subtrees.map((s) => s.rel || '/'), encrypted: idx.encrypted || undefined, refs: idx.refs, since: idx.since };
}

/** A password-protected pack that could not be opened, as the Send page shows it (with the pack's size on disk). */
function lockedInfo(abs: string, st: fs.Stats, e: unknown): SourceInfo {
  return { path: abs, exists: true, isDir: false, size: st.size, mtimeMs: st.mtimeMs, rel: '', outsideRoots: false, locked: e instanceof PackPasswordError ? 'wrong' : 'password' };
}

/** The mapping fields of a SourceInfo; outside every root also the other places the source could take. */
function placeInfo(abs: string, isDir: boolean, m: SourceMapping, roots: readonly string[], mode: OutsideRoots): Pick<SourceInfo, 'rel' | 'root' | 'outsideRoots' | 'base' | 'full' | 'places' | 'defaultRel'> {
  // where it goes unless a place is picked by hand, and the places that can be picked: under a root its path
  // by the root comes first, then (as for a source outside every root) each folder above it as the target root
  const def = mapSource(abs, roots, isDir, mode);
  const all: SourcePlace[] = def.outside ? outsidePlaces(abs, isDir) : [{ rel: def.rel, root: def.root }, ...outsidePlaces(abs, isDir)];
  const seen = new Set<string>();
  const places = all.filter((p) => {
    const k = relKey(p.rel, true);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!m.outside) return { rel: m.rel, root: m.root, outsideRoots: false, places, defaultRel: def.rel };
  return { rel: m.rel, outsideRoots: true, base: m.base, full: m.full, places, defaultRel: def.rel };
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
        return { path: abs, exists: true, isDir: true, size: c.bytes, fileCount: c.files, fileCountCapped: c.capped, mtimeMs: st.mtimeMs, ...placeInfo(abs, true, m, ctx.localRoots, outside) };
      }
      return { path: abs, exists: true, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs, ...placeInfo(abs, st.isDirectory(), m, ctx.localRoots, outside) };
    } catch (e) {
      return { path: abs, exists: false, isDir: false, size: 0, mtimeMs: 0, rel: m.rel, root: m.root, outsideRoots: m.outside, error: errMessage(e) };
    }
  });
}

/**
 * Takes the machine folder out of a sent folder: what it holds for each machine or group goes to unit.overlays,
 * rebased to the folder's own root, and is laid over the rest for those machines only (withOverlays).
 */
function splitOverlays(u: Extract<Unit, { kind: 'dir' | 'packdir' }>, folder: string): void {
  const top = folder.toLowerCase();
  const overlays = new Map<string, Map<string, PackedEntry>>();
  for (const [key, e] of u.entries) {
    const parts = e.rel.split('/');
    if (parts[0].toLowerCase() !== top) continue;
    u.entries.delete(key);
    // the folder itself and the machine folders in it are not entries of their own
    if (parts.length < 3) continue;
    const rel = parts.slice(2).join('/');
    const m = overlays.get(parts[1].toLowerCase()) ?? new Map<string, PackedEntry>();
    m.set(relKey(rel, true), { ...e, rel, overlay: parts[1], abs: u.kind === 'dir' ? (e.abs ?? path.join(u.abs, ...parts)) : e.abs });
    overlays.set(parts[1].toLowerCase(), m);
  }
  if (overlays.size) u.overlays = overlays;
}

/** The machine folder names that are a machine's own, its group's first (lower case). */
function overlayNames(node: NodeConfig): string[] {
  return [...new Set([node.group, machineLabel(node.name, node.address).title, node.address, node.name, node.id].filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
}

/** The units as one machine gets them: its group's folder over the common files, then its own over both. */
function withOverlays(units: Unit[], node: NodeConfig): Unit[] {
  if (!units.some((u) => (u.kind === 'dir' || u.kind === 'packdir') && u.overlays)) return units;
  const names = overlayNames(node);
  return units.map((u) => {
    if ((u.kind !== 'dir' && u.kind !== 'packdir') || !u.overlays) return u;
    const picked = names.map((n) => u.overlays!.get(n)).filter((m): m is Map<string, PackedEntry> => !!m);
    if (!picked.length) return u;
    const entries = new Map(u.entries);
    for (const m of picked) for (const [k, e] of m) entries.set(k, e);
    return { ...u, entries };
  });
}

/** Files with machine variables: which ones, their text once read, the raw files a relay needs, and on a relay its stash. */
interface VarsCtx {
  match: (rel: string) => boolean;
  texts: Map<string, Promise<string | null>>;
  /** target rel -> the raw file it was filled in from (for the stash of a relay) */
  used: Map<string, { src: PlainSrc; size: number; mtimeMs: number }>;
  /** on a relay: the raw file a sender left for a target rel (its own copy is filled in for itself) */
  raw?: (rel: string) => string | undefined;
}

const plainKey = (s: PlainSrc) => (s.kind === 'fs' ? s.abs : s.kind === 'pack' ? `${s.file}#${s.offset}` : `${s.repo}#${s.rev}#${s.path}`);

/** A file with machine variables, filled in for this machine; null for any other file. */
async function varsFor(v: VarsCtx | undefined, rel: string, src: PlainSrc, size: number, mtimeMs: number, node: NodeConfig): Promise<{ buf: Buffer; src: SrcRef } | null> {
  if (!v || size > TEMPLATE_MAX || !v.match(rel)) return null;
  const rawAbs = v.raw?.(rel);
  const from: PlainSrc = rawAbs ? { kind: 'fs', abs: rawAbs } : src;
  const key = plainKey(from);
  let text = v.texts.get(key);
  if (!text) {
    text = readPlain(from)
      .then(templateText)
      .catch(() => null);
    v.texts.set(key, text);
  }
  const body = await text;
  if (body == null) return null;
  if (!rawAbs) v.used.set(rel, { src: from, size, mtimeMs });
  const vars = machineVars(node);
  return { buf: fillMachineVars(body, vars), src: { kind: 'vars', from, vars } };
}

/** On a relay: the stash a sender left for this job (see RelayStash), in the folder named. */
export interface StashIn extends RelayStash {
  dir: string;
}

/** On a relay: the common files, the files only it got and the machine folder, from the stash, for the machines behind it. */
async function applyStash(units: Unit[], stash: StashIn): Promise<void> {
  for (const s of stash.units) {
    const u = units.find((x): x is Extract<Unit, { kind: 'dir' }> => x.kind === 'dir' && relKey(x.rel, true) === relKey(s.rel, true));
    if (!u) continue;
    const base = path.join(stash.dir, s.dir);
    for (const rel of s.common) {
      const abs = path.join(base, 'c', ...rel.split('/'));
      const st = await fsp.stat(abs).catch(() => null);
      if (st?.isFile()) u.entries.set(relKey(rel, true), { rel, isDir: false, size: st.size, mtimeMs: Math.floor(st.mtimeMs), abs });
    }
    for (const rel of s.drop) u.entries.delete(relKey(rel, true));
    const mdir = path.join(base, 'm');
    const scan = await scanTree(new FsTransport(mdir), '', { caseInsensitive: true }).catch(() => null);
    if (!scan?.exists) continue;
    const overlays = u.overlays ?? new Map<string, Map<string, PackedEntry>>();
    for (const e of scan.entries.values()) {
      const parts = e.rel.split('/');
      if (parts.length < 2) continue;
      const rel = parts.slice(1).join('/');
      const m = overlays.get(parts[0].toLowerCase()) ?? new Map<string, PackedEntry>();
      m.set(relKey(rel, true), { ...e, rel, overlay: parts[0], abs: path.join(mdir, ...parts) });
      overlays.set(parts[0].toLowerCase(), m);
    }
    if (overlays.size) u.overlays = overlays;
  }
}

/**
 * What each relay with machines behind it needs besides its own copy: its own copy holds its own machine files and
 * its own filled-in variables, so the machine folder, the common files it replaced, the files only it got and the
 * raw text of the files with variables go to its stash, and it sends the right ones on to each machine.
 */
function relayStashes(ctx: CoreContext, units: Unit[], vars: VarsCtx | undefined, relayIds: string[]): SendPlan['stash'] {
  type Folder = Extract<Unit, { kind: 'dir' | 'packdir' }>;
  const folders = units.filter((u): u is Folder => (u.kind === 'dir' || u.kind === 'packdir') && !!u.overlays);
  if (!relayIds.length || (!folders.length && !vars?.used.size)) return undefined;
  const srcOfEntry = (u: Folder, e: PackedEntry): PlainSrc => (u.kind === 'dir' ? { kind: 'fs', abs: e.abs ?? path.join(u.abs, ...e.rel.split('/')) } : packRef(u.file, e.member!));
  const out: NonNullable<SendPlan['stash']> = {};
  for (const id of relayIds) {
    const node = ctx.config.nodes.find((n) => n.id === id);
    if (!node) continue;
    const info: RelayStash = { units: [], raw: [] };
    const files: StashFile[] = [];
    folders.forEach((u, i) => {
      const dir = `u${i}`;
      for (const [name, m] of u.overlays!) for (const e of m.values()) if (!e.isDir) files.push({ rel: `${dir}/m/${e.overlay ?? name}/${e.rel}`, src: srcOfEntry(u, e), size: e.size, mtimeMs: e.mtimeMs });
      const common: string[] = [];
      const drop: string[] = [];
      for (const name of overlayNames(node)) {
        for (const [key, e] of u.overlays!.get(name) ?? []) {
          if (e.isDir || common.includes(e.rel) || drop.includes(e.rel)) continue;
          const c = u.entries.get(key);
          if (c && !c.isDir) {
            common.push(e.rel);
            files.push({ rel: `${dir}/c/${e.rel}`, src: srcOfEntry(u, c), size: c.size, mtimeMs: c.mtimeMs });
          } else drop.push(e.rel);
        }
      }
      info.units.push({ rel: u.rel, dir, common, drop });
    });
    for (const [rel, v] of vars?.used ?? []) {
      info.raw.push(rel);
      files.push({ rel: `raw/${rel}`, src: v.src, size: v.size, mtimeMs: v.mtimeMs });
    }
    out[id] = { info, files };
  }
  return out;
}

/** `overlays` false keeps the machine folder in the folders as it is (a pack carries it to wherever it is applied). */
async function expandUnits(ctx: CoreContext, req: SendRequest, filter: PathFilter, cancel: CancelToken, progress: (p: PlanProgress) => void, overlays = true, stash?: StashIn) {
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
      sources.push({ path: abs, exists: true, isDir: true, size, fileCount: files, mtimeMs: st.mtimeMs, ...placeInfo(abs, true, m, ctx.localRoots, outside) });
    } else {
      units.push({ kind: 'file', sourceIndex: i, rel: m.rel, abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      sources.push({ path: abs, exists: true, isDir: false, size: st.size, mtimeMs: st.mtimeMs, ...placeInfo(abs, false, m, ctx.localRoots, outside) });
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

  const layered = layerUnits(units, warnings);
  const folder = overlays ? ctx.config.copy.machineFolder : '';
  if (folder) for (const u of layered) if (u.kind === 'dir' || u.kind === 'packdir') splitOverlays(u, folder);
  if (stash) await applyStash(layered, stash);
  return { units: layered, warnings, sources };
}

/** Where a unit's content comes from: a path on disk, or the pack it is read out of. */
function originOf(u: Unit): string {
  if (u.kind === 'dir' || u.kind === 'file' || u.kind === 'delete') return pathKey(u.abs);
  if (u.kind === 'git') return pathKey(path.join(u.repo, u.path));
  return `pack:${pathKey(u.file)}`;
}

/** `rel` below `parent` (both target paths, the first within the second). */
function relBelow(rel: string, parent: string): string {
  return parent ? rel.slice(parent.length + 1) : rel;
}

/**
 * Sources that land in the same place, or inside one another, on the targets.
 * - Two folders on disk for the same place: their contents are merged; a file both hold comes from the one
 *   listed first, and the review says how many there were.
 * - Anything else for the same place twice: the first source is sent, the review says which one was left out.
 * - Inside a sent folder and from the same place (Release and Release\Data): the folder already carries it.
 * - Inside a sent folder but from somewhere else (a Contents folder from another disk sent into Contents
 *   while Release goes to the root): the deeper source takes that part of the targets over, and the outer
 *   folder neither compares, writes nor deletes there.
 */
function layerUnits(units: Unit[], warnings: string[]): Unit[] {
  const first = new Map<string, Unit>();
  const unique: Unit[] = [];
  const shown = (u: Unit) => (u.kind === 'git' ? u.path : u.kind === 'packdir' || u.kind === 'packfile' ? u.file : u.abs);
  for (const u of units) {
    const k = relKey(u.rel, true);
    const prev = first.get(k);
    if (prev) {
      if (originOf(prev) === originOf(u)) continue;
      if (prev.kind === 'dir' && u.kind === 'dir') {
        let clash = 0;
        for (const [key, e] of u.entries) {
          const have = prev.entries.get(key);
          if (have) {
            if (!(have.isDir && e.isDir)) clash++;
            continue;
          }
          prev.entries.set(key, { ...e, abs: e.abs ?? path.join(u.abs, e.rel) });
        }
        if (clash) warnings.push(t('{n} öğe hem {first} hem {other} içinde var; {first} içindekiler gönderilecek.', { n: clash, first: prev.abs, other: u.abs }));
        continue;
      }
      warnings.push(t('{path} hedeflerde {other} ile aynı yere gidiyor ({rel}); yalnızca {other} gönderilecek.', { path: shown(u), other: shown(prev), rel: u.rel || '/' }));
      continue;
    }
    first.set(k, u);
    unique.push(u);
  }
  type Folder = Extract<Unit, { kind: 'dir' | 'packdir' }>;
  const folders = unique.filter((u): u is Folder => u.kind === 'dir' || u.kind === 'packdir');
  const carries = (outer: Folder, inner: Unit): boolean => {
    const sub = relBelow(inner.rel, outer.rel);
    if (!outer.entries.has(relKey(sub, true))) return false;
    return outer.kind === 'packdir' ? originOf(inner) === originOf(outer) : originOf(inner) === pathKey(path.join(outer.abs, sub));
  };
  const out: Unit[] = [];
  for (const u of unique) {
    const outers = folders.filter((d) => d !== u && relKey(d.rel, true) !== relKey(u.rel, true) && relIsWithin(u.rel, d.rel, true));
    if (outers.some((d) => carries(d, u))) continue;
    for (const d of outers) {
      const sub = relBelow(u.rel, d.rel);
      (d.skip ??= []).push(sub);
      for (const [key, e] of d.entries) if (relIsWithin(e.rel, sub, true)) d.entries.delete(key);
    }
    out.push(u);
  }
  return out;
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
  vars?: VarsCtx,
): Promise<TargetPlan> {
  // this target's own mode and backup, when the send gives it exceptions
  const opt = targetOptions(req.options, node.id);
  // the files of the machine folder meant for this machine (or its group) are laid over the rest
  units = withOverlays(units, node);
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
  // SamSync running on the machine (relay or not) takes the changes as a pack; its heartbeat on the share says so
  const askBeat = node.transport !== 'sftp' && !req.direct && !isSelf;
  // content comparison: SamSync there hashes its own disk instead of every file coming back over the network;
  // a direct look (the Compare page, --check-only) asks too: hashes are only read, nothing goes through the machine
  const wantHashes = opt.compare === 'content' && node.transport !== 'sftp' && !isSelf && tgt.kind === 'fs';
  const beat = askBeat || wantHashes ? readHeartbeat(tgt).catch(() => null) : Promise.resolve(null);
  const heartbeat = askBeat ? beat.then((h) => heartbeatFresh(h)) : Promise.resolve(!!node.relay && !req.direct);
  const hasher = wantHashes ? beat.then((h) => (heartbeatFresh(h) && h!.hashes ? new AgentHasher(tgt, () => cancel.cancelled) : null)) : Promise.resolve(null);
  // someone else writing here right now shows in the review
  const lock = otherLock(tgt, myLock(req.label ?? '', ctx.appVersion)).catch(() => null);
  let fromManifest: number | undefined;
  const b: OpBuilder = { ops: [], counts: emptyCounts() };
  const time = { toleranceMs: ctx.config.copy.timeToleranceSec * 1000, ignoreDstShift: ctx.config.copy.ignoreDstShift };
  const missingFromPack: string[] = [];

  const classify = async (src: { size: number; mtimeMs: number }, dst: Entry, readSrc: () => Promise<NodeJS.ReadableStream>, rel: string, srcId: string): Promise<PlanCategory> => {
    const v = compareMeta(src, dst, opt.compare, time);
    if (v === 'equal') return 'same';
    if (v === 'needsContent') {
      // hashes remembered from an earlier comparison or copy spare the read over the network
      const cache = ctx.hashCache;
      const remote = (cache?.get(tgt.root, rel, dst.size, dst.mtimeMs) ? null : await (await hasher)?.hash(rel, dst.size, dst.mtimeMs)) ?? null;
      if (remote) {
        cache?.set(tgt.root, rel, dst.size, dst.mtimeMs, remote);
        const known = cache?.get('src', srcId, src.size, src.mtimeMs);
        const h = known ?? (await hashStream((await readSrc()) as any));
        if (!known) {
          st.read = (st.read ?? 0) + src.size;
          cache?.set('src', srcId, src.size, src.mtimeMs, h);
        }
        return h === remote ? 'same' : 'changed';
      }
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
    await Promise.all([freeSpace, heartbeat, lock, hasher]);
    await tgt.close();
    st.phase = 'failed';
    if (cancel.cancelled) throw e;
    return { ...base, reachable: false, failed: true, error: errMessage(e), counts: b.counts, ops: b.ops };
  }

  async function fileUnit(u: Extract<Unit, { kind: 'file' | 'git' | 'packfile' }>): Promise<void> {
    const dst = await tgt.stat(u.rel);
    const src = u.kind === 'file' ? ({ kind: 'fs', abs: u.abs } as const) : u.kind === 'git' ? ({ kind: 'git', repo: u.repo, rev: u.rev, path: u.path, blob: u.blob } as const) : packRef(u.file, u.member);
    // a file with machine variables goes filled in for this machine
    const tpl = u.kind === 'packfile' && u.member.ref ? null : await varsFor(vars, u.rel, src, u.size, u.mtimeMs, node);
    const size = tpl ? tpl.buf.length : u.size;
    const common = { kind: 'copy' as const, rel: u.rel, isDir: false, src: tpl ? tpl.src : (src as SrcRef), size, srcMtime: u.mtimeMs, sourceIndex: u.sourceIndex };
    if (!dst) return push(b, { ...common, category: 'new', selected: true });
    if (dst.isDir) return push(b, { ...common, category: 'changed', selected: true, dstMtime: dst.mtimeMs, replaceType: true, note: t('Hedefte aynı adda klasör var; klasör kaldırılıp dosya yazılacak.') });
    let cat: PlanCategory;
    if (tpl) cat = await classify({ size, mtimeMs: u.mtimeMs }, dst, async () => Readable.from([tpl.buf]), u.rel, `vars:${node.id}:${u.rel}`);
    else if (u.kind === 'git' || (u.kind === 'file' && u.blob)) {
      // Commit content: the blob id tells equality exactly, time stamps mean nothing here.
      if (dst.size !== u.size) cat = 'changed';
      else {
        cat = (await gitBlobId(await tgt.readStream(u.rel), dst.size)) === u.blob ? 'same' : 'changed';
        st.read = (st.read ?? 0) + dst.size;
      }
    } else if (u.kind === 'packfile' && u.member.ref) {
      // an incremental pack: the file is expected on the target as it was; anything else needs a full pack
      if (dst.size === u.size && sameTime(u.mtimeMs, dst.mtimeMs, time)) return push(b, { ...common, category: 'same', selected: false });
      missingFromPack.push(u.rel);
      return;
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
    // what another source of this send takes over is neither compared, written nor deleted from here
    if (u.skip?.length) for (const [k, e] of dstEntries) if (u.skip.some((s) => relIsWithin(e.rel, s, true))) dstEntries.delete(k);
    scans?.set(u.rel, dstEntries);
    // a folder on disk is read from there; a folder in a pack straight out of the pack
    const local = u.kind === 'dir' ? new FsTransport(u.abs) : null;
    // a file merged in from another folder for the same place is read from where it is
    const srcOf = (e: PackedEntry) => (local ? ({ kind: 'fs', abs: e.abs ?? local.localPath(e.rel) } as const) : packRef((u as { file: string }).file, e.member!));
    const readSrc = (e: PackedEntry) => (local ? (e.abs ? Promise.resolve(fs.createReadStream(e.abs)) : local.readStream(e.rel)) : Promise.resolve(openPackEntry((u as { file: string }).file, e.member!)));
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
    // one question to SamSync on the target for all the files of this folder whose contents must be compared
    const remote = await hasher;
    if (remote) {
      const ask: { rel: string; size: number; mtimeMs: number }[] = [];
      for (const [key, e] of files) {
        const d = dstEntries.get(key);
        if (!e.ref && d && !d.isDir && compareMeta(e, d, opt.compare, time) === 'needsContent') {
          const rel = relJoin(u.rel, e.rel);
          if (!ctx.hashCache?.get(tgt.root, rel, d.size, d.mtimeMs)) ask.push({ rel, size: d.size, mtimeMs: d.mtimeMs });
        }
      }
      remote.prefetch(ask);
    }
    await mapLimit(files, 8, async ([key, e]) => {
      cancel.throwIfCancelled();
      const rel = relJoin(u.rel, e.rel);
      const d = dstEntries.get(key);
      if (e.ref) {
        // an incremental pack: the target should hold this file as it was; otherwise a full pack is needed
        if (d && !d.isDir && d.size === e.size && sameTime(e.mtimeMs, d.mtimeMs, time)) b.counts.same++;
        else missingFromPack.push(rel);
        st.done++;
        return;
      }
      // a file with machine variables goes filled in for this machine
      const tpl = await varsFor(vars, rel, srcOf(e), e.size, e.mtimeMs, node);
      const common = { kind: 'copy' as const, rel, isDir: false, src: tpl ? tpl.src : (srcOf(e) as SrcRef), size: tpl ? tpl.buf.length : e.size, srcMtime: e.mtimeMs, sourceIndex: u.sourceIndex, ...(e.overlay ? { note: t('Bu makineye özel ({name})', { name: e.overlay }) } : {}) };
      try {
        if (!d) return push(b, { ...common, category: 'new', selected: true });
        if (d.isDir) return push(b, { ...common, category: 'changed', selected: true, dstMtime: d.mtimeMs, replaceType: true, note: t('Hedefte aynı adda klasör var.') });
        const cat = tpl
          ? await classify({ size: tpl.buf.length, mtimeMs: e.mtimeMs }, d, async () => Readable.from([tpl.buf]), rel, `vars:${node.id}:${rel}`)
          : await classify(e, d, () => readSrc(e), rel, local ? e.abs ?? local.localPath(e.rel) : `${(u as { file: string }).file}#${e.member!.offset}`);
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
  if (missingFromPack.length) {
    missingFromPack.sort((x, y) => x.localeCompare(y));
    warn(t('{name}: artımlı paket {n} dosyayı hedefte bekliyordu ama orada yok ya da farklı ({files}); bunlar için tam paket gerekir.', { name: node.name, n: missingFromPack.length, files: missingFromPack.slice(0, 4).join(', ') + (missingFromPack.length > 4 ? '…' : '') }));
  }
  b.ops.sort((x, y) => x.rel.localeCompare(y.rel));
  b.ops.forEach((op, i) => (op.id = String(i)));
  // files a program on the target holds open: the review says so before anything is tried (the biggest ones are checked)
  let inUse: string[] | undefined;
  const held = tgt.checkReplaceable
    ? b.ops
        .filter((o) => o.kind === 'copy' && o.selected && !o.isDir && o.dstMtime != null)
        .sort((x, y) => y.size - x.size)
        .slice(0, 150)
    : [];
  if (held.length) {
    const found: string[] = [];
    await mapLimit(held, 8, async (o) => {
      try {
        await tgt.checkReplaceable!(o.rel);
      } catch (e) {
        if (e instanceof InUseError) found.push(o.rel);
      }
    });
    if (found.length) {
      inUse = found.sort((x, y) => x.localeCompare(y));
      const set = new Set(inUse);
      for (const o of b.ops) if (set.has(o.rel)) o.note = t('Hedefte kullanımda: bir program açık tutuyor.');
      warn(t('{name}: {n} dosya hedefte kullanımda ({files}); program kapatılmazsa yazılamaz, içerik aynıysa yalnızca tarihi eşitlenir.', { name: node.name, n: inUse.length, files: inUse.slice(0, 4).join(', ') + (inUse.length > 4 ? '…' : '') }));
    }
  }
  const bytes = b.ops.filter((o) => o.selected && o.kind === 'copy').reduce((s, o) => s + o.size, 0);
  const freeBytes = await freeSpace;
  const alive = await heartbeat;
  // programs keeping the target folder busy there: said in the review; the machine may ask to be left alone meanwhile
  const hb = askBeat ? await beat : null;
  const busyBy = hb && heartbeatFresh(hb) && hb.busyBy?.length ? [...new Set(hb.busyBy.map((p) => p.name))] : undefined;
  const holdForBusy = !!busyBy && !!hb?.holdWhileBusy && b.ops.some((o) => o.selected);
  if (busyBy) warn(holdForBusy ? t('{name}: {programs} hedef klasörü kullanıyor; bu makineye program kapanınca gönderilecek', { name: node.name, programs: busyBy.join(', ') }) : t('{name}: {programs} hedef klasörü kullanıyor; değiştirilecek dosyalar kullanımda olabilir', { name: node.name, programs: busyBy.join(', ') }));
  const agentHashed = (await hasher)?.answered || undefined;
  const other = await lock;
  await tgt.close();
  if (other) warn(t('{name}: {user} ({host}) {ago} önce yazmaya başladı ({label}); aynı anda gönderirseniz dosyalar karışabilir.', { name: node.name, user: other.user, host: other.host, ago: agoMinutes(other.startedAt), label: other.label }));
  return {
    ...base,
    ops: b.ops,
    counts: b.counts,
    bytes,
    freeBytes,
    relayDown: node.relay && !alive ? true : undefined,
    agent: askBeat && alive ? true : undefined,
    agentHashed,
    busyBy,
    held: holdForBusy || undefined,
    lock: other ? { host: other.host, user: other.user, label: other.label, startedAt: other.startedAt } : undefined,
    fromManifest,
    inUse,
    missingFromPack: missingFromPack.length ? missingFromPack : undefined,
  };
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
    /** On a relay: what the sender left in the stash for this job (machine folder, raw files with variables). */
    stash?: StashIn;
  } = {},
): Promise<SendPlan> {
  const started = Date.now();
  const cancel = opts.cancel ?? new CancelToken();
  const progress = opts.onProgress ?? (() => undefined);
  const filter = sendFilter(ctx, req, await sendIgnorePatterns(req));
  const { units, warnings, sources } = await expandUnits(ctx, req, filter, cancel, progress, true, opts.stash);
  const patterns = ctx.config.copy.templateFiles ?? [];
  const stashRaw = opts.stash ? new Map(opts.stash.raw.map((r) => [relKey(r, true), path.join(opts.stash!.dir, 'raw', ...r.split('/'))])) : null;
  const vars: VarsCtx | undefined = patterns.length ? { match: pathMatcher(patterns, true), texts: new Map(), used: new Map(), raw: stashRaw ? (rel) => stashRaw.get(relKey(rel, true)) : undefined } : undefined;

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
    // nothing compared yet (the targets' folders are still being listed): the bar runs without a number
    const started = filesDone > 0 || done > 0;
    progress({
      message: t('{done} / {total} makine incelendi', { done, total: nodes.length }),
      done: started ? (filesTotal ? filesDone : done) : undefined,
      total: started ? filesTotal || nodes.length : undefined,
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
      const tp = await planTarget(ctx, req, n, units, filter, cancel, (m) => warnings.push(m), scansFor(n.id), states[i], vars);
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
  /** relay id -> its "goes directly" warning, replaced when a stand-in takes over */
  const downWarning = new Map<string, number>();
  for (const tp of planned) {
    if (!tp.relayDown || !routing.via.has(tp.targetId)) continue;
    const behind = routing.via.get(tp.targetId) ?? [];
    behindDown.set(tp.targetId, behind);
    routing.via.delete(tp.targetId);
    downWarning.set(tp.targetId, warnings.length);
    warnings.push(t('{name} röle olarak işaretli ama orada SamSync çalışmıyor; {names} doğrudan gönderilecek.', { name: tp.targetName, names: behind.map((n) => n.name).join(', ') }));
  }
  // when asked to, another machine of such a group that runs SamSync stands in for the relay in this send
  if (ctx.config.copy.relayTakeover) {
    for (const [relayId, behind] of behindDown) {
      const standIn = await standInRelay(ctx, behind, cancel);
      if (!standIn) continue;
      behindDown.set(relayId, [standIn]);
      routing.via.set(standIn.id, behind.filter((n) => n.id !== standIn.id));
      // the warning above said they go directly: they go through the stand-in instead
      const msg = t('{name} röle olarak işaretli ama orada SamSync çalışmıyor; bu gönderimde {standIn} röle oluyor.', { name: planned.find((p) => p.targetId === relayId)?.targetName ?? relayId, standIn: standIn.name });
      const at = downWarning.get(relayId);
      if (at != null) warnings[at] = msg;
      else warnings.push(msg);
    }
  }
  const directPlanned = new Map<string, TargetPlan>();
  await mapLimit([...behindDown.values()].flat(), 6, async (n) => {
    directPlanned.set(n.id, await planTarget(ctx, req, n, units, filter, cancel, (m) => warnings.push(m), scansFor(n.id), undefined, vars));
  });
  // the relayed machines follow their relay in the list, reachable as far as the relay is
  const targets: TargetPlan[] = [];
  const pushVia = (tp: TargetPlan) => {
    for (const n of routing.via.get(tp.targetId) ?? []) {
      const opt = targetOptions(req.options, n.id);
      const base = { targetId: n.id, targetName: n.name, root: nodeRootLabel(ctx.config, n), mode: opt.mode, backup: opt.backup, ops: [], counts: emptyCounts(), bytes: 0, via: tp.targetId };
      targets.push(tp.reachable ? { ...base, reachable: true } : { ...base, reachable: false, error: t('Röle {name} erişilemedi', { name: tp.targetName }) });
    }
  };
  for (const tp of planned) {
    targets.push(tp);
    for (const n of behindDown.get(tp.targetId) ?? []) {
      const d = directPlanned.get(n.id);
      if (!d) continue;
      targets.push(d);
      pushVia(d);
    }
    pushVia(tp);
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
  // the relays that send on: what they need for each machine's own files
  const stash = relayStashes(ctx, units, vars, [...routing.via.keys()].filter((id) => routing.via.get(id)!.length));
  return { id: newId('plan-'), createdAt: Date.now(), request: req, targets, sources, warnings, durationMs: Date.now() - started, stash };
}

/**
 * The first machine of a group (behind a relay that does not run SamSync) whose own SamSync answers: its heartbeat on
 * its share is fresh. It takes the others of the group in this send, as the relay would have.
 */
async function standInRelay(ctx: CoreContext, behind: NodeConfig[], cancel: CancelToken): Promise<NodeConfig | null> {
  for (const n of behind) {
    cancel.throwIfCancelled();
    if (n.transport === 'sftp' || n.id === ctx.localNodeId) continue;
    const p = await probeNode(ctx.config, n, 1500, false).catch(() => null);
    if (!p?.ok) continue;
    let tgt: Transport | null = null;
    try {
      tgt = await transportForNode(ctx, n);
      if (heartbeatFresh(await readHeartbeat(tgt))) return n;
    } catch {
      /* not this one */
    } finally {
      await tgt?.close().catch(() => undefined);
    }
  }
  return null;
}

/**
 * Writes the sources of a send to a pack file instead of to machines: everything the plan would have compared,
 * with the send's exclusions and ignore files applied. The pack is a source like a folder afterwards.
 */
/**
 * What a target is believed to hold already, for an incremental pack: from an earlier pack's index (every file it
 * carried or itself referred to) or from the manifest SamSync left on the machine (it has to be reachable for that).
 */
async function knownOnTarget(ctx: CoreContext, since: { pack?: string; targetId?: string }, subtrees: string[]): Promise<{ map: Map<string, { size: number; mtimeMs: number }>; label: string }> {
  const map = new Map<string, { size: number; mtimeMs: number }>();
  if (since.pack) {
    const idx = await readPackIndex(since.pack);
    for (const e of idx.entries) if (!e.isDir) map.set(relKey(e.rel, true), { size: e.size, mtimeMs: e.mtimeMs });
    return { map, label: t('{file} paketine göre', { file: path.basename(since.pack) }) };
  }
  if (since.targetId) {
    const node = ctx.config.nodes.find((n) => n.id === since.targetId);
    if (!node) throw new Error(t('Hedef bulunamadı: {ids}', { ids: since.targetId }));
    const probe = await probeNode(ctx.config, node, 3000, false);
    if (!probe.ok) throw new Error(t('{name} makinesine erişilemiyor; artımlı paket için önceki paketi seçin.', { name: node.name }));
    const tgt = await transportForNode(ctx, node);
    try {
      let any = false;
      for (const sub of subtrees) {
        const m = await manifestEntries(tgt, sub, Date.now(), Number.POSITIVE_INFINITY).catch(() => null);
        if (!m) continue;
        any = true;
        for (const e of m.entries.values()) if (!e.isDir) map.set(relKey(relJoin(sub, e.rel), true), { size: e.size, mtimeMs: e.mtimeMs });
      }
      if (!any) throw new Error(t('{name} makinesinde bu klasörler için manifest yok; artımlı paket için önceki paketi seçin.', { name: node.name }));
    } finally {
      await tgt.close();
    }
    return { map, label: t('{name} makinesindeki sürüme göre', { name: node.name }) };
  }
  throw new Error(t('Artımlı paket için önceki paket ya da makine seçin.'));
}

export async function writeSendPack(ctx: CoreContext, req: SendRequest, file: string, opts: { cancel?: CancelToken; onProgress?: (p: PlanProgress) => void; password?: string; since?: { pack?: string; targetId?: string } } = {}): Promise<PackWriteResult> {
  const cancel = opts.cancel ?? new CancelToken();
  const progress = opts.onProgress ?? (() => undefined);
  const filter = sendFilter(ctx, req, await sendIgnorePatterns(req));
  const { units, warnings } = await expandUnits(ctx, req, filter, cancel, progress, false);
  const files: PackSource[] = [];
  const dirs: string[] = [];
  const subtrees: PackSubtree[] = [];
  // an incremental pack leaves out what the target holds as it is, and records those files as expected there
  const known = opts.since ? await knownOnTarget(ctx, opts.since, units.filter((u) => u.kind !== 'delete').map((u) => u.rel)) : null;
  const time = { toleranceMs: ctx.config.copy.timeToleranceSec * 1000, ignoreDstShift: ctx.config.copy.ignoreDstShift };
  const refs: { rel: string; size: number; mtimeMs: number }[] = [];
  const skipIfKnown = (rel: string, size: number, mtimeMs: number): boolean => {
    const k = known?.map.get(relKey(rel, true));
    if (!k || k.size !== size || !sameTime(k.mtimeMs, mtimeMs, time)) return false;
    refs.push({ rel, size, mtimeMs });
    return true;
  };
  for (const u of units) {
    if (u.kind === 'delete') {
      warnings.push(t('{path} silme olarak işaretli; paket silme taşımaz, atlandı.', { path: u.abs }));
      continue;
    }
    subtrees.push({ rel: u.rel, isDir: u.kind === 'dir' || u.kind === 'packdir' });
    if (u.kind === 'file') {
      if (!skipIfKnown(u.rel, u.size, u.mtimeMs)) files.push({ rel: u.rel, size: u.size, mtimeMs: u.mtimeMs, open: () => fs.createReadStream(u.abs, { highWaterMark: 1024 * 1024 }) });
    } else if (u.kind === 'git') {
      if (!skipIfKnown(u.rel, u.size, u.mtimeMs)) files.push({ rel: u.rel, size: u.size, mtimeMs: u.mtimeMs, open: () => blobStream(u.repo, u.rev, u.path) });
    } else if (u.kind === 'packfile') {
      if (u.member.ref) refs.push({ rel: u.rel, size: u.size, mtimeMs: u.mtimeMs });
      else if (!skipIfKnown(u.rel, u.size, u.mtimeMs)) files.push({ rel: u.rel, size: u.size, mtimeMs: u.mtimeMs, open: () => openPackEntry(u.file, u.member) });
    } else {
      const local = u.kind === 'dir' ? new FsTransport(u.abs) : null;
      for (const e of u.entries.values() as Iterable<PackedEntry>) {
        const rel = relJoin(u.rel, e.rel);
        if (e.isDir) dirs.push(rel);
        else if (e.ref) refs.push({ rel, size: e.size, mtimeMs: e.mtimeMs });
        else if (skipIfKnown(rel, e.size, e.mtimeMs)) continue;
        else if (local) files.push({ rel, size: e.size, mtimeMs: e.mtimeMs, open: () => fs.createReadStream(e.abs ?? local.localPath(e.rel), { highWaterMark: 1024 * 1024 }) });
        else files.push({ rel, size: e.size, mtimeMs: e.mtimeMs, open: () => openPackEntry((u as { file: string }).file, e.member!) });
      }
    }
  }
  if (!files.length && !dirs.length && !refs.length) throw new Error(t('Pakete yazılacak bir şey yok.'));
  if (known && !files.length) warnings.push(t('Hedefte olmayan ya da değişen dosya yok: paket yalnızca listeyi taşıyor.'));
  const total = files.length;
  const label = req.label || t('Gönderim');
  progress({ message: t('Paket yazılıyor'), done: 0, total });
  const idx = await writePackFile(file, { label, subtrees, files, dirs, refs, since: known?.label, node: ctx.localNodeId, version: ctx.appVersion, signal: cancel.signal, password: opts.password }, (done, bytes) =>
    progress({ message: t('Paket yazılıyor: {done}/{total} dosya, {size}', { done, total, size: formatBytes(bytes) }), done, total }),
  );
  const packed = (await fsp.stat(file)).size;
  return { file, files: idx.files, size: idx.size, packed, warnings, skipped: idx.refs || undefined };
}
