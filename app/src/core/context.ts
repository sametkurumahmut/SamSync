import type { AppConfig, AppEvent, NodeConfig, RunLogLine } from '../shared/types';
import type { Logger } from './logger';
import type { HashCache } from './hashcache';

export interface CoreContext {
  config: AppConfig;
  /** The app's version, written into locks and manifests. */
  appVersion?: string;
  /** Local roots of the node this machine was identified as. */
  localRoots: string[];
  localNodeId?: string;
  userDataPath: string;
  getSecret?: (nodeId: string) => Promise<string | undefined>;
  /** Moves a local file or folder to the operating system's trash; without it the versioning folder is used. */
  trash?: (absPath: string) => Promise<void>;
  /** The last reachability check of a machine (the window's periodic one), so a plan can skip its own. */
  recentProbe?: (nodeId: string) => { ok: boolean; checkedAt: number } | undefined;
  /** Content hashes by (place, path, size, time): comparisons and copies fill it, comparisons use it. */
  hashCache?: HashCache;
  /** Where a run's log lines go as they come (a file per run), so a big run keeps only its tail in memory. */
  runLog?: (runId: string) => RunLogWriter;
  emit: (e: AppEvent) => void;
  log: Logger;
}

export interface RunLogWriter {
  write(lines: RunLogLine[]): void;
  /** Resolves once every line is on disk. */
  close(): Promise<void>;
}

export function findNode(cfg: AppConfig, id: string): NodeConfig | undefined {
  return cfg.nodes.find((n) => n.id.toLowerCase() === id.toLowerCase());
}

/** Expands target ids: node ids, "group:<name>", "profile:<name>" and "all". */
export function expandTargetIds(cfg: AppConfig, ids: string[], localNodeId?: string): NodeConfig[] {
  const out: NodeConfig[] = [];
  const add = (n?: NodeConfig) => {
    if (n && n.enabled && n.id !== localNodeId && !out.includes(n)) out.push(n);
  };
  for (const raw of ids) {
    const id = raw.trim();
    if (id.toLowerCase() === 'all') cfg.nodes.forEach(add);
    else if (id.toLowerCase().startsWith('group:')) {
      const g = id.slice(6).toLowerCase();
      cfg.nodes.filter((n) => n.group?.toLowerCase() === g).forEach(add);
    } else if (id.toLowerCase().startsWith('tag:')) {
      const tag = id.slice(4).toLowerCase();
      cfg.nodes.filter((n) => n.tags?.some((x) => x.toLowerCase() === tag)).forEach(add);
    } else if (id.toLowerCase().startsWith('profile:')) {
      const p = cfg.profiles.find((x) => x.name.toLowerCase() === id.slice(8).toLowerCase() || x.id === id.slice(8));
      p?.targetIds.forEach((t) => add(findNode(cfg, t)));
    } else add(findNode(cfg, id));
  }
  return out;
}
