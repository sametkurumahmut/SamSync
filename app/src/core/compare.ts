import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { CompareMethod } from '../shared/types';

export type MetaVerdict = 'equal' | 'srcNewer' | 'dstNewer' | 'different';

export interface TimeOptions {
  toleranceMs: number;
  ignoreDstShift: boolean;
}

export function sameTime(a: number, b: number, t: TimeOptions): boolean {
  const d = Math.abs(a - b);
  if (d <= t.toleranceMs) return true;
  if (t.ignoreDstShift && Math.abs(d - 3600_000) <= t.toleranceMs) return true;
  return false;
}

/** Metadata verdict for two files. 'content' needs a byte comparison when sizes match (see contentEqual). */
export function compareMeta(
  src: { size: number; mtimeMs: number },
  dst: { size: number; mtimeMs: number },
  method: CompareMethod,
  t: TimeOptions,
): MetaVerdict | 'needsContent' {
  if (method === 'size') return src.size === dst.size ? 'equal' : 'different';
  if (method === 'content') return src.size !== dst.size ? 'different' : 'needsContent';
  if (src.size === dst.size && sameTime(src.mtimeMs, dst.mtimeMs, t)) return 'equal';
  if (sameTime(src.mtimeMs, dst.mtimeMs, t)) return 'different';
  return src.mtimeMs > dst.mtimeMs ? 'srcNewer' : 'dstNewer';
}

async function* chunks(stream: Readable): AsyncGenerator<Buffer> {
  for await (const c of stream) yield c as Buffer;
}

/** Byte by byte comparison of two streams. Both streams are fully consumed or destroyed. */
export async function streamsEqual(a: Readable, b: Readable): Promise<boolean> {
  const ia = chunks(a);
  const ib = chunks(b);
  let bufA: Buffer = Buffer.alloc(0);
  let bufB: Buffer = Buffer.alloc(0);
  let doneA = false;
  let doneB = false;
  try {
    while (true) {
      if (!bufA.length && !doneA) {
        const r = await ia.next();
        if (r.done) doneA = true;
        else bufA = r.value;
      }
      if (!bufB.length && !doneB) {
        const r = await ib.next();
        if (r.done) doneB = true;
        else bufB = r.value;
      }
      if (!bufA.length && !bufB.length) {
        if (doneA && doneB) return true;
        continue;
      }
      if ((!bufA.length && doneA) || (!bufB.length && doneB)) return false;
      if (!bufA.length || !bufB.length) continue;
      const n = Math.min(bufA.length, bufB.length);
      if (!bufA.subarray(0, n).equals(bufB.subarray(0, n))) return false;
      bufA = bufA.subarray(n);
      bufB = bufB.subarray(n);
    }
  } finally {
    a.destroy();
    b.destroy();
  }
}

/** Git blob id of a stream ("blob <size>\0" + content, SHA-1) so working files can be matched against commits. */
export async function gitBlobId(stream: Readable, size: number): Promise<string> {
  const h = createHash('sha1');
  h.update(`blob ${size}\0`);
  for await (const c of stream) h.update(c as Buffer);
  return h.digest('hex');
}

export async function hashStream(stream: Readable, algo = 'sha256'): Promise<string> {
  const h = createHash(algo);
  for await (const c of stream) h.update(c as Buffer);
  return h.digest('hex');
}
