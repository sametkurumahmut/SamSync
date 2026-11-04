// Finding text in a page of cards (the settings): the cards without it are hidden, the matches are marked with the
// CSS highlight API, so nothing in the page's own DOM changes and React keeps its nodes.

import { foldText } from '@shared/fold';

const HIGHLIGHT = 'samsync-find';

interface HighlightRegistry {
  set(name: string, h: unknown): void;
  delete(name: string): void;
}

function mark(ranges: Range[]) {
  const reg = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !H) return;
  if (ranges.length) reg.set(HIGHLIGHT, new H(...ranges));
  else reg.delete(HIGHLIGHT);
}

function rangesOf(el: HTMLElement, needle: string): Range[] {
  const out: Range[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = foldText(n.nodeValue ?? '');
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

/**
 * Hides the cards under `root` (matched by `selector`) that do not hold the text and marks it in the others.
 * Returns how many cards hold it, or null for an empty query (every card shown again, nothing marked).
 */
export function findInCards(root: HTMLElement, query: string, selector: string, hiddenClass = 'find-hidden'): number | null {
  const needle = foldText(query.trim());
  const ranges: Range[] = [];
  let shown = 0;
  for (const card of root.querySelectorAll<HTMLElement>(selector)) {
    if (!needle) {
      card.classList.remove(hiddenClass);
      continue;
    }
    const hits = rangesOf(card, needle);
    card.classList.toggle(hiddenClass, !hits.length);
    if (hits.length) shown++;
    ranges.push(...hits);
  }
  mark(ranges);
  return needle ? shown : null;
}

/** Takes the marks away (the page is left). */
export function clearFind() {
  mark([]);
}
