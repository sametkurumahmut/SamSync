import { Fragment, type ReactNode } from 'react';
import { t, type Params } from '@shared/i18n';

/** t() for a sentence with React elements in it: each {name} whose value is in nodes becomes that node. */
export function tx(key: string, nodes: Record<string, ReactNode>, params?: Params): ReactNode {
  return t(key, params)
    .split(/\{(\w+)\}/g)
    .map((part, i) => (i % 2 ? <Fragment key={i}>{part in nodes ? nodes[part] : `{${part}}`}</Fragment> : part));
}
