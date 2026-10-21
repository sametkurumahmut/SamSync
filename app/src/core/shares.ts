// The folders this Windows machine shares, from the registry (readable without admin rights). An agent checks
// with them that its first local root is the folder senders reach through its share: when it is not, senders
// write their jobs where SamSync here never looks, and the machine looks as if SamSync did not run.
import path from 'node:path';
import type { AgentCheck, NodeConfig } from '../shared/types';
import { runPowerShell } from './command';
import { t } from '../shared/i18n';

const SCRIPT = String.raw`$k = Get-Item 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Shares' -ErrorAction SilentlyContinue
$o = @{}
if ($k) { foreach ($n in $k.GetValueNames()) { $p = @($k.GetValue($n)) | Where-Object { $_ -like 'Path=*' } | Select-Object -First 1; if ($p) { $o[$n] = $p.Substring(5) } } }
$o | ConvertTo-Json -Compress`;

/** Share name (lower case) -> local folder; null when it cannot be told (not Windows, or the registry did not answer). */
export async function localShares(): Promise<Map<string, string> | null> {
  if (process.platform !== 'win32') return null;
  try {
    const out = (await runPowerShell(SCRIPT, undefined, 15_000)).trim();
    const obj = out ? (JSON.parse(out) as Record<string, string>) : {};
    return new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  } catch {
    return null;
  }
}

/** The share and the folders below it that senders reach a machine by: networkRoot "Share\Release", or a UNC path. */
export function shareOf(node: NodeConfig): { share: string; rest: string[] } | null {
  if (node.transport === 'sftp') return null;
  let p = node.networkRoot;
  if (node.transport === 'path' || node.path) {
    const m = /^[\\/]{2}[^\\/]+[\\/](.+)$/.exec(node.path ?? '');
    if (!m) return null;
    p = m[1];
  }
  const parts = (p ?? '').split(/[\\/]+/).filter(Boolean);
  return parts.length ? { share: parts[0], rest: parts.slice(1) } : null;
}

const norm = (p: string) => path.win32.normalize(p).replace(/\\+$/, '').toLowerCase();

/**
 * What is wrong with receiving sends here: the first local root is missing, or the share leads somewhere else. A share
 * that is not there, or that leads elsewhere, matters on a relay, or where senders did write through the share
 * (`sentTo` finds SamSync's files in that folder); a machine that only ever sends needs neither, and its local roots
 * are about where its own files come from.
 */
export function agentChecks(node: NodeConfig, root: string | undefined, rootExists: boolean, shares: Map<string, string> | null, relay = false, sentTo: (folder: string) => boolean = () => false): AgentCheck[] {
  if (!root) return [{ level: 'error', text: t('Bu makinenin yerel kökü yok; gelen paketler uygulanamaz') }];
  const out: AgentCheck[] = [];
  const s = shareOf(node);
  if (s && shares) {
    const admin = /^([a-z])\$$/i.exec(s.share);
    const base = admin ? `${admin[1].toUpperCase()}:\\` : shares.get(s.share.toLowerCase());
    if (!base) {
      if (relay) out.push({ level: 'warn', text: t('Bu makinede {share} adlı paylaşım yok; bu makineye gönderilenler ulaşmaz', { share: s.share }) });
    } else {
      const expected = path.win32.join(base, ...s.rest);
      if (norm(expected) !== norm(root) && (relay || sentTo(expected))) {
        out.push({ level: 'error', text: t('{share} paylaşımı bu makinede {expected} klasörünü gösteriyor ama ilk yerel kök {root}; gönderenler buradaki SamSync’i göremez', { share: s.share, expected, root }), fixRoot: expected });
        return out;
      }
    }
  }
  if (!rootExists) out.unshift({ level: 'error', text: t('İlk yerel kök {root} bu makinede yok; gönderenler buradaki SamSync’i göremez', { root }) });
  return out;
}
