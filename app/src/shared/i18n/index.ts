// Two UI languages. The UI was written in Turkish, so the Turkish text is the key and en/ maps it to
// English. Call t() when the text is shown (render, message, menu build), never at module load, so a
// language switch reaches everything; constants that hold UI text wrap it in tk() and are shown with t().
import { EN } from './en';
import type { Lang, LangPref, Params } from './types';

export type { Lang, LangPref, Params } from './types';

let current: Lang = 'tr';

export function setLang(l: Lang): void {
  current = l;
}

export function getLang(): Lang {
  return current;
}

/** Locale for Intl and toLocaleString. */
export function locale(): string {
  return current === 'tr' ? 'tr-TR' : 'en-GB';
}

/** The computer's language from its preferred language tags: Turkish or, for anything else, English. */
export function systemLang(tags: readonly (string | undefined | null)[]): Lang {
  const first = tags.find((x) => !!x)?.toLowerCase() ?? '';
  return first.startsWith('tr') ? 'tr' : 'en';
}

export function resolveLang(pref: LangPref | undefined, system: Lang): Lang {
  return pref === 'tr' || pref === 'en' ? pref : system;
}

function fill(s: string, p?: Params): string {
  return p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : s;
}

export function t(key: string, p?: Params): string {
  if (current === 'en') {
    const e = EN[key];
    if (e !== undefined) return fill(typeof e === 'function' ? e(p ?? {}) : e, p);
  }
  return fill(key, p);
}

/** Marks Turkish UI text kept in a constant so the dictionary check finds it; show it with t(). */
export function tk<T extends string>(key: T): T {
  return key;
}
