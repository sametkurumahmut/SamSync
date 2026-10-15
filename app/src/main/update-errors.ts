import type { UpdateState } from '../shared/types';
import { t } from '../shared/i18n';

const NOTHING_PUBLISHED = ['ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'];

/**
 * electron-updater's errors as the Updates card shows them. A source with no published release yet is not an
 * error, and the feed errors carry the whole releases feed (XML) after the message, which is cut off.
 */
export function explainUpdateError(e: unknown): Pick<UpdateState, 'phase' | 'error' | 'detail' | 'checkedAt'> {
  const err = e as { code?: string; message?: string } | undefined;
  const message = String(err?.message ?? e ?? '');
  if (NOTHING_PUBLISHED.includes(err?.code ?? '') || /please ensure a production release exists|No published versions/i.test(message)) {
    return { phase: 'none', error: undefined, detail: t('Bu kaynakta henüz yayımlanmış bir sürüm yok.'), checkedAt: Date.now() };
  }
  let short = message.split(/,?\s*\n\s*XML:/)[0].split('\n')[0].trim();
  if (short.length > 400) short = `${short.slice(0, 400)}…`;
  return { phase: 'error', error: short || t('Bilinmeyen hata'), detail: undefined };
}
