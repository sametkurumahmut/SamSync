import type { BackupLookup, BackupVersion, BackupSet } from '../shared/types';
import type { CoreContext } from './context';
import { findNode } from './context';
import { transportForNode, nodeRootLabel, type Entry, type Transport } from './transport';
import type { ExecGroup, ExecOp } from './executor';
import { scanTree } from './scan';
import { probeNode } from './probe';
import { relBase, relJoin } from './paths';
import { errMessage, mapLimit, parseStamp } from './util';
import { t } from '../shared/i18n';

/** Files Windows and macOS leave in any folder; they do not make a folder anything other than a backup folder. */
const LITTER = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

/**
 * Backup folders at the root of a transport other than the configured one: a top level folder whose name starts
 * with "_" and that holds nothing but yyyyMMdd-HHmmss folders. The PowerShell tool kept its backups in such a
 * folder under its own name; mirror sends and folder syncs leave these alone and the Backups page lists them.
 */
export async function otherBackupRoots(tport: Transport, configured: string): Promise<string[]> {
  let top: Entry[];
  try {
    top = await tport.list('');
  } catch {
    return [];
  }
  const own = configured.toLowerCase();
  const candidates = top.filter((e) => e.isDir && e.rel.startsWith('_') && e.rel.toLowerCase() !== own);
  const found = await mapLimit(candidates, 8, async (e) => {
    try {
      const children = await tport.list(e.rel);
      const dirs = children.filter((c) => c.isDir);
      const onlyStamps = dirs.length > 0 && dirs.every((c) => parseStamp(relBase(c.rel)) != null);
      return onlyStamps && children.every((c) => c.isDir || LITTER.has(relBase(c.rel).toLowerCase())) ? e.rel : null;
    } catch {
      return null;
    }
  });
  return found.filter((x): x is string => !!x).sort((a, b) => a.localeCompare(b));
}

/** The configured backup folder first, then the older ones found at the root. */
async function backupRoots(tport: Transport, configured: string): Promise<string[]> {
  return [configured, ...(await otherBackupRoots(tport, configured))];
}

/** A backup folder name from the renderer: one path segment, nothing that climbs out of the target root. */
function safeFolder(folder: string | undefined, configured: string): string {
  if (!folder) return configured;
  if (/[\\/]/.test(folder) || folder === '.' || folder === '..') throw new Error(t('Geçersiz yedek klasörü: {folder}', { folder }));
  return folder;
}

function safeStamp(stamp: string): string {
  if (parseStamp(stamp) == null) throw new Error(t('Geçersiz yedek tarihi: {stamp}', { stamp }));
  return stamp;
}

async function stampsIn(tgt: Transport, folder: string): Promise<{ stamp: string; date: number; folder: string }[]> {
  const list = await tgt.list(folder).catch(() => [] as Entry[]);
  return list.filter((e) => e.isDir && parseStamp(relBase(e.rel)) != null).map((e) => ({ stamp: relBase(e.rel), date: parseStamp(relBase(e.rel))!, folder }));
}

/** Every target's backups of one item (rel), newest first, plus what the target holds now. */
export async function findBackups(ctx: CoreContext, rel: string, targetIds: string[]): Promise<BackupLookup[]> {
  const configured = ctx.config.copy.backupFolderName;
  return mapLimit(targetIds, 8, async (id) => {
    const node = findNode(ctx.config, id);
    const base: BackupLookup = { targetId: id, targetName: node?.name ?? id, reachable: false, rel, versions: [] };
    if (!node) return { ...base, error: t('Hedef bulunamadı') };
    const probe = await probeNode(ctx.config, node);
    if (!probe.ok) return { ...base, error: probe.detail };
    const tgt = await transportForNode(ctx, node);
    try {
      const stamps = (await mapLimit(await backupRoots(tgt, configured), 4, (f) => stampsIn(tgt, f))).flat();
      const versions = (
        await mapLimit(stamps, 8, async (s): Promise<BackupVersion | null> => {
          const st = await tgt.stat(relJoin(s.folder, s.stamp, rel));
          if (!st) return null;
          return { stamp: s.stamp, folder: s.folder, date: s.date, size: st.size, isDir: st.isDir };
        })
      ).filter((v): v is BackupVersion => !!v);
      versions.sort((a, b) => b.date - a.date || Number(a.folder !== configured) - Number(b.folder !== configured));
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
  const configured = ctx.config.copy.backupFolderName;
  return mapLimit(targetIds, 8, async (id) => {
    const node = findNode(ctx.config, id);
    if (!node) return { targetId: id, stamps: [] };
    const probe = await probeNode(ctx.config, node);
    if (!probe.ok) return { targetId: id, stamps: [] };
    const tgt = await transportForNode(ctx, node);
    try {
      const stamps = (await mapLimit(await backupRoots(tgt, configured), 4, (f) => stampsIn(tgt, f))).flat().sort((a, b) => b.date - a.date);
      return { targetId: id, stamps };
    } catch {
      return { targetId: id, stamps: [] };
    } finally {
      await tgt.close();
    }
  });
}

export async function browseBackup(ctx: CoreContext, targetId: string, stamp: string, relDir: string, folder?: string): Promise<Entry[]> {
  const node = findNode(ctx.config, targetId);
  if (!node) throw new Error(t('Hedef bulunamadı'));
  const tgt = await transportForNode(ctx, node);
  try {
    const base = relJoin(safeFolder(folder, ctx.config.copy.backupFolderName), safeStamp(stamp));
    const list = await tgt.list(relJoin(base, relDir));
    return list.map((e) => ({ ...e, rel: e.rel.slice(base.length + 1) })).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.rel.localeCompare(b.rel));
  } finally {
    await tgt.close();
  }
}

/** Executor groups that write a backup version back over the live item (files are expanded for folders). */
export async function restoreGroups(ctx: CoreContext, rel: string, picks: { targetId: string; stamp: string; folder?: string }[]): Promise<ExecGroup[]> {
  const groups: ExecGroup[] = [];
  for (const p of picks) {
    const node = findNode(ctx.config, p.targetId);
    if (!node) continue;
    const open = () => transportForNode(ctx, node);
    const from = relJoin(safeFolder(p.folder, ctx.config.copy.backupFolderName), safeStamp(p.stamp), rel);
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
