import { locale, t } from './i18n';

/** A size as people read it, in the UI's language (2,4 MB in Turkish, 2.4 MB in English): the pages, the run log, messages. */
export function bytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  // what it rounds to decides the unit: 1023.97 KB is 1 MB, not 1024 KB
  const shown = (x: number, unit: number) => (unit === 0 || x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
  while (shown(v, i) >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  // a speed below 1 KB/s is a fraction of bytes: whole bytes
  return `${i === 0 ? Math.round(v) : v.toLocaleString(locale(), { maximumFractionDigits: v >= 100 ? 0 : 1, useGrouping: false })} ${u[i]}`;
}

/** Seconds with one decimal in the UI's language (3,4 in Turkish, 3.4 in English), for the run log's timing. */
export function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
}

/** A time span as people read it: 48 ms, 3,4 sn, 12 sn, 2 dk 5 sn, 1 sa 4 dk (the run panel and the run log). */
export function duration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  if (Math.round(ms) < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 9.95) return t('{s} sn', { s: seconds(ms) });
  // whole seconds first, so 119.6 s is 2 dk 0 sn and never 1 dk 60 sn
  const total = Math.round(s);
  if (total < 60) return t('{s} sn', { s: total });
  const m = Math.floor(total / 60);
  if (m < 60) return t('{m} dk {s} sn', { m, s: total % 60 });
  return t('{h} sa {m} dk', { h: Math.floor(m / 60), m: m % 60 });
}
