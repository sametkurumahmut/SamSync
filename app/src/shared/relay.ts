// Relay: a machine that passes a send on to the other machines of its group. The sender reaches only the
// relay (one copy over its own, often slow, link); SamSync on the relay sends the files on from its local
// disk over the group's own network. The two sides talk through job files in a folder on the relay's share.
import type { NodeConfig, SendOptions } from './types';

/** Folder under the relay's share root that holds the job and result files; never sent, never mirrored away. */
export const RELAY_FOLDER = '_SamSyncRelay';

export interface RelaySource {
  /** Path relative to the share root, as the sender's plan mapped it. */
  rel: string;
  kind: 'fs' | 'delete';
}

/** One operation the relay applies to its own disk from the pack. */
export type PackOp =
  | { kind: 'copy'; id: string; rel: string; size: number; mtimeMs: number; offset: number; length: number; method: 'gzip' | 'store'; replaceType?: boolean; dstExists?: boolean }
  | { kind: 'mkdir'; id: string; rel: string; replaceType?: boolean; dstExists?: boolean }
  | { kind: 'delete'; id: string; rel: string; isDir: boolean };

export interface RelayJob {
  id: string;
  createdAt: number;
  /** The sender's run label, shown on the relay as "Röle: …". */
  label: string;
  /** Node id of the sender (for the relay's log). */
  from?: string;
  sources: RelaySource[];
  /** Machines the relay sends on to (none: the relay only takes the pack for itself). */
  targetIds: string[];
  options: SendOptions;
  /**
   * The sender's changes for the relay itself, compressed into `<id>.pack` next to the job instead of
   * copied one by one: the relay applies them to its disk first, then sends on.
   */
  pack?: {
    ops: PackOp[];
    backup: boolean;
    verify: boolean;
    /** The sent folders (relative to the root): the relay writes its manifest for them after applying. */
    subtrees?: string[];
  };
}

export interface RelayTargetResult {
  targetId: string;
  /** deferred: the machine was off; the relay queued the job for it. */
  status: 'ok' | 'partial' | 'failed' | 'cancelled' | 'deferred';
  opsOk: number;
  opsFailed: number;
  bytes: number;
  error?: string;
  /** For the relay's own apply of a pack: the ids of the operations that failed, and where the old files went. */
  failedOps?: string[];
  backupPath?: string;
}

export interface RelayResult {
  id: string;
  finishedAt: number;
  targets: RelayTargetResult[];
}

export interface RelayRouting {
  /** Machines the sender writes to itself. */
  direct: NodeConfig[];
  /** relay node id -> the machines of its group that get the files from it. */
  via: Map<string, NodeConfig[]>;
}

/**
 * Splits the chosen machines: a relay that is among them takes over the other chosen machines of its group.
 * A machine is relayed only when its relay was chosen too, so a send to one IG alone never touches the relay.
 */
export function relayRouting(nodes: NodeConfig[]): RelayRouting {
  const direct: NodeConfig[] = [];
  const via = new Map<string, NodeConfig[]>();
  const relays = nodes.filter((n) => n.relay && n.group && n.transport !== 'sftp');
  for (const n of nodes) {
    const relay = n.relay ? undefined : relays.find((r) => r.group!.toLowerCase() === (n.group ?? '').toLowerCase() && r.id !== n.id);
    if (relay) via.set(relay.id, [...(via.get(relay.id) ?? []), n]);
    else direct.push(n);
  }
  return { direct, via };
}
