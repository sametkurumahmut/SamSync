import { describe, it, expect } from 'vitest';
import { explainUpdateError } from '../src/main/update-errors';

describe('update errors', () => {
  it('reports a GitHub repository without a published release as nothing to update, not as an error', () => {
    // what electron-updater throws while the only release is still a draft
    const e = Object.assign(
      new Error('Cannot parse releases feed: Error: Unable to find latest version on GitHub (https://github.com/o/r/releases/latest), please ensure a production release exists: HttpError: 406,\nXML:\n<?xml version="1.0"?><feed>…</feed>'),
      { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' },
    );
    expect(explainUpdateError(e)).toMatchObject({ phase: 'none', error: undefined, detail: 'Bu kaynakta henüz yayımlanmış bir sürüm yok.' });
    expect(explainUpdateError(Object.assign(new Error('x'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' })).phase).toBe('none');
  });

  it('keeps other errors but drops the releases feed that electron-updater appends', () => {
    const e = new Error('Cannot parse releases feed: Error: boom,\nXML:\n<feed>' + 'x'.repeat(5000) + '</feed>');
    expect(explainUpdateError(e)).toEqual({ phase: 'error', error: 'Cannot parse releases feed: Error: boom', detail: undefined });
    expect(explainUpdateError(new Error('a'.repeat(1000))).error).toHaveLength(401);
    expect(explainUpdateError(undefined).error).toBe('Bilinmeyen hata');
  });
});
