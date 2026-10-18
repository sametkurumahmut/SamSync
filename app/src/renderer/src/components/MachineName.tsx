// One way of writing a machine everywhere: the short name, and the address under it (stack) or after it (inline)
// in a smaller monospace. Lists, cards, the network view and run rows all use it, so a machine looks the same on
// every page and long names no longer get cut off at the address.
import type { ReactNode } from 'react';
import type { NodeConfig } from '@shared/types';
import { machineLabel } from '@shared/machine';
import { cls } from '../lib/format';

export function MachineName({
  node,
  name,
  address,
  layout = 'stack',
  size,
  extra,
  sub,
  className,
  hideAddress,
}: {
  node?: Pick<NodeConfig, 'name' | 'address'>;
  /** A name alone (a run's target title), split heuristically. */
  name?: string;
  address?: string;
  layout?: 'stack' | 'inline';
  size?: 'sm' | 'lg';
  /** Badges after the title. */
  extra?: ReactNode;
  /** What follows the address on the second line (latency, root); replaces the address when there is none. */
  sub?: ReactNode;
  className?: string;
  /** Leave the address out of the second line (it stays in the tooltip). */
  hideAddress?: boolean;
}) {
  const label = machineLabel(node?.name ?? name ?? '', node?.address ?? address);
  const l = hideAddress ? { ...label, sub: undefined } : label;
  const full = node ? `${node.name}${node.address && !node.name.includes(node.address) ? ` (${node.address})` : ''}` : name;
  return (
    <span className={cls('mname', layout, size, className)} title={full}>
      <span className="mname-title">
        <span className="ellipsis">{l.title}</span>
        {extra}
      </span>
      {(l.sub || sub) && (
        <span className="mname-sub">
          {l.sub && <span className="mono mname-addr">{l.sub}</span>}
          {l.sub && sub ? <span className="mname-sep">•</span> : null}
          {sub}
        </span>
      )}
    </span>
  );
}
