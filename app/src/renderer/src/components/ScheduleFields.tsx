// When something runs by itself: a switch, interval or fixed times, and how to be told. Used by the quick
// sends; the sync jobs have their own editor with the machine choice.
import { CalendarClock } from 'lucide-react';
import type { SyncSchedule } from '@shared/types';
import { Field, Segmented, Switch, TagInput } from './ui';
import { describeSchedule } from '../pages/AutomationPage';
import { t } from '@shared/i18n';

export function ScheduleFields({ value, onChange, offText }: { value?: SyncSchedule; onChange: (s: SyncSchedule | undefined) => void; offText?: string }) {
  const s = value;
  const enable = (on: boolean) => onChange(on ? { mode: 'times', everyMinutes: 60, times: ['02:00'], notify: 'errors', ...(s ?? {}), enabled: true } : s ? { ...s, enabled: false } : undefined);
  return (
    <div className="schedule-box">
      <div className="row" style={{ gap: 10 }}>
        <Switch on={!!s?.enabled} onChange={enable} />
        <CalendarClock size={15} className="faint" />
        <b style={{ fontSize: 13 }}>{t('Zamanla')}</b>
        <span className="faint" style={{ fontSize: 12 }}>
          {s?.enabled ? describeSchedule(s) : (offText ?? t('Yalnızca elle çalışır'))}
        </span>
      </div>
      {s?.enabled && (
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 10 }}>
          <Field label={t('Ne zaman')}>
            <Segmented
              value={s.mode}
              onChange={(mode) => onChange({ ...s, mode })}
              options={[
                { value: 'times', label: t('Belirli saatlerde') },
                { value: 'interval', label: t('Aralıkla') },
              ]}
            />
          </Field>
          {s.mode === 'interval' ? (
            <Field label={t('Her (dakika)')}>
              <input className="input" type="number" min={1} value={s.everyMinutes} onChange={(e) => onChange({ ...s, everyMinutes: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 100 }} />
            </Field>
          ) : (
            <Field label={t('Saatler (SS:dd)')} style={{ minWidth: 220 }}>
              <TagInput value={s.times} onChange={(times) => onChange({ ...s, times: times.filter((x) => /^\d{1,2}:\d{2}$/.test(x)) })} placeholder="02:00" />
            </Field>
          )}
          <Field label={t('Bildirim')}>
            <select className="select" value={s.notify} onChange={(e) => onChange({ ...s, notify: e.target.value as SyncSchedule['notify'] })} style={{ width: 170 }}>
              <option value="errors">{t('Yalnızca hatada')}</option>
              <option value="changes">{t('Değişiklik olunca')}</option>
              <option value="always">{t('Her çalışmada')}</option>
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}
