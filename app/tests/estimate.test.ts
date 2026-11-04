import { describe, it, expect } from 'vitest';
import { estimateSend, slowTargets } from '../src/shared/estimate';
import type { RunSummary, RunTargetState } from '../src/shared/types';

const MB = 1024 * 1024;
let n = 0;
function run(targets: Partial<RunTargetState>[], extra: Partial<RunSummary> = {}): RunSummary {
  const at = 1_000_000 + n++ * 1000;
  return {
    id: `run-${n}`,
    label: 'x',
    origin: 'send',
    startedAt: at,
    status: 'ok',
    dryRun: false,
    opsTotal: 0,
    opsOk: 0,
    opsFailed: 0,
    bytes: 0,
    sources: [],
    targetIds: [],
    targets: targets.map((x) => ({ key: 'a', title: 'A', root: '', total: 10, done: 10, failed: 0, bytesTotal: 0, bytesDone: 0, status: 'ok', startedAt: at, finishedAt: at + 10_000, ...x })),
    ...extra,
  };
}

describe('send time estimate', () => {
  it('has nothing to say without past sends', () => {
    expect(estimateSend([], [{ id: 'a', bytes: MB, ops: 1 }], 4)).toBeNull();
    expect(estimateSend([run([{ status: 'failed' }]), run([{ finishedAt: undefined }])], [{ id: 'a', bytes: MB, ops: 1 }], 4)).toBeNull();
  });

  it('uses the speed of the machine itself: 10 MB in 10 s, so 50 MB takes 50 s', () => {
    const past = [run([{ bytesDone: 10 * MB, done: 2 }])];
    const e = estimateSend(past, [{ id: 'a', bytes: 50 * MB, ops: 5 }], 4)!;
    expect(e.ms).toBe(50_000);
    expect(e.samples).toBe(1);
  });

  it('counts files too, so many small files are not free', () => {
    // 10 small files in 10 s: 1 s per file
    const past = [run([{ bytesDone: MB, done: 10 }])];
    expect(estimateSend(past, [{ id: 'a', bytes: 1000, ops: 30 }], 4)!.ms).toBe(30_000);
  });

  it('takes the per-file pace only from small files, the byte rate from big ones', () => {
    // 10 big files in 10 s says nothing about the time of one small file
    const big = run([{ bytesDone: 100 * MB, done: 10 }]);
    expect(estimateSend([big], [{ id: 'a', bytes: 10 * MB, ops: 30 }], 4)!.ms).toBe(1000);
    // and a send of small files does not make a big one slow when a big one is known
    const small = run([{ bytesDone: MB, done: 10 }]);
    expect(estimateSend([small, big], [{ id: 'a', bytes: 50 * MB, ops: 2 }], 4)!.ms).toBe(5000);
  });

  it('falls back on the other machines and adds up what does not fit in parallel', () => {
    const past = [run([{ key: 'b', bytesDone: 10 * MB }])];
    const two = [
      { id: 'a', bytes: 20 * MB, ops: 1 },
      { id: 'c', bytes: 20 * MB, ops: 1 },
    ];
    expect(estimateSend(past, two, 4)!.ms).toBe(20_000);
    expect(estimateSend(past, two, 1)!.ms).toBe(40_000);
    expect(estimateSend(past, two, 1)!.perTarget).toEqual({ a: 20_000, c: 20_000 });
    // a staged send: the first stage, then the rest
    expect(estimateSend(past, two, 4, ['a'])!.ms).toBe(40_000);
    // two machines of one send are one send behind the estimate
    const both = [run([{ key: 'a', bytesDone: 10 * MB }, { key: 'c', bytesDone: 10 * MB }])];
    expect(estimateSend(both, two, 4)!.samples).toBe(1);
  });

  it('leaves out dry runs, restores and runs too short to measure', () => {
    const past = [run([{ bytesDone: 10 * MB }], { dryRun: true }), run([{ bytesDone: 10 * MB }], { origin: 'restore' }), run([{ bytesDone: MB, finishedAt: 1 }])];
    expect(estimateSend(past, [{ id: 'a', bytes: MB, ops: 1 }], 1)).toBeNull();
  });

  it('names the machine that holds the send up', () => {
    expect(slowTargets({ a: 10_000, b: 12_000, c: 60_000 })).toEqual({ c: 5 });
    // not when it is quick anyway, nor with too few machines to tell
    expect(slowTargets({ a: 1000, b: 1000, c: 8000 })).toEqual({});
    expect(slowTargets({ a: 10_000, b: 60_000 })).toEqual({});
  });

  it('says nothing for many small files when only big files were ever measured', () => {
    const past = [run([{ bytesDone: 100 * MB, done: 2 }]), run([{ bytesDone: 100 * MB, done: 2 }])];
    expect(estimateSend(past, [{ id: 'a', bytes: 30 * MB + 50 * MB, ops: 3001 }], 4)).toBeNull();
  });

  it('takes the machine’s own history before the others', () => {
    // a slow machine with small-file sends only, and a fast one with big files
    const past = [run([{ key: 'slow', bytesDone: 2 * MB, done: 20 }]), run([{ key: 'fast', bytesDone: 100 * MB, done: 2 }])];
    // its own rate: 2 MB in 10 s, so 10 MB of big files take 50 s (the fast machine's would say 1 s)
    expect(estimateSend(past, [{ id: 'slow', bytes: 10 * MB, ops: 2 }], 4)!.ms).toBe(50_000);
  });
});
