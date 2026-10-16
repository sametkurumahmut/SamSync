import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openPackEntry, packMethodFor, packStream, packSummary, type PackEntry } from '../src/core/pack';
import { tmpDir } from './helpers';

async function readAll(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe('pack', () => {
  it('stores compressed formats as they are and gzips the rest', () => {
    expect(packMethodFor('Data/x.dll')).toBe('gzip');
    expect(packMethodFor('Textures/a.PNG')).toBe('store');
    expect(packMethodFor('Audio/song.mp3')).toBe('store');
    expect(packMethodFor('Models/m.fbx')).toBe('gzip');
  });

  it('round-trips files through one stream with an index of offsets', async () => {
    const dir = await tmpDir();
    const text = Buffer.from('abc '.repeat(50_000)); // compresses well
    const noise = Buffer.alloc(70_000);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) & 0xff;
    const files = [
      { rel: 'Data/text.txt', data: text },
      { rel: 'Data/empty.txt', data: Buffer.alloc(0) },
      { rel: 'Data/img.png', data: noise },
      { rel: 'Data/sub/last.bin', data: Buffer.concat([noise, text]) },
    ];
    for (const f of files) {
      await fsp.mkdir(path.join(dir, path.dirname(f.rel)), { recursive: true });
      await fsp.writeFile(path.join(dir, f.rel), f.data);
    }
    const entries: PackEntry[] = [];
    const seen: string[] = [];
    const packFile = path.join(dir, 'x.pack');
    await pipeline(
      packStream(
        files.map((f) => ({ rel: f.rel, size: f.data.length, mtimeMs: 1700000000000, open: () => fs.createReadStream(path.join(dir, f.rel)) })),
        entries,
        (s) => seen.push(s.rel),
      ),
      fs.createWriteStream(packFile),
    );
    expect(seen).toEqual(files.map((f) => f.rel));
    expect(entries.map((e) => e.method)).toEqual(['gzip', 'gzip', 'store', 'gzip']);
    const total = (await fsp.stat(packFile)).size;
    expect(entries[entries.length - 1].offset + entries[entries.length - 1].length).toBe(total);
    const sum = packSummary(entries);
    expect(sum.size).toBe(files.reduce((a, f) => a + f.data.length, 0));
    expect(sum.packed).toBeLessThan(sum.size / 2); // the text shrinks a lot, the noise not at all
    for (const [i, f] of files.entries()) {
      const back = await readAll(openPackEntry(packFile, entries[i]));
      expect(back.equals(f.data)).toBe(true);
    }
  });
});
