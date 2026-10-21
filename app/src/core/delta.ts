// Block delta through SamSync on the target: for a big file that already exists there, the target hashes its
// copy in fixed blocks, the sender puts only the blocks that differ into the pack, and the target builds the new
// file from those and the blocks it already has. The result is checked against the whole file's hash before it
// replaces anything, so a wrong guess costs a failed item, never a broken file.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { t } from '../shared/i18n';

/** Files below this go whole: the round trip for the block list costs more than it saves. */
export const DELTA_MIN = 8 * 1024 * 1024;
export const DELTA_BLOCK = 1024 * 1024;

export interface BlockList {
  size: number;
  mtimeMs: number;
  /** one hash per block, the last block may be shorter */
  hashes: string[];
}

/** What the pack holds for a file sent as blocks. */
export interface DeltaInfo {
  blockSize: number;
  /** indexes of the blocks in the pack, in order */
  blocks: number[];
  /** the file on the target the other blocks come from, as it was when its block list was made */
  baseSize: number;
  baseMtimeMs: number;
  /** sha256 of the whole new file */
  hash: string;
}

export function blockHash(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex').slice(0, 32);
}

/** Cuts a stream into blocks of exactly `size` bytes (the last one may be shorter). */
export async function* blocksOf(stream: AsyncIterable<unknown>, size: number): AsyncGenerator<Buffer> {
  let parts: Buffer[] = [];
  let have = 0;
  for await (const c of stream) {
    let chunk = c as Buffer;
    while (chunk.length) {
      const take = Math.min(size - have, chunk.length);
      parts.push(chunk.subarray(0, take));
      have += take;
      chunk = chunk.subarray(take);
      if (have === size) {
        yield parts.length === 1 ? parts[0] : Buffer.concat(parts);
        parts = [];
        have = 0;
      }
    }
  }
  if (have) yield Buffer.concat(parts);
}

/** The target's side: the block list of a file on this disk. */
export async function fileBlocks(abs: string, blockSize = DELTA_BLOCK): Promise<BlockList> {
  const st = await fsp.stat(abs);
  const hashes: string[] = [];
  for await (const b of blocksOf(fs.createReadStream(abs, { highWaterMark: blockSize }), blockSize)) hashes.push(blockHash(b));
  return { size: st.size, mtimeMs: st.mtimeMs, hashes };
}

/**
 * The sender's side: the blocks of the source that the target does not have, in order. `out` is complete once
 * the stream has ended: which blocks went in, the whole file's hash and its size.
 */
export function changedBlocks(src: Readable, target: BlockList, blockSize: number, out: { info?: DeltaInfo; size: number; sent: number }): Readable {
  async function* gen() {
    const whole = createHash('sha256');
    const blocks: number[] = [];
    let i = 0;
    for await (const b of blocksOf(src, blockSize)) {
      whole.update(b);
      out.size += b.length;
      if (target.hashes[i] !== blockHash(b)) {
        blocks.push(i);
        out.sent += b.length;
        yield b;
      }
      i++;
    }
    out.info = { blockSize, blocks, baseSize: target.size, baseMtimeMs: target.mtimeMs, hash: whole.digest('hex') };
  }
  return Readable.from(gen());
}

/** The target's side: the new file, from the blocks in the pack and the rest from the file already here. */
export function patchedStream(member: Readable, base: string, size: number, d: DeltaInfo): Readable {
  async function* gen() {
    const st = await fsp.stat(base).catch(() => null);
    if (!st || st.size !== d.baseSize || Math.abs(st.mtimeMs - d.baseMtimeMs) > 2000) throw new Error(t('Hedefteki dosya paket hazırlanırken değişti; bir daha gönderin'));
    const fh = await fsp.open(base, 'r');
    const fromPack = blocksOf(member, d.blockSize)[Symbol.asyncIterator]();
    const inPack = new Set(d.blocks);
    const whole = createHash('sha256');
    try {
      const count = Math.ceil(size / d.blockSize);
      for (let i = 0; i < count; i++) {
        const len = Math.min(d.blockSize, size - i * d.blockSize);
        let b: Buffer;
        if (inPack.has(i)) {
          const n = await fromPack.next();
          if (n.done || n.value.length !== len) throw new Error(t('Blok farkı uygulanamadı: paket eksik'));
          b = n.value;
        } else {
          b = Buffer.alloc(len);
          const { bytesRead } = await fh.read(b, 0, len, i * d.blockSize);
          if (bytesRead !== len) throw new Error(t('Hedefteki dosya paket hazırlanırken değişti; bir daha gönderin'));
        }
        whole.update(b);
        yield b;
      }
    } finally {
      await fh.close();
      member.destroy();
    }
    if (whole.digest('hex') !== d.hash) throw new Error(t('Blok farkı uygulanamadı: sonuç özeti tutmuyor'));
  }
  return Readable.from(gen());
}
