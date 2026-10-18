// Small inline charts, drawn as SVG so they follow the theme (currentColor and the CSS variables).
import type { CSSProperties } from 'react';

/** A line with the area under it, for a series over time (throughput, bytes per day). */
export function Sparkline({
  values,
  height = 56,
  max,
  color = 'var(--accent)',
  className,
  style,
  baseline = true,
}: {
  values: number[];
  height?: number;
  /** Top of the scale; defaults to the largest value. */
  max?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
  baseline?: boolean;
}) {
  const w = 100;
  const h = height;
  const top = Math.max(max ?? 0, ...values, 1e-9);
  const n = values.length;
  const pad = 1.5;
  const pts = values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, h - pad - (Math.max(0, v) / top) * (h - 2 * pad)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = n ? `${line} L${pts[n - 1][0].toFixed(2)},${h} L${pts[0][0].toFixed(2)},${h} Z` : '';
  return (
    <svg className={className} style={{ width: '100%', height, display: 'block', ...style }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {baseline && <line x1={0} y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {n > 1 && <path d={area} fill={color} opacity={0.14} />}
      {n > 0 && <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {n > 0 && <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r={2.2} fill={color} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Latency over the last probes, 56×16: a line through the answers, a red tick for every missed one. */
export function LatencySpark({ values, width = 56, height = 16, title }: { values: number[]; width?: number; height?: number; title?: string }) {
  const n = values.length;
  const ok = values.filter((v) => v >= 0);
  const top = Math.max(1, ...ok);
  const pad = 2;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i / (n - 1)) * (width - 2 * pad));
  const y = (v: number) => height - pad - (v / top) * (height - 2 * pad);
  let d = '';
  let open = false;
  values.forEach((v, i) => {
    if (v < 0) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    open = true;
  });
  return (
    <svg className="lat-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {title && <title>{title}</title>}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (v < 0 ? <line key={i} x1={x(i)} y1={height - pad} x2={x(i)} y2={height - pad - 5} stroke="var(--red)" strokeWidth={1.5} /> : null))}
    </svg>
  );
}

/** Vertical bars for buckets (per day, per hour); `tone` colours a bar differently (a day with failures). */
export function Bars({
  values,
  height = 48,
  max,
  tone,
  color = 'var(--accent)',
  gap = 2,
  titles,
  className,
  onPick,
}: {
  values: number[];
  height?: number;
  max?: number;
  tone?: (i: number) => string | undefined;
  color?: string;
  gap?: number;
  titles?: string[];
  className?: string;
  onPick?: (i: number) => void;
}) {
  const n = values.length;
  const top = Math.max(max ?? 0, ...values, 1e-9);
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'flex-end', gap, height, width: '100%' }}>
      {values.map((v, i) => {
        const hh = Math.max(v > 0 ? 2 : 1, (Math.max(0, v) / top) * height);
        return (
          <div
            key={i}
            title={titles?.[i]}
            onClick={onPick ? () => onPick(i) : undefined}
            style={{ flex: 1, minWidth: 2, height: hh, borderRadius: 2, background: v > 0 ? (tone?.(i) ?? color) : 'var(--border)', opacity: v > 0 ? 0.9 : 0.6, cursor: onPick ? 'pointer' : undefined }}
          />
        );
      })}
      {n === 0 && <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />}
    </div>
  );
}
