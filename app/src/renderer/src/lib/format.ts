import { locale, t } from '@shared/i18n';

export function bytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toLocaleString(locale(), { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${u[i]}`;
}

export function num(n: number): string {
  return n.toLocaleString(locale());
}

export function ago(at: number | undefined): string {
  if (!at) return '–';
  const s = Math.round((at - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 45) return t('az önce');
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
  return rtf.format(Math.round(s / (86400 * 365)), 'year');
}

export function dateTime(t: number | undefined): string {
  if (!t) return '–';
  return new Date(t).toLocaleString(locale(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function shortDateTime(t: number | undefined): string {
  if (!t) return '–';
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function duration(ms: number | undefined): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return t('{s} sn', { s: s.toFixed(s < 10 ? 1 : 0) });
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  if (m < 60) return t('{m} dk {s} sn', { m, s: r });
  return t('{h} sa {m} dk', { h: Math.floor(m / 60), m: m % 60 });
}

export function splitPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
}

export function baseName(p: string): string {
  return splitPath(p.replace(/[\\/]+$/, '')).name || p;
}

export function plural(n: number, word: string): string {
  return `${num(n)} ${word}`;
}

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Day and month only ("17 Eki"), for chart labels. */
export function shortDate(t: number | undefined): string {
  if (!t) return '–';
  return new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}
