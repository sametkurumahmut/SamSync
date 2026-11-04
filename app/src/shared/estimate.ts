import type { RunSummary } from './types';

/** One past write to a machine: how fast it went, by bytes and by file. */
interface Sample {
  bytesPerMs: number;
  msPerOp: number;
  /** Mostly small files: its time is the per-file work, so it tells the pace and not the byte rate. */
  small: boolean;
  run: string;
}

export interface SendEstimate {
  ms: number;
  /** Past sends the estimate stands on. */
  samples: number;
  /** Each machine's own time by its id (the machines with something to do). */
  perTarget: Record<string, number>;
}

const MIN_MS = 2000;
const PER_TARGET = 5;
const SMALL_FILE = 256 * 1024;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * How long a send should take, from the speed of the last real sends to the same machines
 * (a machine never written to uses the speed of all of them). A machine takes the longer of
 * its bytes at the rate of big-file sends and its files at the pace of small-file sends;
 * machines run `parallel` at a time. A staged send (`first`: the machines of its first stage) takes its
 * first stage and then the rest, one after the other.
 * Null when the history has nothing to go on for one of the machines.
 */
export function estimateSend(runs: RunSummary[], targets: { id: string; bytes: number; ops: number }[], parallel: number, first?: string[]): SendEstimate | null {
  const byKey = new Map<string, Sample[]>();
  const all: Sample[] = [];
  const recent = [...runs].filter((r) => !r.dryRun && r.origin !== 'restore').sort((a, b) => b.startedAt - a.startedAt);
  for (const r of recent) {
    for (const st of r.targets) {
      if (st.status !== 'ok' || !st.startedAt || !st.finishedAt || !st.done) continue;
      const ms = st.finishedAt - st.startedAt;
      if (ms < MIN_MS) continue;
      const list = byKey.get(st.key) ?? [];
      if (list.length >= PER_TARGET) continue;
      const s = { bytesPerMs: st.bytesDone / ms, msPerOp: ms / st.done, small: st.bytesDone / st.done < SMALL_FILE, run: r.id };
      list.push(s);
      byKey.set(st.key, list);
      if (all.length < 40) all.push(s);
    }
  }
  if (!all.length) return null;
  const used = new Set<string>();
  const perTarget: Record<string, number> = {};
  /** The first list that holds something: this machine's own history before the others'. */
  const firstOf = (...lists: Sample[][]) => lists.find((l) => l.length) ?? [];
  for (const tg of targets) {
    if (!tg.ops) continue;
    const own = byKey.get(tg.id) ?? [];
    const big = (x: Sample) => !x.small && x.bytesPerMs > 0;
    const moving = (x: Sample) => x.bytesPerMs > 0;
    // the byte rate from sends of big files (any when there are none), the per-file pace from sends of small ones
    const byRate = firstOf(own.filter(big), own.filter(moving), all.filter(big), all.filter(moving));
    const byPace = firstOf(own.filter((x) => x.small), all.filter((x) => x.small));
    // a send of many small files with no small-file send measured yet, or bytes with no rate: no ground to stand
    // on, so no estimate at all rather than one far off (3000 small files at a big-file rate would say seconds)
    if (tg.bytes / tg.ops < SMALL_FILE ? !byPace.length : !byRate.length) return null;
    for (const x of [...byRate, ...byPace]) used.add(x.run);
    const rate = byRate.length ? median(byRate.map((x) => x.bytesPerMs)) : 0;
    const pace = byPace.length ? median(byPace.map((x) => x.msPerOp)) : 0;
    const ms = Math.round(Math.max(rate > 0 ? tg.bytes / rate : 0, tg.ops * pace));
    perTarget[tg.id] = ms;
  }
  const ids = Object.keys(perTarget);
  if (!ids.length) return null;
  // machines `parallel` at a time: no less than the longest one, no less than the sum shared out
  const together = (list: string[]) => {
    const times = list.map((id) => perTarget[id]);
    return times.length ? Math.max(Math.max(...times), times.reduce((a, b) => a + b, 0) / Math.max(1, Math.min(parallel, times.length))) : 0;
  };
  const ms = first?.length ? together(ids.filter((id) => first.includes(id))) + together(ids.filter((id) => !first.includes(id))) : together(ids);
  return { ms: Math.round(ms), samples: used.size, perTarget };
}

/**
 * The machines that hold a send up: at least twice the median time of the others and 20 s or more,
 * with how many times slower they are.
 */
export function slowTargets(perTarget: Record<string, number>): Record<string, number> {
  const ids = Object.keys(perTarget);
  const out: Record<string, number> = {};
  if (ids.length < 3) return out;
  for (const id of ids) {
    const others = ids.filter((x) => x !== id).map((x) => perTarget[x]);
    const typical = median(others);
    const ms = perTarget[id];
    if (typical > 0 && ms >= 20_000 && ms >= 2 * typical) out[id] = Math.round(ms / typical);
  }
  return out;
}
