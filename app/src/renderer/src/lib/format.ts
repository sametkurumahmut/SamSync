export function bytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toLocaleString('tr-TR', { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${u[i]}`;
}

export function num(n: number): string {
  return n.toLocaleString('tr-TR');
}

const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });

export function ago(t: number | undefined): string {
  if (!t) return '–';
  const s = Math.round((t - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 45) return 'az önce';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
  return rtf.format(Math.round(s / (86400 * 365)), 'year');
}

export function dateTime(t: number | undefined): string {
  if (!t) return '–';
  return new Date(t).toLocaleString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function shortDateTime(t: number | undefined): string {
  if (!t) return '–';
  const d = new Date(t);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function duration(ms: number | undefined): string {
  if (ms == null) return '–';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} sn`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  if (m < 60) return `${m} dk ${r} sn`;
  return `${Math.floor(m / 60)} sa ${m % 60} dk`;
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
