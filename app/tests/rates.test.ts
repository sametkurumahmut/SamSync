import { describe, it, expect } from 'vitest';
import { pushSample, ratesPerSecond, valueAt } from '../src/renderer/src/lib/rates';

describe('throughput from progress samples', () => {
  it('interpolates between samples and holds flat outside them', () => {
    const s = [
      { t: 1000, b: 0 },
      { t: 3000, b: 2000 },
    ];
    expect(valueAt(s, 0)).toBe(0);
    expect(valueAt(s, 2000)).toBe(1000);
    expect(valueAt(s, 9000)).toBe(2000);
    expect(valueAt([], 5)).toBe(0);
  });

  it('gives one rate per second, oldest first, for the seconds since the first sample', () => {
    const s = [
      { t: 10_000, b: 0 },
      { t: 12_000, b: 2_000_000 }, // 1 MB/s for two seconds
      { t: 15_000, b: 2_000_000 }, // then a stall
    ];
    const r = ratesPerSecond(s, 15_000, 60);
    expect(r).toHaveLength(5);
    expect(r[0]).toBe(1_000_000);
    expect(r[1]).toBe(1_000_000);
    expect(r[2]).toBe(0);
    expect(r[4]).toBe(0);
  });

  it('caps the window and needs two samples', () => {
    const s = Array.from({ length: 200 }, (_, i) => ({ t: i * 1000, b: i * 500 }));
    expect(ratesPerSecond(s, 199_000, 60)).toHaveLength(60);
    expect(ratesPerSecond([{ t: 0, b: 0 }], 5000)).toEqual([]);
  });

  it('keeps only the recent samples, plus the one just before the window', () => {
    let s: { t: number; b: number }[] = [];
    for (let i = 0; i <= 300; i++) s = pushSample(s, { t: i * 1000, b: i }, 120_000);
    expect(s[s.length - 1].t).toBe(300_000);
    expect(s[0].t).toBeLessThanOrEqual(180_000);
    expect(s[1].t).toBeGreaterThanOrEqual(180_000);
  });
});
