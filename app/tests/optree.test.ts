import { describe, it, expect } from 'vitest';
import type { PlanOp } from '../src/shared/types';
import { allFolders, buildOpTree, defaultExpanded, flattenTree } from '../src/renderer/src/lib/optree';

const op = (rel: string, extra: Partial<PlanOp> = {}): PlanOp => ({ id: rel, kind: 'copy', rel, isDir: false, category: 'new', size: 10, selected: true, sourceIndex: 0, ...extra });

describe('review tree', () => {
  const ops = [
    op('Models/Vehicle/Vehicle.dll', { category: 'changed', size: 6_000_000 }),
    op('Models/Vehicle/Vehicle.pdb', { category: 'changed', size: 50_000_000 }),
    op('Data/Configuration/a.xml'),
    op('Data/Configuration/b.xml', { category: 'targetNewer' }),
    op('Data/old.txt', { kind: 'delete', category: 'extra', size: 0, dstSize: 5 }),
    op('Data/NewFolder', { kind: 'mkdir', isDir: true, size: 0 }),
    op('root.txt'),
  ];

  it('groups operations by folder, merges single-child chains and counts per branch', () => {
    const root = buildOpTree(ops);
    expect(root.folders.map((f) => f.label)).toEqual(['Data', 'Models/Vehicle']);
    const sim = root.folders[1];
    expect(sim.path).toBe('Models/Vehicle');
    expect(sim.counts).toMatchObject({ changed: 2, ops: 2, bytes: 56_000_000 });
    const data = root.folders[0];
    expect(data.counts).toMatchObject({ new: 2, targetNewer: 1, remove: 1, ops: 4 });
    // the folder's own mkdir sits in its parent, before the files
    expect(data.ops.map((o) => o.rel)).toEqual(['Data/NewFolder', 'Data/old.txt']);
    expect(data.folders[0].label).toBe('Configuration');
    expect(root.ops.map((o) => o.rel)).toEqual(['root.txt']);
    expect(root.counts.ops).toBe(7);
  });

  it('flattens only the unfolded folders and unfolds the first level by default', () => {
    const root = buildOpTree(ops);
    expect(defaultExpanded(root)).toEqual(['Data', 'Models/Vehicle']);
    const open = new Set(defaultExpanded(root));
    const rows = flattenTree(root, (p) => open.has(p));
    expect(rows.map((r) => (r.kind === 'folder' ? `[${r.node.label}]` : r.op.rel))).toEqual([
      '[Data]',
      '[Configuration]',
      'Data/NewFolder',
      'Data/old.txt',
      '[Models/Vehicle]',
      'Models/Vehicle/Vehicle.dll',
      'Models/Vehicle/Vehicle.pdb',
      'root.txt',
    ]);
    const everything = new Set(allFolders(root));
    expect(everything).toEqual(new Set(['Data', 'Data/Configuration', 'Models/Vehicle']));
    expect(flattenTree(root, () => true).filter((r) => r.kind === 'op')).toHaveLength(7);
    expect(flattenTree(root, () => false).map((r) => r.kind)).toEqual(['folder', 'folder', 'op']);
  });
});
