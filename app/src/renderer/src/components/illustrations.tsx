// Small line illustrations for empty states: one style (rounded cards, dashed links, one accent), drawn with
// currentColor so they follow the theme. Each is a scene, not an icon: what the page will show once it has data.
import type { JSX, SVGProps } from 'react';

export type IlluName = 'send' | 'compare' | 'sync' | 'git' | 'watch' | 'schedule' | 'history' | 'backups' | 'targets' | 'search' | 'inbox';

const common: SVGProps<SVGSVGElement> = { viewBox: '0 0 160 96', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
const A = 'var(--accent)';
const AF = 'rgb(var(--accent-rgb) / 14%)';
const G = 'var(--green)';

function Card({ x, y, w = 40, h = 26, lines = 2 }: { x: number; y: number; w?: number; h?: number; lines?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} opacity={0.9} />
      {Array.from({ length: lines }, (_, i) => (
        <line key={i} x1={x + 7} y1={y + 8 + i * 6} x2={x + w - 7 - (i % 2) * 8} y2={y + 8 + i * 6} opacity={0.45} />
      ))}
    </g>
  );
}

const SCENES: Record<IlluName, () => JSX.Element> = {
  send: () => (
    <>
      <Card x={14} y={35} w={38} h={28} />
      <path d="M58 49 H96" strokeDasharray="3 4" opacity={0.6} />
      <path d="M90 43 L98 49 L90 55" stroke={A} />
      <Card x={104} y={14} w={40} h={22} lines={1} />
      <Card x={104} y={42} w={40} h={22} lines={1} />
      <Card x={104} y={70} w={40} h={22} lines={1} />
      <circle cx={109} cy={19} r={2} fill={G} stroke="none" />
      <circle cx={109} cy={47} r={2} fill={G} stroke="none" />
      <circle cx={109} cy={75} r={2} fill={G} stroke="none" />
    </>
  ),
  compare: () => (
    <>
      <Card x={16} y={22} w={48} h={52} lines={5} />
      <Card x={96} y={22} w={48} h={52} lines={5} />
      <rect x={23} y={40} width={34} height={5} rx={1.5} fill={AF} stroke="none" />
      <rect x={103} y={52} width={34} height={5} rx={1.5} fill={AF} stroke="none" />
      <path d="M70 44 H90 M86 40 L90 44 L86 48" stroke={A} />
      <path d="M90 56 H70 M74 52 L70 56 L74 60" stroke={A} />
    </>
  ),
  sync: () => (
    <>
      <Card x={16} y={30} w={44} h={36} lines={3} />
      <Card x={100} y={30} w={44} h={36} lines={3} />
      <path d="M66 40 C76 30 84 30 94 40" stroke={A} />
      <path d="M90 34 L94 40 L88 42" stroke={A} />
      <path d="M94 58 C84 68 76 68 66 58" stroke={A} />
      <path d="M70 64 L66 58 L72 56" stroke={A} />
    </>
  ),
  git: () => (
    <>
      <path d="M30 78 V18" opacity={0.6} />
      <path d="M30 56 C30 44 62 46 62 36" opacity={0.6} />
      <circle cx={30} cy={18} r={4} fill="var(--bg-elev)" />
      <circle cx={30} cy={56} r={4} fill="var(--bg-elev)" />
      <circle cx={30} cy={78} r={4} fill="var(--bg-elev)" />
      <circle cx={62} cy={36} r={4} fill={A} stroke={A} />
      <path d="M72 36 H98" strokeDasharray="3 4" opacity={0.6} />
      <path d="M94 31 L100 36 L94 41" stroke={A} />
      <Card x={106} y={22} w={38} h={28} />
    </>
  ),
  watch: () => (
    <>
      <path d="M22 60 L34 42 L46 60 Z" opacity={0.7} />
      <rect x={16} y={60} width={36} height={16} rx={3} opacity={0.9} />
      <path d="M34 50 v5" stroke={A} />
      <path d="M58 64 H94" strokeDasharray="3 4" opacity={0.6} />
      <path d="M90 59 L96 64 L90 69" stroke={A} />
      <Card x={104} y={26} w={40} h={22} lines={1} />
      <Card x={104} y={54} w={40} h={22} lines={1} />
      <circle cx={34} cy={28} r={9} stroke={A} fill={AF} />
      <circle cx={34} cy={28} r={3} fill={A} stroke="none" />
    </>
  ),
  schedule: () => (
    <>
      <rect x={22} y={18} width={72} height={60} rx={6} />
      <path d="M22 32 H94" opacity={0.6} />
      {[0, 1, 2, 3, 4].map((c) =>
        [0, 1, 2].map((r) => {
          const hot = c === 2 && r === 1;
          return <rect key={`${c}${r}`} x={30 + c * 12} y={39 + r * 12} width={7} height={7} rx={1.5} opacity={hot ? 1 : 0.35} fill={hot ? A : 'none'} stroke={hot ? A : 'currentColor'} />;
        }),
      )}
      <circle cx={120} cy={48} r={18} />
      <path d="M120 38 V48 L127 53" stroke={A} />
    </>
  ),
  history: () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <g key={i} opacity={1 - i * 0.18}>
          <rect x={26} y={16 + i * 17} width={108} height={12} rx={4} />
          <circle cx={34} cy={22 + i * 17} r={2.5} fill={i === 1 ? 'var(--amber)' : G} stroke="none" />
          <line x1={44} y1={22 + i * 17} x2={84 - i * 6} y2={22 + i * 17} opacity={0.5} />
          <line x1={110} y1={22 + i * 17} x2={126} y2={22 + i * 17} opacity={0.35} />
        </g>
      ))}
    </>
  ),
  backups: () => (
    <>
      <rect x={40} y={46} width={66} height={32} rx={5} />
      <rect x={34} y={36} width={66} height={32} rx={5} fill="var(--bg-elev)" />
      <rect x={28} y={26} width={66} height={32} rx={5} fill="var(--bg-elev)" />
      <line x1={38} y1={38} x2={72} y2={38} opacity={0.5} />
      <line x1={38} y1={46} x2={60} y2={46} opacity={0.4} />
      <path d="M116 42 a14 14 0 1 1 -4 16" stroke={A} />
      <path d="M110 40 L116 42 L116 48" stroke={A} />
    </>
  ),
  targets: () => (
    <>
      <Card x={60} y={10} w={40} h={22} lines={1} />
      <path d="M80 32 V44 M80 44 H36 V56 M80 44 H124 V56 M80 44 V56" opacity={0.6} />
      <Card x={16} y={56} w={40} h={22} lines={1} />
      <Card x={60} y={56} w={40} h={22} lines={1} />
      <Card x={104} y={56} w={40} h={22} lines={1} />
      <circle cx={65} cy={15} r={2} fill={A} stroke="none" />
      <circle cx={21} cy={61} r={2} fill={G} stroke="none" />
      <circle cx={65} cy={61} r={2} fill={G} stroke="none" />
      <circle cx={109} cy={61} r={2} fill="var(--text-3)" stroke="none" />
    </>
  ),
  search: () => (
    <>
      <Card x={18} y={20} w={78} h={56} lines={5} />
      <circle cx={112} cy={50} r={16} stroke={A} fill={AF} />
      <path d="M124 62 L138 76" stroke={A} strokeWidth={2.5} />
    </>
  ),
  inbox: () => (
    <>
      <path d="M26 56 L38 26 H122 L134 56 V74 a4 4 0 0 1 -4 4 H30 a4 4 0 0 1 -4 -4 Z" />
      <path d="M26 56 H60 a10 10 0 0 0 40 0 H134" opacity={0.7} />
      <circle cx={120} cy={26} r={8} fill={A} stroke={A} />
      <path d="M117 26 L119.5 28.5 L124 23.5" stroke="var(--accent-fg)" />
    </>
  ),
};

export function Illustration({ name, width = 168 }: { name: IlluName; width?: number }) {
  const Scene = SCENES[name];
  return (
    <svg {...common} width={width} height={(width * 96) / 160} className="illu">
      <Scene />
    </svg>
  );
}
