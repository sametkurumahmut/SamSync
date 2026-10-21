// Where the settings cards go on the screen (components/Masonry.tsx); plain so the tests can run it.

/**
 * Columns for the cards by their heights: the longest cards are shared out first, each to the shortest column, so
 * the columns end near each other; inside a column the shorter cards come first. One column keeps the order.
 */
export function placeCards(heights: number[], cols: number, gap: number): number[][] {
  const idx = heights.map((_, i) => i);
  if (cols <= 1) return [idx];
  const sums = new Array<number>(cols).fill(0);
  const order = Array.from({ length: cols }, () => [] as number[]);
  for (const i of [...idx].sort((a, b) => heights[b] - heights[a] || a - b)) {
    const c = sums.indexOf(Math.min(...sums));
    order[c].push(i);
    // a section that shows nothing takes no room and no gap
    sums[c] += heights[i] ? heights[i] + gap : 0;
  }
  for (const col of order) col.sort((a, b) => heights[a] - heights[b] || a - b);
  return order;
}
