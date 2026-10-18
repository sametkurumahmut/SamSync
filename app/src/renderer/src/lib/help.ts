// The help bot's knowledge in the window: the README of each language is bundled as text at build time and
// indexed once, together with the FAQ, when it is first asked for.
import readmeTr from '../../../../README.tr.md?raw';
import readmeEn from '../../../../README.md?raw';
import { buildHelpIndex, type HelpIndex, type HelpLang } from '@shared/help/search';
import { getLang } from '@shared/i18n';

const cache = new Map<HelpLang, HelpIndex>();

export function helpLang(): HelpLang {
  return getLang() === 'tr' ? 'tr' : 'en';
}

export function helpIndex(lang: HelpLang = helpLang()): HelpIndex {
  let idx = cache.get(lang);
  if (!idx) {
    idx = buildHelpIndex(lang, lang === 'tr' ? readmeTr : readmeEn);
    cache.set(lang, idx);
  }
  return idx;
}
