import { describe, it, expect } from 'vitest';
import type { SourceInfo } from '../src/shared/types';
import { coverageOf } from '../src/shared/coverage';

const info = (path: string, rel: string, isDir = true): SourceInfo => ({ path, exists: true, isDir, size: 0, mtimeMs: 0, rel, outsideRoots: false });

describe('the coverage note of overlapping sources', () => {
  it('says what a folder leaves to a source from elsewhere that lands inside its place', () => {
    const release = info('D:\\build\\Release', '');
    const contents = info('E:\\content\\Contents', 'Contents');
    const all = [release, contents];
    expect(coverageOf(release, all)).toEqual({ without: ['Contents'], mergedWith: [] });
    expect(coverageOf(contents, all)).toBeNull();
  });

  it('is silent for a source that lies inside the folder on disk', () => {
    const release = info('D:\\build\\Release', '');
    const data = info('D:\\build\\Release\\Data', 'Data');
    expect(coverageOf(release, [release, data])).toBeNull();
  });

  it('names the folders merged into the same place', () => {
    const a = info('D:\\one\\Release', '');
    const b = info('E:\\two\\Release', '');
    expect(coverageOf(a, [a, b])).toEqual({ without: [], mergedWith: ['E:\\two\\Release'] });
    expect(coverageOf(info('D:\\x\\f.txt', 'f.txt', false), [a, b])).toBeNull();
  });
});
