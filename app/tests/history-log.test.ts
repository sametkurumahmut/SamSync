import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { History } from '../src/core/history';
import type { RunDetail } from '../src/shared/types';
import { tmpDir } from './helpers';

function run(id: string, log: RunDetail['log'] = []): RunDetail {
  return { id, label: id, origin: 'send', startedAt: Date.now(), finishedAt: Date.now(), status: 'ok', dryRun: false, targets: [], opsTotal: 0, opsOk: 0, opsFailed: 0, bytes: 0, sources: [], targetIds: [], results: [], log };
}

describe('run logs on disk', () => {
  it('writes the lines as they come and gives them back with the run, without keeping them in the JSON', async () => {
    const h = new History(await tmpDir());
    const w = h.openLog('run-1');
    w.write([{ t: 1, level: 'info', message: 'a' }]);
    w.write([
      { t: 2, level: 'warn', message: 'b', key: 'T' },
      { t: 3, level: 'error', message: 'c' },
    ]);
    await w.close();
    await h.save(run('run-1', [{ t: 3, level: 'error', message: 'c' }]));
    const dir = path.join((h as unknown as { dir: string }).dir);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'run-1.json'), 'utf8')) as RunDetail;
    expect(json.log).toEqual([]);
    const got = await h.get('run-1');
    expect(got?.log.map((l) => l.message)).toEqual(['a', 'b', 'c']);
    expect(got?.log[1].key).toBe('T');
    await h.remove('run-1');
    expect(fs.existsSync(path.join(dir, 'run-1.log'))).toBe(false);
  });

  it('keeps the log inside the JSON when no log file was written', async () => {
    const h = new History(await tmpDir());
    await h.save(run('run-2', [{ t: 1, level: 'info', message: 'x' }]));
    expect((await h.get('run-2'))?.log.map((l) => l.message)).toEqual(['x']);
  });
});
