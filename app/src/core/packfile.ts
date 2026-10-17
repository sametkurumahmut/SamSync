// A pack file (.samsync-pack): a send written to disk instead of to machines, for releases that travel on a
// USB stick. It holds the files compressed (the same member format the relays receive, see pack.ts) and, at
// the end, an index: which target-relative paths they are, their sizes and times, and the sent folders.
// Any machine running SamSync takes it as a source: the plan compares its entries with the target like a
// folder, so only what differs is written, the manifest is left behind as usual, and the next network send
// is fast again.
//
//   [member bytes …][index JSON, UTF-8][index length, 8 bytes LE][magic, 8 bytes]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { packStream, type PackEntry, type PackSource } from './pack';
import { relJoin } from './paths';
import type { Entry } from './transport';

export const PACK_EXT = '.samsync-pack';
const MAGIC = Buffer.from('SSPACK01', 'latin1');
const TRAILER = 16;
/** Larger than any sensible index; a bigger one is refused rather than read into memory. */
const MAX_INDEX = 512 * 1024 * 1024;

export const isPackFile = (p: string) => p.toLowerCase().endsWith(PACK_EXT);

/** A sent folder or file, by its path relative to the target root ('' is the root itself). */
export interface PackSubtree {
  rel: string;
  isDir: boolean;
}

/** A file or folder in the pack; `rel` is relative to the target root. Folders have no member. */
export interface PackIndexEntry extends PackEntry {
  isDir?: boolean;
}

export interface PackIndex {
  version: 1;
  label: string;
  createdAt: number;
  from: { host: string; user?: string; version?: string; node?: string };
  subtrees: PackSubtree[];
  entries: PackIndexEntry[];
  /** Original bytes of all files, and how many files there are (folders not counted). */
  size: number;
  files: number;
}

export interface PackWriteSource extends PackSource {
  /** rel of the subtree this file belongs to */
  subtree: string;
}

/**
 * Writes the pack. `files` are the files to include (their `rel` relative to the target root); `dirs` are the
 * folders to record (empty ones included, so they are created on the target). The index entries are returned.
 */
export async function writePackFile(
  file: string,
  args: { label: string; subtrees: PackSubtree[]; files: PackSource[]; dirs: string[]; node?: string; version?: string; signal?: AbortSignal },
  onFile?: (done: number, bytes: number) => void,
): Promise<PackIndex> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const members: PackEntry[] = [];
  let done = 0;
  let bytes = 0;
  const out = fs.createWriteStream(file, { highWaterMark: 1024 * 1024 });
  const stream = packStream(args.files, members, (s) => {
    done++;
    bytes += s.size;
    onFile?.(done, bytes);
  });
  try {
    await pipeline(stream, out, { signal: args.signal });
    const entries: PackIndexEntry[] = [...args.dirs.map((rel) => ({ rel, isDir: true, size: 0, mtimeMs: 0, offset: 0, length: 0, method: 'store' as const })), ...members];
    const index: PackIndex = {
      version: 1,
      label: args.label,
      createdAt: Date.now(),
      from: { host: os.hostname(), user: process.env.USERNAME || process.env.USER || undefined, version: args.version, node: args.node },
      subtrees: args.subtrees,
      entries,
      size: members.reduce((a, e) => a + e.size, 0),
      files: members.length,
    };
    const json = Buffer.from(JSON.stringify(index), 'utf8');
    const len = Buffer.alloc(8);
    len.writeBigUInt64LE(BigInt(json.length));
    await fsp.appendFile(file, Buffer.concat([json, len, MAGIC]));
    return index;
  } catch (e) {
    await fsp.rm(file, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** Reads the index at the end of a pack file; throws when the file is not a pack. */
export async function readPackIndex(file: string): Promise<PackIndex> {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    if (size < TRAILER) throw new Error('not a pack');
    const trailer = Buffer.alloc(TRAILER);
    await fh.read(trailer, 0, TRAILER, size - TRAILER);
    if (!trailer.subarray(8).equals(MAGIC)) throw new Error('not a pack');
    const len = Number(trailer.readBigUInt64LE(0));
    if (!Number.isFinite(len) || len <= 0 || len > MAX_INDEX || len + TRAILER > size) throw new Error('bad pack index');
    const json = Buffer.alloc(len);
    await fh.read(json, 0, len, size - TRAILER - len);
    const idx = JSON.parse(json.toString('utf8')) as PackIndex;
    if (idx.version !== 1 || !Array.isArray(idx.entries) || !Array.isArray(idx.subtrees)) throw new Error('bad pack index');
    return idx;
  } finally {
    await fh.close();
  }
}

/** The pack's entries below one subtree, keyed like a scan (lower case, rel relative to the subtree). */
export function packSubtreeEntries(idx: PackIndex, subtree: string): Map<string, Entry & { member?: PackEntry }> {
  const out = new Map<string, Entry & { member?: PackEntry }>();
  const prefix = subtree ? subtree.toLowerCase() + '/' : '';
  for (const e of idx.entries) {
    const low = e.rel.toLowerCase();
    if (subtree && !low.startsWith(prefix)) continue;
    const rel = subtree ? e.rel.slice(subtree.length + 1) : e.rel;
    if (!rel) continue;
    out.set(rel.toLowerCase(), { rel, isDir: !!e.isDir, size: e.size, mtimeMs: e.mtimeMs, member: e.isDir ? undefined : e });
  }
  return out;
}

/** The pack entry that is the subtree itself, when the subtree is a single file. */
export function packFileEntry(idx: PackIndex, rel: string): PackIndexEntry | undefined {
  const low = rel.toLowerCase();
  return idx.entries.find((e) => !e.isDir && e.rel.toLowerCase() === low);
}

/** A name for a new pack next to the sources: <label>-<yyyyMMdd-HHmm>.samsync-pack */
export function packFileName(label: string, when = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}`;
  const safe = label.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'SamSync';
  return `${safe}-${stamp}${PACK_EXT}`;
}

export { relJoin as packRelJoin };
