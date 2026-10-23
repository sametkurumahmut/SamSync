// The manifest at a target's root: what SamSync last saw and wrote under each sent folder. A later plan
// starts from it instead of walking the folder over the network (minutes on a slow link for tens of
// thousands of files), after a quick check that the folder still matches it: the root listing and a
// sample of the files. Anything copied onto the machine by hand (a release from a disk) changes sizes
// and times, which the check catches; the Compare page always looks for itself.
import { Readable } from 'node:stream';
import type { Transport, Entry } from './transport';
import { MANIFEST_FILE } from '../shared/files';
import { relJoin, relKey } from './paths';
import { mapLimit } from './util';

export interface ManifestSubtree {
  writtenAt: number;
  by?: { host?: string; user?: string; version?: string };
  label?: string;
  /**
   * The exclusions the entries were taken with ("f:*.pdb", "d:Logs", "i:<ignore file pattern>"): a later send that
   * leaves out less cannot trust them, as what this one left out is not in them.
   */
  excluded?: string[];
  /** [rel, isDir, size, mtimeMs], rel relative to the subtree. */
  entries: [string, 0 | 1, number, number][];
}

export interface Manifest {
  version: 1;
  subtrees: Record<string, ManifestSubtree>;
}

/** A manifest older than this is not trusted even when the check passes. */
export const MANIFEST_MAX_AGE_MS = 7 * 86400_000;
/** How many files the check looks at. */
const SAMPLE = 24;

export async function readManifest(tgt: Transport): Promise<Manifest | null> {
  try {
    if (!(await tgt.stat(MANIFEST_FILE))) return null;
    const chunks: Buffer[] = [];
    for await (const c of await tgt.readStream(MANIFEST_FILE)) chunks.push(c as Buffer);
    const m = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Manifest;
    return m && m.version === 1 && m.subtrees && typeof m.subtrees === 'object' ? m : null;
  } catch {
    return null;
  }
}

async function writeManifest(tgt: Transport, m: Manifest): Promise<void> {
  const tmp = `${MANIFEST_FILE}.${Date.now().toString(36)}.samsync-tmp`;
  await tgt.writeStream(tmp, Readable.from([Buffer.from(JSON.stringify(m), 'utf8')]));
  await tgt.rename(tmp, MANIFEST_FILE);
}

export function entriesToMap(sub: ManifestSubtree, caseInsensitive = true): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const [rel, isDir, size, mtimeMs] of sub.entries) out.set(relKey(rel, caseInsensitive), { rel, isDir: isDir === 1, size, mtimeMs });
  return out;
}

export function mapToEntries(entries: Map<string, Entry>): ManifestSubtree['entries'] {
  return [...entries.values()].map((e) => [e.rel, e.isDir ? 1 : 0, e.size, e.mtimeMs]);
}

const sameEntry = (a: Entry, b: Entry) => a.isDir === b.isDir && (a.isDir || (a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 2000));

/**
 * The entries of a sent folder from the manifest, when it is there, young enough and still matches the
 * folder: the folder's direct children as listed now, and a sample of files spread over the whole set.
 * Null means: walk the folder.
 */
export async function manifestEntries(tgt: Transport, subtreeRel: string, now = Date.now(), maxAgeMs = MANIFEST_MAX_AGE_MS, excluded?: readonly string[]): Promise<{ entries: Map<string, Entry>; writtenAt: number; checked: number } | null> {
  const m = await readManifest(tgt);
  const sub = m?.subtrees[subtreeRel];
  if (!sub || !Array.isArray(sub.entries) || now - sub.writtenAt > maxAgeMs) return null;
  // taken with an exclusion this send does not have (or with unknown ones): walk the folder instead
  if (excluded && (!Array.isArray(sub.excluded) || sub.excluded.some((p) => !excluded.includes(p)))) return null;
  const entries = entriesToMap(sub);
  // the direct children now, against what the manifest says about them
  const listed = await tgt.list(subtreeRel).catch(() => null);
  if (!listed) return null;
  const strip = subtreeRel ? subtreeRel.length + 1 : 0;
  const direct = new Map(listed.map((e) => [relKey(e.rel.slice(strip), true), { ...e, rel: e.rel.slice(strip) }]));
  const ownDirect = [...entries.values()].filter((e) => !e.rel.includes('/'));
  for (const e of ownDirect) {
    const d = direct.get(relKey(e.rel, true));
    if (!d || !sameEntry(e, d)) return null;
  }
  for (const [k] of direct) if (!entries.has(k) && !isOwnFile(k)) return null;
  // a sample of the files below, evenly spread
  const files = [...entries.values()].filter((e) => !e.isDir && e.rel.includes('/'));
  const step = Math.max(1, Math.floor(files.length / SAMPLE));
  const sample = files.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  const ok = await mapLimit(sample, 8, async (e) => {
    const st = await tgt.stat(relJoin(subtreeRel, e.rel)).catch(() => null);
    return !!st && sameEntry(e, st);
  });
  if (ok.some((x) => !x)) return null;
  return { entries, writtenAt: sub.writtenAt, checked: ownDirect.length + sample.length };
}

