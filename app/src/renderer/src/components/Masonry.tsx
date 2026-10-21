// Cards in columns without gaps between them: shared out so the columns end near each other, the shorter cards on
// top in each column. Which card goes into which column is decided while the page settles and again only when the number of
// columns changes; a card that grows while it is used pushes the ones below it down and stays where it is.
// The cards keep their order in the document (keyboard order), only their place on the screen changes.
import { Children, useLayoutEffect, useRef, type ReactNode } from 'react';
import { placeCards } from '@shared/cards';

interface Placement {
  cols: number;
  n: number;
  /** card indexes per column, top to bottom */
  order: number[][];
}

/** How long after the first paint the columns are still chosen again (sections that fill in from the app). */
const SETTLE_MS = 1200;

export function Masonry({ children, minWidth = 440, gap = 14, className }: { children: ReactNode; minWidth?: number; gap?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children);
  const placed = useRef<Placement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const started = performance.now();
    let frame = 0;
    const layout = () => {
      frame = 0;
      const kids = [...el.children] as HTMLElement[];
      const width = el.clientWidth;
      const cols = Math.max(1, Math.min(kids.length, Math.floor((width + gap) / (minWidth + gap))));
      const colWidth = (width - gap * (cols - 1)) / cols;
      for (const k of kids) k.style.width = `${colWidth}px`;
      const heights = kids.map((k) => k.offsetHeight);
      let p = placed.current;
      if (!p || p.cols !== cols || p.n !== kids.length || performance.now() - started < SETTLE_MS) p = placed.current = { cols, n: kids.length, order: placeCards(heights, cols, gap) };
      const tops = new Array<number>(cols).fill(0);
      p.order.forEach((col, c) => {
        for (const i of col) {
          const k = kids[i];
          // left/top rather than a transform: a transform would make the cards' menus position against the card
          k.style.left = `${c * (colWidth + gap)}px`;
          k.style.top = `${tops[c]}px`;
          tops[c] += heights[i] ? heights[i] + gap : 0;
        }
      });
      el.style.height = `${Math.max(0, Math.max(...tops) - gap)}px`;
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(layout);
    };
    layout();
    const ro = new ResizeObserver(soon);
    ro.observe(el);
    for (const k of el.children) ro.observe(k);
    // the last look while the page settles, so a section that filled in late is placed by its real height
    const settle = setTimeout(soon, SETTLE_MS + 50);
    return () => {
      ro.disconnect();
      clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items.length, minWidth, gap]);

  return (
    <div ref={ref} className={className ? `masonry ${className}` : 'masonry'}>
      {items.map((child, i) => (
        <div key={(child as { key?: string | null }).key ?? i} className="masonry-item">
          {child}
        </div>
      ))}
    </div>
  );
}
