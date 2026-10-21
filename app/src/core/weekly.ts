// The weekly summary for the team's channel (Settings › Notifications, off by default): what the last seven days
// brought — sends and how they ended, the data, the machines that failed most, the ones away now, drift found.
import type { DriftReport, ProbeResult, RunSummary } from '../shared/types';
import type { RunMessage } from './notifications';
import { senderText } from './notifications';
import { formatBytes } from './util';
import { t, locale } from '../shared/i18n';

export const WEEK_MS = 7 * 86400_000;

/** The Monday 09:00 (local time) the summary for the week before it goes out, at or before `now`. */
export function lastMondayNine(now: Date): number {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  const back = (d.getDay() + 6) % 7; // Monday 0 … Sunday 6
  d.setDate(d.getDate() - back);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7);
  return d.getTime();
}

export function weeklyMessage(runs: RunSummary[], probes: ProbeResult[], names: Map<string, string>, drift: DriftReport[] | null, from: { host: string; user?: string; version?: string }, now = Date.now()): RunMessage {
  const since = now - WEEK_MS;
  const sends = runs.filter((r) => r.startedAt >= since && !r.dryRun && (r.origin === 'send' || r.origin === 'git'));
  const by = (s: string) => sends.filter((r) => r.status === s).length;
  const bytes = sends.reduce((a, r) => a + r.bytes, 0);
  const failures = new Map<string, number>();
  for (const r of sends) for (const x of r.targets) if (x.status === 'failed' || x.status === 'partial') failures.set(x.title, (failures.get(x.title) ?? 0) + 1);
  const worst = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const away = probes.filter((p) => !p.ok).map((p) => names.get(p.nodeId) ?? p.nodeId);
  const drifted = (drift ?? []).filter((r) => r.changed + r.added + r.removed > 0);
  const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  const lines = [`📊 ${t('SamSync haftalık özet ({from} – {to})', { from: day(since), to: day(now) })}`];
  lines.push(`• ${t('{n} gönderim: {ok} başarılı, {partial} kısmen, {failed} hatalı • {size}', { n: sends.length, ok: by('ok'), partial: by('partial'), failed: by('failed'), size: formatBytes(bytes) })}`);
  if (worst.length) lines.push(`• ${t('Hatalı biten makineler: {list}', { list: worst.map(([n, c]) => `${n} (${c})`).join(', ') })}`);
  if (away.length) lines.push(`• ${t('Şu an erişilemeyen: {list}', { list: away.slice(0, 10).join(', ') + (away.length > 10 ? '…' : '') })}`);
  if (drifted.length) lines.push(`• ${t('Sapma: {n} makinede son gönderimden sonra değişiklik', { n: drifted.length })}`);
  lines.push(`${t('Gönderen: {who}', { who: senderText(from) })}${from.version ? ` • SamSync ${from.version}` : ''}`);
  return {
    text: lines.join('\n'),
    payload: { kind: 'weekly', from: since, to: now, sends: sends.length, ok: by('ok'), partial: by('partial'), failed: by('failed'), bytes, failures: Object.fromEntries(worst), away, drift: drifted.map((r) => r.name), host: from.host, user: from.user, version: from.version },
  };
}
