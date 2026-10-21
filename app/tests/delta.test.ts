import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { blocksOf, changedBlocks, fileBlocks, patchedStream, type DeltaInfo } from '../src/core/delta';
import { tmpDir } from './helpers';

const BLOCK = 1024;

async function collect(r: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of r) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

function bytes(n: number, seed: number): Buffer {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

/** The old file on "the target", the new one at "the source"; returns what went into the pack and the rebuilt file. */
async function roundTrip(oldData: Buffer, newData: Buffer) {
  const dir = await tmpDir();
  const base = path.join(dir, 'base.bin');
  await fsp.writeFile(base, oldData);
  const list = await fileBlocks(base, BLOCK);
  const out: { info?: DeltaInfo; size: number; sent: number } = { size: 0, sent: 0 };
  const member = await collect(changedBlocks(Readable.from([newData]), list, BLOCK, out));
  const rebuilt = await collect(patchedStream(Readable.from([member]), base, newData.length, out.info!));
  return { out, member, rebuilt, base };
}

describe('block delta', () => {
  it('cuts streams into exact blocks whatever the chunks are', async () => {
    const data = bytes(3500, 1);
    const chunks = [data.subarray(0, 10), data.subarray(10, 2100), data.subarray(2100)];
    const blocks: Buffer[] = [];
    for await (const b of blocksOf(Readable.from(chunks), BLOCK)) blocks.push(b);
    expect(blocks.map((b) => b.length)).toEqual([1024, 1024, 1024, 428]);
    expect(Buffer.concat(blocks).equals(data)).toBe(true);
  });

  it('sends only the blocks that differ and rebuilds the file exactly', async () => {
    const oldData = bytes(10 * BLOCK + 100, 2);
    const newData = Buffer.from(oldData);
    newData[3 * BLOCK + 5] ^= 0xff; // one byte in block 3
    newData[9 * BLOCK] ^= 0xff; // and one in block 9
    const r = await roundTrip(oldData, newData);
    expect(r.out.info!.blocks).toEqual([3, 9]);
    expect(r.member.length).toBe(2 * BLOCK);
    expect(r.rebuilt.equals(newData)).toBe(true);
    expect(r.out.info!.hash).toBe(createHash('sha256').update(newData).digest('hex'));
  });

  it('handles a file that grew or shrank', async () => {
    const oldData = bytes(5 * BLOCK, 3);
    const grown = Buffer.concat([oldData, bytes(2 * BLOCK + 7, 9)]);
    const g = await roundTrip(oldData, grown);
    expect(g.out.info!.blocks).toEqual([5, 6, 7]);
    expect(g.rebuilt.equals(grown)).toBe(true);
    const shrunk = oldData.subarray(0, 2 * BLOCK + 10);
    const s = await roundTrip(oldData, shrunk);
    expect(s.out.info!.blocks).toEqual([2]);
    expect(s.rebuilt.equals(shrunk)).toBe(true);
  });

  it('refuses to build on a target file that changed after its block list was made', async () => {
    const oldData = bytes(4 * BLOCK, 4);
    const newData = Buffer.from(oldData);
    newData[0] ^= 1;
    const dir = await tmpDir();
    const base = path.join(dir, 'base.bin');
    await fsp.writeFile(base, oldData);
    const list = await fileBlocks(base, BLOCK);
    const out: { info?: DeltaInfo; size: number; sent: number } = { size: 0, sent: 0 };
    const member = await collect(changedBlocks(Readable.from([newData]), list, BLOCK, out));
    // somebody wrote the target file meanwhile, same size
    await fsp.writeFile(base, bytes(4 * BLOCK, 99));
    fs.utimesSync(base, new Date(), new Date(Date.now() + 60_000));
    await expect(collect(patchedStream(Readable.from([member]), base, newData.length, out.info!))).rejects.toThrow(/değişti|changed/);
    // the same size and time, other bytes: the whole file's hash catches it
    await fsp.writeFile(base, bytes(4 * BLOCK, 98));
    fs.utimesSync(base, new Date(list.mtimeMs), new Date(list.mtimeMs));
    await expect(collect(patchedStream(Readable.from([member]), base, newData.length, out.info!))).rejects.toThrow(/özeti tutmuyor|hash/);
  });
});
