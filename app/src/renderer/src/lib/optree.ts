// The review as a folder tree: the operations grouped by folder, with counts per folder, folded and
// unfolded by the user. A chain of folders with one child and nothing of their own is shown as one
// node ("SimFrameworkModels/ModelHeavyIndustry"), as code editors do.
// a relative path, not the @shared alias: the tests compile this file with the node config too
import type { PlanOp } from '../../../shared/types';

export interface OpCounts {
  new: number;
  changed: number;
  targetNewer: number;
  remove: number;
  ops: number;
  bytes: number;
}

export interface TreeNode {
  /** Path of this folder ('' for the root). */
  path: string;
  /** What the row shows: the folder's name, or a chain of names when folders were merged. */
  label: string;
  depth: number;
  folders: TreeNode[];
  /** Operations directly in this folder (files, and the folder's own mkdir/delete). */
  ops: PlanOp[];
  counts: OpCounts;
  /** Every operation below this node, for selecting the whole branch. */
  all: PlanOp[];
}

export type TreeRow = { kind: 'folder'; node: TreeNode } | { kind: 'op'; op: PlanOp; depth: number };

function emptyCounts(): OpCounts {
  return { new: 0, changed: 0, targetNewer: 0, remove: 0, ops: 0, bytes: 0 };
}

function count(c: OpCounts, op: PlanOp): void {
  c.ops++;
  if (op.kind === 'delete') c.remove++;
  else if (op.category === 'new') c.new++;
  else if (op.category === 'targetNewer') c.targetNewer++;
  else c.changed++;
  if (op.kind === 'copy') c.bytes += op.size;
}

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const nameOf = (rel: string) => (rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel);

/** Builds the tree of the given operations; folders come from the operations' paths. */
export function buildOpTree(ops: PlanOp[]): TreeNode {
  const nodes = new Map<string, TreeNode>();
  const node = (path: string): TreeNode => {
    let n = nodes.get(path);
    if (n) return n;
    n = { path, label: nameOf(path), depth: 0, folders: [], ops: [], counts: emptyCounts(), all: [] };
    nodes.set(path, n);
    if (path) node(parentOf(path)).folders.push(n);
    return n;
  };
  const root = node('');
  for (const op of ops) {
    // a folder's own operation (mkdir, delete of a folder) sits in its parent, like a file would
    const home = node(parentOf(op.rel));
    home.ops.push(op);
  }
  // counts and the "all" lists, bottom up
  const fill = (n: TreeNode): void => {
    for (const f of n.folders) fill(f);
    n.folders.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    n.ops.sort((a, b) => Number(!a.isDir) - Number(!b.isDir) || a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base' }));
    for (const op of n.ops) {
      count(n.counts, op);
      n.all.push(op);
    }
    for (const f of n.folders) {
      n.counts.new += f.counts.new;
      n.counts.changed += f.counts.changed;
      n.counts.targetNewer += f.counts.targetNewer;
      n.counts.remove += f.counts.remove;
      n.counts.ops += f.counts.ops;
      n.counts.bytes += f.counts.bytes;
      n.all.push(...f.all);
    }
  };
  fill(root);
  // merge chains: a folder with one child folder and no operations of its own shows as one node
  const compact = (n: TreeNode, depth: number): TreeNode => {
    let cur = n;
    const labels = [cur.label];
    while (cur.folders.length === 1 && cur.ops.length === 0 && cur !== root) {
      cur = cur.folders[0];
      labels.push(cur.label);
    }
    const out: TreeNode = { ...cur, label: labels.join('/'), depth, folders: cur.folders.map((f) => compact(f, depth + 1)) };
    return out;
  };
  return compact(root, 0);
}

/** The rows to draw: folded folders show only their own row. */
export function flattenTree(root: TreeNode, expanded: (path: string) => boolean): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (n: TreeNode) => {
    for (const f of n.folders) {
      rows.push({ kind: 'folder', node: f });
      if (expanded(f.path)) walk(f);
    }
    for (const op of n.ops) rows.push({ kind: 'op', op, depth: n.depth + (n.path ? 1 : 0) });
  };
  walk(root);
  return rows;
}

/** Every folder path in the tree (to unfold or fold them all). */
export function allFolders(root: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    for (const f of n.folders) {
      out.push(f.path);
      walk(f);
    }
  };
  walk(root);
  return out;
}

/** Folders worth unfolding at first: the first level, and below it as long as a folder is the only one there. */
export function defaultExpanded(root: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode, open: boolean) => {
    for (const f of n.folders) {
      if (!open) continue;
      out.push(f.path);
      walk(f, n.folders.length === 1);
    }
  };
  walk(root, true);
  return out;
}
