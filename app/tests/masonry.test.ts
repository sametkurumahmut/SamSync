import { describe, it, expect } from 'vitest';
import { placeCards } from '../src/shared/cards';

describe('settings cards in columns', () => {
  it('keeps the order in one column', () => {
    expect(placeCards([300, 100, 200], 1, 10)).toEqual([[0, 1, 2]]);
  });

  it('shares the cards out so the columns end close to each other, shorter cards on top', () => {
    // the page the settings had: one very long card, a few middle ones, short ones
    const h = [783, 235, 1256, 431, 137, 303, 455, 391, 154, 250, 309];
    const cols = placeCards(h, 3, 14);
    expect(cols.flat().sort((a, b) => a - b)).toEqual(h.map((_, i) => i));
    const ends = cols.map((c) => c.reduce((s, i) => s + h[i] + 14, -14));
    // no column more than one middle card longer than another
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(450);
    expect(Math.max(...ends)).toBeLessThan(1700);
    for (const c of cols) expect(c.map((i) => h[i])).toEqual([...c.map((i) => h[i])].sort((a, b) => a - b));
  });

  it('gives a card that shows nothing no room', () => {
    const cols = placeCards([0, 100, 100], 2, 10);
    const hs = [0, 100, 100];
    const ends = cols.map((c) => c.reduce((s: number, i: number) => s + (hs[i] ? hs[i] + 10 : 0), 0));
    expect(ends).toEqual([110, 110]);
  });
});
