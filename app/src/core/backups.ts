import type { BackupLookup, BackupVersion, BackupSet } from '../shared/types';
import type { CoreContext } from './context';
import { findNode } from './context';
import { transportForNode, nodeRootLabel, type Entry } from './transport';
import type { ExecGroup, ExecOp } from './executor';
import { scanTree } from './scan';
import { probeNode } from './probe';
import { relBase, relJoin } from './paths';
import { errMessage, mapLimit, parseStamp } from './util';
import { t } from '../shared/i18n';

/** Every target's backups of one item (rel), newest first, plus what the target holds now. */
export async function findBackups(ctx: CoreContext, rel: string, targetIds: string[]): Promise<BackupLookup[]> {
  const folder = ctx.config.copy.backupFolderName;
  return mapLimit(targetIds, 8, async (id) => {
    const node = findNode(ctx.config, id);
    const base: BackupLookup = { targetId: id, targetName: node?.name ?? id, reachable: false, rel, versions: [] };
    if (!node) return { ...base, error: t('Hedef bulunamadı') };
    const probe = await probeNode(ctx.config, node);
    if (!probe.ok) return { ...base, error: probe.detail };
    const tgt = await transportForNode(ctx, node);
    try {
      const stamps = (await tgt.list(folder)).filter((e) => e.isDir && parseStamp(relBase(e.rel)) != null);
      const versions = (
        await mapLimit(stamps, 8, async (s): Promise<BackupVersion | null> => {
          const st = await tgt.stat(relJoin(s.rel, rel));
          if (!st) return null;
          return { stamp: relBase(s.rel), date: parseStamp(relBase(s.rel))!, size: st.size, isDir: st.isDir };
        })
      ).filter((v): v is BackupVersion => !!v);
      versions.sort((a, b) => b.date - a.date);
      const cur = await tgt.stat(rel);
      return { ...base, reachable: true, versions, current: cur ? { size: cur.size, mtimeMs: cur.mtimeMs, isDir: cur.isDir } : null };
    } catch (e) {
      return { ...base, error: errMessage(e) };
    } finally {
      await tgt.close();
    }
  });
}

export async function listBackupSets(ctx: CoreContext, targetIds: string[]): Promise<BackupSet[]> {
  const folder = ctx.config.copy.backupFolderName;
  return mapLimit(targetIds, 8, async (id) => {
    const node = findNode(ctx.config, id);
    if (!node) return { targetId: id, stamps: [] };
    const probe = await probeNode(ctx.config, node);
    if (!probe.ok) return { targetId: id, stamps: [] };
    const tgt = await transportForNode(ctx, node);
    try {
      const stamps = (await tgt.list(folder))
        .filter((e) => e.isDir && parseStamp(relBase(e.rel)) != null)
        .map((e) => ({ stamp: relBase(e.rel), date: parseStamp(relBase(e.rel))! }))
        .sort((a, b) => b.date - a.date);
      return { targetId: id, stamps };
    } catch {
      return { targetId: id, stamps: [] };
    } finally {
      await tgt.close();
    }
  });
}

export async function browseBackup(ctx: CoreContext, targetId: string, stamp: string, relDir: string): Promise<Entry[]> {
  const node = findNode(ctx.config, targetId);
  if (!node) throw new Error(t('Hedef bulunamadı'));
  const tgt = await transportForNode(ctx, node);
  try {
    const base = relJoin(ctx.config.copy.backupFolderName, stamp);
    const list = await tgt.list(relJoin(base, relDir));
    return list.map((e) => ({ ...e, rel: e.rel.slice(base.length + 1) })).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.rel.localeCompare(b.rel));
  } finally {
    await tgt.close();
  }
}

/** Executor groups that write a backup version back over the live item (files are expanded for folders). */
export async function restoreGroups(ctx: CoreContext, rel: string, picks: { targetId: string; stamp: string }[]): Promise<ExecGroup[]> {
  const groups: ExecGroup[] = [];
  for (const p of picks) {
    const node = findNode(ctx.config, p.targetId);
    if (!node) continue;
    const open = () => transportForNode(ctx, node);
    const from = relJoin(ctx.config.copy.backupFolderName, p.stamp, rel);
    const tgt = await open();
    const ops: ExecOp[] = [];
    try {
      const st = await tgt.stat(from);
      if (!st) continue;
      if (!st.isDir) {
        ops.push({ id: '0', kind: 'copy', rel, isDir: false, size: st.size, mtimeMs: st.mtimeMs, src: { kind: 'endpoint', key: 'self', rel: from } });
      } else {
        ops.push({ id: 'd', kind: 'mkdir', rel, isDir: true, size: 0 });
        const scan = await scanTree(tgt, from, { caseInsensitive: tgt.caseInsensitive });
        let i = 0;
        for (const e of scan.entries.values()) {
          const target = relJoin(rel, e.rel);
          if (e.isDir) ops.push({ id: String(i++), kind: 'mkdir', rel: target, isDir: true, size: 0 });
          else ops.push({ id: String(i++), kind: 'copy', rel: target, isDir: false, size: e.size, mtimeMs: e.mtimeMs, src: { kind: 'endpoint', key: 'self', rel: relJoin(from, e.rel) } });
        }
      }
    } finally {
      await tgt.close();
    }
    groups.push({ key: node.id, title: node.name, rootLabel: nodeRootLabel(ctx.config, node), open, ops, node, endpoints: { self: open } });
  }
  return groups;
}
