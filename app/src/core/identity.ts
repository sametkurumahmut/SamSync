import os from 'node:os';
import { existsSync } from 'node:fs';
import type { AppConfig, LocalIdentity, NodeConfig } from '../shared/types';
import { t } from '../shared/i18n';

export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) out.push(a.address.toLowerCase());
  }
  return out;
}

/**
 * Finds which node of the shared config is this machine, from the most to the least specific rule:
 * explicit override / SAMSYNC_NODE_ID, IP address match, computer name match (address or
 * localNames), and, when a rule matches several nodes, the single one whose local root exists here.
 */
export function detectIdentity(cfg: AppConfig, override?: string, env = process.env): LocalIdentity {
  const hostname = os.hostname();
  const addresses = localAddresses();
  const base = { hostname, addresses };
  const byId = (id: string) => cfg.nodes.find((n) => n.id.toLowerCase() === id.toLowerCase()) ?? null;

  if (override) {
    const n = byId(override);
    if (n) return { ...base, node: n, method: 'override', reason: t('Ayarlarda sabitlendi: {id}', { id: n.id }), candidates: [n.id] };
  }
  const envId = env.SAMSYNC_NODE_ID?.trim();
  if (envId) {
    const n = byId(envId);
    if (n) return { ...base, node: n, method: 'env', reason: `SAMSYNC_NODE_ID=${envId}`, candidates: [n.id] };
  }

  const pick = (matches: NodeConfig[], method: LocalIdentity['method'], what: string): LocalIdentity | null => {
    if (matches.length === 1) return { ...base, node: matches[0], method, reason: what, candidates: [matches[0].id] };
    if (matches.length > 1) {
      const withRoot = matches.filter((n) => n.localRoots.some((r) => existsSync(r)));
      if (withRoot.length === 1)
        return { ...base, node: withRoot[0], method: 'root', reason: t('{rule}; yerel kökü bu makinede olan tek node', { rule: what }), candidates: matches.map((n) => n.id) };
      return { ...base, node: null, method: 'ambiguous', reason: t('{rule} birden çok node ile eşleşti: {ids}', { rule: what, ids: matches.map((n) => n.id).join(', ') }), candidates: matches.map((n) => n.id) };
    }
    return null;
  };

  const ipMatches = cfg.nodes.filter((n) => addresses.includes(n.address.toLowerCase()));
  const ip = pick(ipMatches, 'ip', t('IP adresi eşleşti ({address})', { address: ipMatches[0]?.address ?? '' }));
  if (ip) return ip;

  const host = hostname.toLowerCase();
  const nameMatches = cfg.nodes.filter(
    (n) => n.address.toLowerCase() === host || (n.localNames ?? []).some((x) => x.toLowerCase() === host),
  );
  const nm = pick(nameMatches, 'name', t('Bilgisayar adı eşleşti ({host})', { host: hostname }));
  if (nm) return nm;

  return { ...base, node: null, method: 'none', reason: t('Bu makine ({host}) yapılandırmadaki hiçbir node ile eşleşmedi.', { host: hostname }), candidates: [] };
}
