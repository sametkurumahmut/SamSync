import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { scanTree } from '../src/core/scan';
import { FsTransport } from '../src/core/transport';
import { WinLister, wantsFastList } from '../src/core/winlist';
import { makeFilter } from '../src/core/filter';
import { tmpDir, write, daysAgo } from './helpers';

const win = process.platform === 'win32';

describe('the batched folder lister (Windows)', () => {
  afterEach(() => {
    delete process.env.SAMSYNC_FAST_LIST;
  });

  it.skipIf(!win)('lists a folder with sizes and times, like the plain walk does', async () => {
    const root = await tmpDir();
    await write(path.join(root, 'a.txt'), 'hello', daysAgo(2));
    await write(path.join(root, 'Çalışma', 'ölçü.bin'), 'x'.repeat(12345), daysAgo(1));
    await write(path.join(root, 'Çalışma', 'deeper', 'z'), '');
    await fsp.mkdir(path.join(root, 'empty'));
    const lister = new WinLister(2);
    try {
      const top = (await lister.list(root)).sort((a, b) => a.rel.localeCompare(b.rel));
      expect(top.map((e) => [e.rel, e.isDir, e.size])).toEqual([
        ['a.txt', false, 5],
        ['Çalışma', true, 0],
        ['empty', true, 0],
      ]);
      const st = await fsp.stat(path.join(root, 'a.txt'));
      expect(Math.abs(top[0].mtimeMs - st.mtimeMs)).toBeLessThan(1000);
      const sub = await lister.list(path.join(root, 'Çalışma'));
      expect(sub.find((e) => e.rel === 'ölçü.bin')?.size).toBe(12345);
      await expect(lister.list(path.join(root, 'does-not-exist'))).rejects.toThrow();
    } finally {
      lister.close();
    }
  });

  it.skipIf(!win)('gives the tree walk the same entries, and still skips excluded folders', async () => {
    const root = await tmpDir();
    await write(path.join(root, 'keep', 'k.txt'), 'k', daysAgo(3));
    await write(path.join(root, 'keep', 'inner', 'i.txt'), 'ii');
    await write(path.join(root, '_SamSyncYedek', '20260101-101010', 'old.txt'), 'old');
    await write(path.join(root, 'top.txt'), 'top');
    const filter = makeFilter({ excludeFiles: [], excludeDirs: [], alwaysExcludeDirs: ['_SamSyncYedek'] });
    const t = new FsTransport(root);
    process.env.SAMSYNC_FAST_LIST = '0';
    const plain = await scanTree(t, '', { filter, caseInsensitive: true });
    process.env.SAMSYNC_FAST_LIST = 'always';
    expect(wantsFastList(root)).toBe(true);
    const fast = await scanTree(t, '', { filter, caseInsensitive: true });
    const shape = (m: Map<string, { rel: string; isDir: boolean; size: number; mtimeMs: number }>) =>
      [...m.values()].sort((a, b) => a.rel.localeCompare(b.rel)).map((e) => [e.rel, e.isDir, e.size, Math.round(e.mtimeMs / 1000)]);
    expect(shape(fast.entries)).toEqual(shape(plain.entries));
    expect([...fast.entries.keys()].some((k) => k.includes('_samsyncyedek'))).toBe(false);
    expect(fast.errors).toEqual([]);
    // a sub folder as the base: paths stay relative to it
    const below = await scanTree(t, 'keep', { filter, caseInsensitive: true });
    expect([...below.entries.values()].map((e) => e.rel).sort()).toEqual(['inner', 'inner/i.txt', 'k.txt']);
  });
});
