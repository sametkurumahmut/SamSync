import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import type { OpenRequest } from '../src/shared/types';
import { LaunchQueue, parseLaunch } from '../src/main/launch';

const here = __filename;
const other = path.join(__dirname, 'helpers.ts');

describe('command line', () => {
  it('reads targets, flags and the paths that exist', () => {
    const l = parseLaunch(['--send', '--to', 'group:Lab1,PC2', '--yes', here, 'C:\\does\\not\\exist.txt', '--allow-file-access-from-files']);
    expect(l).toMatchObject({ targets: ['group:Lab1', 'PC2'], send: true, paths: [path.resolve(here)] });
    expect(parseLaunch(['--to=last', '--restore', '--hidden', other])).toMatchObject({ targets: ['last'], restore: true, hidden: true, paths: [path.resolve(other)] });
    expect(parseLaunch(['--remove-integrations']).removeIntegrations).toBe(true);
    expect(parseLaunch(['--quick', 'Release → Lab-A']).quick).toBe('Release → Lab-A');
    expect(parseLaunch(['--quick=gece']).quick).toBe('gece');
  });

  it('does not take the app folder for a path when running unpackaged', () => {
    expect(parseLaunch([__dirname, here], __dirname).paths).toEqual([path.resolve(here)]);
  });
});

describe('merging Explorer launches', () => {
  afterEach(() => vi.useRealTimers());

  it('merges one process per selected item into one request, per kind of request', () => {
    vi.useFakeTimers();
    const got: OpenRequest[] = [];
    const q = new LaunchQueue((r) => got.push(r));
    q.add({ paths: ['a'], targets: ['all'], send: true });
    vi.advanceTimersByTime(300);
    q.add({ paths: ['b'], targets: ['all'], send: true });
    q.add({ paths: ['x'] });
    // the second arrival widens the quiet window, so a slow third item still joins
    vi.advanceTimersByTime(1000);
    q.add({ paths: ['c', 'a'], targets: ['all'], send: true });
    vi.advanceTimersByTime(1199);
    expect(got).toEqual([{ paths: ['x'] }]);
    vi.advanceTimersByTime(1);
    expect(got[1]).toEqual({ paths: ['a', 'b', 'c'], targets: ['all'], send: true });
  });

  it('closes a batch after 30 seconds even if items keep coming', () => {
    vi.useFakeTimers();
    const got: OpenRequest[] = [];
    const q = new LaunchQueue((r) => got.push(r));
    for (let i = 0; i < 40; i++) {
      q.add({ paths: [`f${i}`] });
      vi.advanceTimersByTime(1000);
    }
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[0].paths.length).toBeLessThanOrEqual(31);
  });
});
