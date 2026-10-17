import type { AppConfig, NodeConfig, Endpoint } from '../../shared/types';
import type { Transport } from './types';
import { FsTransport } from './fs';
import { SftpTransport, expandHome } from './sftp';
import { joinRoot, toPosix } from '../paths';
import { t } from '../../shared/i18n';

export type { Transport, Entry } from './types';
export { FsTransport, InUseError } from './fs';
export { SftpTransport } from './sftp';

const DEFAULT_TEMPLATES: Record<string, string> = {
  win32: '\\\\{address}\\{networkRoot}',
  darwin: '/Volumes/{share}/{rest}',
  linux: '/mnt/{address}/{networkRoot}',
};

/** Where an SMB target lives for this OS: \\10.10.1.11\Share\Release on Windows, a mount elsewhere. */
export function smbRoot(cfg: AppConfig, node: NodeConfig, platform = process.platform): string {
  if (node.path) return node.path;
  const tpl = cfg.smbPathTemplate?.[platform as 'win32'] || DEFAULT_TEMPLATES[platform] || DEFAULT_TEMPLATES.linux;
  const nr = node.networkRoot.replace(/[\\/]+/g, '/');
  const [share, ...rest] = nr.split('/');
  const sep = platform === 'win32' ? '\\' : '/';
  const out = tpl
    .replace(/\{address\}/g, node.address)
    .replace(/\{networkRoot\}/g, nr.split('/').join(sep))
    .replace(/\{share\}/g, share)
    .replace(/\{rest\}/g, rest.join(sep))
    .replace(/\{id\}/g, node.id);
  return out.replace(/[\\/]+$/, '');
}

export function nodeRootLabel(cfg: AppConfig, node: NodeConfig): string {
  if (node.transport === 'sftp' && node.sftp) {
    const host = node.sftp.host || node.address;
    return `sftp://${node.sftp.username}@${host}${node.sftp.port && node.sftp.port !== 22 ? ':' + node.sftp.port : ''}/${toPosix(node.sftp.root).replace(/^\/+/, '')}`;
  }
  if (node.transport === 'path') return node.path ?? '';
  return smbRoot(cfg, node);
}

export interface TransportContext {
  config: AppConfig;
  getSecret?: (nodeId: string) => Promise<string | undefined>;
  /** This machine's node and its local roots: writing to itself goes to the disk, not over its own share. */
  localNodeId?: string;
  localRoots?: string[];
}

export async function transportForNode(ctx: TransportContext, node: NodeConfig, subPath = ''): Promise<Transport> {
  if (ctx.localNodeId && node.id === ctx.localNodeId && node.transport !== 'sftp' && ctx.localRoots?.[0]) {
    const base = ctx.localRoots[0];
    return new FsTransport(subPath ? joinRoot(base, toPosix(subPath).replace(/^\/+|\/+$/g, '')) : base);
  }
  if (node.transport === 'sftp') {
    if (!node.sftp) throw new Error(t('{id}: SFTP ayarları eksik.', { id: node.id }));
    const root = subPath ? `${node.sftp.root.replace(/\/+$/, '')}/${toPosix(subPath).replace(/^\/+/, '')}` : node.sftp.root;
    return new SftpTransport({
      host: node.sftp.host || node.address,
      port: node.sftp.port,
      username: node.sftp.username,
      root,
      privateKeyPath: node.sftp.privateKeyPath ? expandHome(node.sftp.privateKeyPath) : undefined,
      useAgent: node.sftp.useAgent,
      password: await ctx.getSecret?.(node.id),
    });
  }
  const base = node.transport === 'path' ? node.path ?? '' : smbRoot(ctx.config, node);
  return new FsTransport(subPath ? joinRoot(base, toPosix(subPath).replace(/^\/+|\/+$/g, '')) : base);
}

export async function transportForEndpoint(ctx: TransportContext, ep: Endpoint): Promise<Transport> {
  if (ep.kind === 'local') return new FsTransport(ep.path);
  const node = ctx.config.nodes.find((n) => n.id === ep.nodeId);
  if (!node) throw new Error(t('Hedef bulunamadı: {id}', { id: ep.nodeId }));
  return transportForNode(ctx, node, ep.subPath);
}

export function endpointLabel(cfg: AppConfig, ep: Endpoint): string {
  if (ep.kind === 'local') return ep.path;
  const node = cfg.nodes.find((n) => n.id === ep.nodeId);
  if (!node) return `? ${ep.nodeId}`;
  const root = nodeRootLabel(cfg, node);
  return ep.subPath ? joinRoot(root, toPosix(ep.subPath).replace(/^\/+|\/+$/g, '')) : root;
}
