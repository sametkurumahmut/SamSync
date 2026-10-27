// A release's notes come English first, with the Turkish folded under a "Türkçe" heading after them
// (scripts/release-notes.mjs). The update window shows the part in its own language.

const TURKISH = /<details[^>]*>\s*<summary[^>]*>\s*T(?:ü|&uuml;|&#252;)rk(?:ç|&ccedil;|&#231;)e\s*<\/summary>([\s\S]*?)<\/details>/i; // i18n-ignore

/** The notes in `lang`: the Turkish fold in Turkish, everything else without it; notes with no fold stay whole. */
export function notesInLang(notes: string, lang: string): string {
  const m = TURKISH.exec(notes);
  if (!m) return notes;
  if (lang === 'tr') return m[1].trim();
  return (notes.slice(0, m.index) + notes.slice(m.index + m[0].length)).trim();
}
