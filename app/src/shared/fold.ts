// Folding text for a search that ignores case and accents (the settings search, the command palette).

/** One character folded for a search: lower case, accents off, the dotless i as i; one UTF-16 unit in, one out. */
function fold(ch: string): string {
  const l = ch.toLowerCase().normalize('NFD').charAt(0) || ch;
  return l === 'ı' ? 'i' : l; // i18n-ignore: a letter, not text
}

/** The text folded for a search, as long as the text (offsets in one are offsets in the other). */
export function foldText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += fold(s[i]);
  return out;
}

/**
 * How well a text matches what was typed: 3 it starts with it, 2 it holds it (or each of its words), 1 its letters
 * in order, 0 not at all; 1 for nothing typed.
 */
export function matchScore(text: string, q: string): number {
  // spaces around it mean nothing ("lab " finds what "lab" finds; a lone space is no query)
  const s = foldText(q.trim()).replace(/\s+/g, ' ');
  if (!s) return 1;
  // accents folded, as in the settings search: "gorunum" finds "Görünüm"
  const lt = foldText(text);
  if (lt.includes(s)) return 2 + (lt.startsWith(s) ? 1 : 0);
  // several words: each one somewhere ("lab-b pc-1" finds PC-1 of the Lab-B group)
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => lt.includes(w))) return 2;
  let i = 0;
  for (const ch of lt) if (ch === s[i]) i++;
  return i === s.length ? 1 : 0;
}
