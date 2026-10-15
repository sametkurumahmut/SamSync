import type { AutomationSettings, GitEvent, LocalSettings } from './types';

export const DEFAULT_AUTOMATION: AutomationSettings = {
  retryUnreachable: false,
  retryEveryMinutes: 5,
  notify: 'errors',
  maxFilesPerSend: 1000,
  catchUpSchedules: true,
};

export const DEFAULT_GIT_EVENTS: GitEvent[] = ['commit', 'amend', 'merge', 'pull'];

const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

/** The automation settings with defaults for anything missing or out of range. */
export function automationSettings(s: Partial<LocalSettings> | undefined): AutomationSettings {
  const a = { ...DEFAULT_AUTOMATION, ...(s?.automation ?? {}) };
  return {
    retryUnreachable: !!a.retryUnreachable,
    retryEveryMinutes: int(a.retryEveryMinutes, DEFAULT_AUTOMATION.retryEveryMinutes, 1, 24 * 60),
    notify: a.notify === 'never' || a.notify === 'always' ? a.notify : 'errors',
    maxFilesPerSend: int(a.maxFilesPerSend, DEFAULT_AUTOMATION.maxFilesPerSend, 0, 10_000_000),
    catchUpSchedules: a.catchUpSchedules !== false,
  };
}
