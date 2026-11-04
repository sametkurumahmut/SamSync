// A pack: the files of a send, compressed, in one stream. Written to a relay's share as one file instead of
// one network copy per file, and opened again by SamSync on the relay. Each file is a gzip or zstd member (or the
// bytes as they are, for formats that are compressed already); an index says where each one lies.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import type { Readable as ReadableType } from 'node:stream';
import { ENC_HEADER, ctrTransform, packKeyFor } from './packcrypt';

export type PackMethod = 'gzip' | 'zstd' | 'store';

/** This Node makes and opens zstd members (22.15 and later): a SamSync that can says so in its heartbeat. */
export const ZSTD = typeof zlib.createZstdCompress === 'function';

/**
 * How a pack's members are compressed. gzip opens on every SamSync (and is what pack files on a disk use); zstd,
 * for a machine that says it opens it, is smaller and faster: on program files about 14% fewer bytes than gzip at
 * level 3 with less work, and 20% fewer at level 6 with the same work.
 */
export interface PackCompression {
  method: 'gzip' | 'zstd';
  level?: number;
}

export interface PackEntry {
  rel: string;
  /** Original size and modification time. */
  size: number;
  mtimeMs: number;
  /** Where the member lies in the pack and how long it is there. */
  offset: number;
  length: number;
  method: PackMethod;
}

/** Formats that gain nothing from gzip: their bytes go in as they are. */
const STORED = /\.(zip|7z|rar|gz|tgz|bz2|xz|zst|png|jpe?g|gif|webp|mp4|mkv|webm|mov|mp3|ogg|aac|flac|wmv|avi|pak|apk|docx|xlsx|pptx|jar)$/i;

export function packMethodFor(rel: string, kind: PackCompression['method'] = 'gzip'): PackMethod {
  return STORED.test(rel) ? 'store' : kind;
}

function compressor(method: PackMethod, level?: number) {
  if (method === 'zstd') return zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: level ?? 3 } });
  return zlib.createGzip({ level: 1 });
}

export interface PackSource {
  rel: string;
  size: number;
  mtimeMs: number;
  open: () => ReadableType;
}

/**
 * Yields the pack's bytes for the given sources, in order, and fills `entries` as it goes (an entry is
 * complete once its member has been yielded). `onFile` reports each finished source's original size.
 */
export function packStream(sources: PackSource[], entries: PackEntry[], onFile?: (s: PackSource) => void, compression?: PackCompression): ReadableType {
  async function* gen() {
    let offset = 0;
    for (const s of sources) {
      const method = packMethodFor(s.rel, compression?.method);
      const input = s.open();
      const stream = method === 'store' ? input : input.pipe(compressor(method, compression?.level));
      input.on('error', (e) => stream.destroy(e));
      let length = 0;
      for await (const chunk of stream) {
        length += (chunk as Buffer).length;
        yield chunk as Buffer;
      }
      entries.push({ rel: s.rel, size: s.size, mtimeMs: s.mtimeMs, offset, length, method });
      offset += length;
      onFile?.(s);
    }
  }
  return Readable.from(gen());
}

/** Opens one member of a pack file as the original bytes (a password-protected pack must have been opened once). */
export function openPackEntry(file: string, e: { offset: number; length: number; method: PackMethod }): ReadableType {
  if (e.length === 0) return Readable.from([]);
  const k = packKeyFor(file);
  const base = k ? ENC_HEADER : 0;
  const raw = fs.createReadStream(file, { start: base + e.offset, end: base + e.offset + e.length - 1, highWaterMark: 1024 * 1024 });
  let src: ReadableType = raw;
  if (k) {
    const d = ctrTransform(k, e.offset);
    raw.on('error', (err) => d.destroy(err));
    src = raw.pipe(d);
  }
  if (e.method === 'store') return src;
  const out = src.pipe(e.method === 'zstd' ? zlib.createZstdDecompress() : zlib.createGunzip());
  src.on('error', (err) => out.destroy(err));
  return out;
}

export function packSummary(entries: PackEntry[]): { size: number; packed: number } {
  let size = 0;
  let packed = 0;
  for (const e of entries) {
    size += e.size;
    packed += e.length;
  }
  return { size, packed };
}
