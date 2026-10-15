import type { AppConfig, AppEvent, NodeConfig } from '../shared/types';
import type { Logger } from './logger';

export interface CoreContext {
  config: AppConfig;
  /** Local roots of the node this machine was identified as. */
  localRoots: string[];
  localNodeId?: string;
  userDataPath: string;
  getSecret?: (nodeId: string) => Promise<string | undefined>;
  emit: (e: AppEvent) => void;
  log: Logger;
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
    } else if (id.toLowerCase().startsWith('profile:')) {
      const p = cfg.profiles.find((x) => x.name.toLowerCase() === id.slice(8).toLowerCase() || x.id === id.slice(8));
      p?.targetIds.forEach((t) => add(findNode(cfg, t)));
    } else add(findNode(cfg, id));
  }
  return out;
}
