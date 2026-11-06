import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { describeSources } from '../src/core/plan';
import { tmpDir, makeCtx } from './helpers';

describe('reading the sources of the Send page', () => {
  it('counts a folder of many files in one go, sliced, and gives the same totals', async () => {
    const base = await tmpDir();
    const dir = path.join(base, 'Contents');
    await fsp.mkdir(path.join(dir, 'sub'), { recursive: true });
    // more files in one folder than one slice of the count holds
    await Promise.all(Array.from({ length: 1300 }, (_, i) => fsp.writeFile(path.join(dir, `f${i}.txt`), 'ab')));
    await fsp.writeFile(path.join(dir, 'sub', 'g.txt'), 'xyz');
    const ctx = makeCtx({ nodes: [] }, [base], path.join(base, 'ud'));
    const [info] = await describeSources(ctx, [dir]);
    expect(info).toMatchObject({ exists: true, isDir: true, fileCount: 1301, size: 1300 * 2 + 3 });
    expect(info.fileCountCapped).toBeFalsy();
  }, 30000);

  it('says why a source cannot be read, so the list can show it and read it again', async () => {
    const base = await tmpDir();
    const ctx = makeCtx({ nodes: [] }, [base], path.join(base, 'ud'));
    const [info] = await describeSources(ctx, [path.join(base, 'gone')]);
    expect(info.exists).toBe(false);
    expect(info.error).toBeTruthy();
  });
});
