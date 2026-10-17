// The history in numbers: the last 30 days as bars (bytes per day, a day with a failure in red), the
// totals of that window, and the machines that received the most. Clicking a day narrows the list to it.
import { useMemo } from 'react';
import { BarChart3, X } from 'lucide-react';
import type { RunSummary } from '@shared/types';
import { Bars } from './charts';
import { Button } from './ui';
import { bytes, cls, num, shortDate } from '../lib/format';
import { t } from '@shared/i18n';

const DAY = 86400_000;
const DAYS = 30;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function HistoryStats({ runs, day, onDay }: { runs: RunSummary[]; day: number | null; onDay: (day: number | null) => void }) {
  const s = useMemo(() => {
    const today = startOfDay(Date.now());
    const from = today - (DAYS - 1) * DAY;
    const real = runs.filter((r) => !r.dryRun);
    const window = real.filter((r) => r.startedAt >= from);
    const days = Array.from({ length: DAYS }, (_, i) => ({ at: from + i * DAY, bytes: 0, runs: 0, failed: 0 }));
    for (const r of window) {
      const i = Math.floor((startOfDay(r.startedAt) - from) / DAY);
      if (i < 0 || i >= DAYS) continue;
      days[i].bytes += r.bytes;
      days[i].runs++;
      if (r.status === 'failed' || r.status === 'partial') days[i].failed++;
    }
    const failed = window.filter((r) => r.status === 'failed' || r.status === 'partial').length;
    const total = window.reduce((a, r) => a + r.bytes, 0);
    const ms = window.reduce((a, r) => a + ((r.finishedAt ?? r.startedAt) - r.startedAt), 0);
    const byTarget = new Map<string, { title: string; bytes: number; runs: number; failed: number }>();
    for (const r of window)
      for (const x of r.targets) {
        const e = byTarget.get(x.key) ?? { title: x.title, bytes: 0, runs: 0, failed: 0 };
        e.bytes += x.bytesDone;
        e.runs++;
        if (x.status === 'failed' || x.status === 'partial') e.failed++;
        byTarget.set(x.key, e);
      }
    const top = [...byTarget.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
    return { days, runs: window.length, failed, total, pace: ms > 0 ? (total / ms) * 1000 : 0, top, maxTarget: top[0]?.bytes ?? 0 };
  }, [runs]);

  if (!runs.length) return null;
  return (
    <div className="card history-stats">
      <div className="hs-tiles">
        <div className="hs-tile">
          <span className="hs-label">
            <BarChart3 size={12} /> {t('Son {n} gün', { n: DAYS })}
          </span>
          <span className="hs-value">{num(s.runs)}</span>
          <span className="hs-sub">{t('gönderim')}</span>
        </div>
        <div className="hs-tile">
          <span className="hs-label">{t('Aktarılan')}</span>
          <span className="hs-value">{bytes(s.total)}</span>
          <span className="hs-sub">{s.pace > 0 ? t('ort. {speed}/sn', { speed: bytes(s.pace) }) : ''}</span>
        </div>
        <div className={cls('hs-tile', s.failed > 0 && 'bad')}>
          <span className="hs-label">{t('Hatalı')}</span>
          <span className="hs-value">{s.failed}</span>
          <span className="hs-sub">{s.runs ? t('%{pct}', { pct: Math.round((100 * s.failed) / s.runs) }) : ''}</span>
        </div>
      </div>
      <div className="hs-chart">
        <div className="row" style={{ fontSize: 11, marginBottom: 4 }}>
          <span className="faint">{t('Gün gün aktarılan veri')}</span>
          <span className="spacer" />
          {day != null && (
            <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => onDay(null)}>
              {shortDate(day)}
            </Button>
          )}
        </div>
        <Bars
          values={s.days.map((d) => d.bytes)}
          height={40}
          tone={(i) => (s.days[i].failed ? 'var(--red)' : day != null && s.days[i].at === day ? 'var(--accent-2)' : undefined)}
          titles={s.days.map((d) => `${shortDate(d.at)}: ${d.runs ? `${t('{n} gönderim', { n: d.runs })} • ${bytes(d.bytes)}${d.failed ? ` • ${t('{n} hatalı', { n: d.failed })}` : ''}` : t('gönderim yok')}`)}
          onPick={(i) => onDay(s.days[i].at === day ? null : s.days[i].at)}
        />
      </div>
      {s.top.length > 1 && (
        <div className="hs-targets">
          <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>
            {t('En çok alan makineler')}
          </div>
          {s.top.map((x) => (
            <div key={x.title} className="hs-target" title={`${x.runs} ${t('gönderim')}${x.failed ? ` • ${t('{n} hatalı', { n: x.failed })}` : ''}`}>
              <span className="ellipsis" style={{ fontSize: 11.5 }}>
                {x.title}
              </span>
              <span className="hs-bar">
                <span style={{ width: `${s.maxTarget ? Math.max(3, (100 * x.bytes) / s.maxTarget) : 0}%`, background: x.failed ? 'var(--red)' : 'var(--accent)' }} />
              </span>
              <span className="faint tabular" style={{ fontSize: 11 }}>
                {bytes(x.bytes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