/** SamSync's own files at a root are not part of any subtree. */
function isOwnFile(key: string): boolean {
  return key.startsWith('samsync-') || key.endsWith('.samsync-tmp') || key.startsWith('.samsync-');
}

/** Replaces one subtree of the manifest (the others stay) and writes it back. */
/**
 * A run that wrote below subtrees and left no manifest of its own (an undo, a rollback, a sync, a send cut short)
 * makes them stale: they go, and the next send walks those folders. True when there was one to drop.
 */
export async function forgetManifestSubtrees(tgt: Transport, rels: string[]): Promise<boolean> {
  if (!rels.length) return false;
  const m = await readManifest(tgt);
  if (!m) return false;
  const low = rels.map((r) => r.toLowerCase());
  const keys = Object.keys(m.subtrees).filter((k) => {
    const key = k.toLowerCase();
    return low.some((r) => !key || r === key || r.startsWith(key + '/') || key.startsWith(r + '/'));
  });
  if (!keys.length) return false;
  for (const k of keys) delete m.subtrees[k];
  await writeManifest(tgt, m);
  return true;
}

/** The exclusions of a send in the form a manifest keeps them (see ManifestSubtree.excluded). */
export function exclusionsOf(excludeFiles: readonly string[], excludeDirs: readonly string[], ignored: readonly string[] = []): string[] {
  return [...new Set([...excludeFiles.map((p) => `f:${p.trim()}`), ...excludeDirs.map((p) => `d:${p.trim()}`), ...ignored.map((p) => `i:${p.trim()}`)])].sort();
}

export async function saveManifestSubtree(tgt: Transport, subtreeRel: string, entries: Map<string, Entry>, by: ManifestSubtree['by'], label?: string, excluded?: string[]): Promise<void> {
  const m = (await readManifest(tgt)) ?? { version: 1 as const, subtrees: {} };
  // a subtree inside another one that is kept would go stale: drop the parents and the children of this one
  for (const key of Object.keys(m.subtrees)) {
    if (key === subtreeRel) continue;
    if (!subtreeRel || !key || key.startsWith(subtreeRel + '/') || subtreeRel.startsWith(key + '/')) delete m.subtrees[key];
  }
  m.subtrees[subtreeRel] = { writtenAt: Date.now(), by, label, excluded, entries: mapToEntries(entries) };
  await writeManifest(tgt, m);
}

/** What a finished run leaves below a subtree: the scanned entries with the successful operations applied. */
export function applyOps(
  scanned: Map<string, Entry>,
  subtreeRel: string,
  ops: { kind: 'copy' | 'mkdir' | 'delete'; rel: string; isDir: boolean; size: number; mtimeMs?: number }[],
  now = Date.now(),
): Map<string, Entry> {
  const out = new Map(scanned);
  const prefix = subtreeRel ? subtreeRel + '/' : '';
  for (const op of ops) {
    if (!op.rel.startsWith(prefix)) continue;
    const rel = op.rel.slice(prefix.length);
    if (!rel) continue;
    const key = relKey(rel, true);
    if (op.kind === 'delete') {
      out.delete(key);
      if (op.isDir) for (const k of [...out.keys()]) if (k.startsWith(key + '/')) out.delete(k);
    } else if (op.kind === 'mkdir') out.set(key, { rel, isDir: true, size: 0, mtimeMs: now });
    else out.set(key, { rel, isDir: false, size: op.size, mtimeMs: op.mtimeMs ?? now });
  }
  return out;
}
