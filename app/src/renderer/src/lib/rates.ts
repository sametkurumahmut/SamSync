// Throughput over time from the progress samples a run sends (bytes done so far at a time). The run panel
// draws the last minute of it; the numbers are per second so a slow link or a stall is visible at a glance.

export interface Sample {
  /** ms since epoch */
  t: number;
  /** bytes written so far */
  b: number;
}

/** Bytes done at time t, interpolated between the samples around it (flat before the first and after the last). */
export function valueAt(samples: Sample[], t: number): number {
  const n = samples.length;
  if (!n) return 0;
  if (t <= samples[0].t) return samples[0].b;
  if (t >= samples[n - 1].t) return samples[n - 1].b;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b.t - a.t;
  return span <= 0 ? b.b : a.b + ((b.b - a.b) * (t - a.t)) / span;
}

/**
 * Bytes per second for each of the last `seconds` whole seconds ending at `now`, oldest first. Seconds before
 * the first sample are left out, so a young run gives a short list; fewer than two samples give none.
 */
export function ratesPerSecond(samples: Sample[], now: number, seconds = 60): number[] {
  if (samples.length < 2) return [];
  const since = Math.min(seconds, Math.ceil((now - samples[0].t) / 1000));
  const out: number[] = [];
  for (let k = since; k >= 1; k--) {
    const t1 = now - (k - 1) * 1000;
    out.push(Math.max(0, valueAt(samples, t1) - valueAt(samples, t1 - 1000)));
  }
  return out;
}

/** Appends a sample, dropping what is older than `keepMs` (the chart only shows the last minute). */
export function pushSample(samples: Sample[], s: Sample, keepMs = 120_000): Sample[] {
  const cut = s.t - keepMs;
  let i = 0;
  while (i < samples.length - 1 && samples[i + 1].t < cut) i++;
  return [...samples.slice(i), s];
}
