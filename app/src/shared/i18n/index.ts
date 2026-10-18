// The UI languages. The UI was written in Turkish, so the Turkish text is the key; en/, de/ and es/ map it to
// English, German and Spanish. A German or Spanish entry that is missing falls back to the English one.
// Call t() when the text is shown (render, message, menu build), never at module load, so a language switch
// reaches everything; constants that hold UI text wrap it in tk() and are shown with t().
import { EN } from './en';
import { DE } from './de';
import { ES } from './es';
import { LANGS, type Dict, type Lang, type LangPref, type Params } from './types';

export type { Lang, LangPref, Params } from './types';
export { LANGS } from './types';

const DICTS: Partial<Record<Lang, Dict>> = { en: EN, de: DE, es: ES };

let current: Lang = 'tr';

export function setLang(l: Lang): void {
  current = l;
}

export function getLang(): Lang {
  return current;
}

/** Locale for Intl and toLocaleString. */
const LOCALES: Record<Lang, string> = { tr: 'tr-TR', en: 'en-GB', de: 'de-DE', es: 'es-ES' };

export function locale(): string {
  return LOCALES[current];
}

/** The computer's language from its preferred language tags: the first one the UI speaks, else English. */
export function systemLang(tags: readonly (string | undefined | null)[]): Lang {
  const first = tags.find((x) => !!x)?.toLowerCase() ?? '';
  return LANGS.find((l) => first === l || first.startsWith(l + '-') || first.startsWith(l + '_')) ?? 'en';
}

export function resolveLang(pref: LangPref | undefined, system: Lang): Lang {
  return pref && pref !== 'system' && (LANGS as readonly string[]).includes(pref) ? pref : system;
}

function fill(s: string, p?: Params): string {
  return p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : s;
}

export function t(key: string, p?: Params): string {
  if (current !== 'tr') {
    const e = DICTS[current]?.[key] ?? EN[key];
    if (e !== undefined) return fill(typeof e === 'function' ? e(p ?? {}) : e, p);
  }
  return fill(key, p);
}

/** Marks Turkish UI text kept in a constant so the dictionary check finds it; show it with t(). */
export function tk<T extends string>(key: T): T {
  return key;
}
