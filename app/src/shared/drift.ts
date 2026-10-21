import type { DriftReport } from './types';
import { t } from './i18n';

/** "3 değişmiş, 1 eklenmiş" for a machine or a folder of a drift check. */
export function driftCounts(r: Pick<DriftReport, 'changed' | 'added' | 'removed'>): string {
  return [r.changed ? t('{n} değişmiş', { n: r.changed }) : '', r.added ? t('{n} eklenmiş', { n: r.added }) : '', r.removed ? t('{n} silinmiş', { n: r.removed }) : ''].filter(Boolean).join(', ');
}

export const drifted = (r: Pick<DriftReport, 'changed' | 'added' | 'removed'>) => r.changed + r.added + r.removed > 0;
