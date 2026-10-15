import net from 'node:net';
import fsp from 'node:fs/promises';
import type { AppConfig, NodeConfig, ProbeResult } from '../shared/types';
import { nodeRootLabel, smbRoot } from './transport';
import { mapLimit, withTimeout, errMessage } from './util';

export function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean, error?: string) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve({ ok, ms: Date.now() - start, error });
    };
    sock.setTimeout(timeoutMs, () => done(false, `${timeoutMs} ms içinde yanıt yok`));
    sock.once('connect', () => done(true));
    sock.once('error', (e) => done(false, errMessage(e)));
  });
}

export async function probeNode(cfg: AppConfig, node: NodeConfig, timeoutMs = 1500): Promise<ProbeResult> {
  const root = nodeRootLabel(cfg, node);
  const base = { nodeId: node.id, root, checkedAt: Date.now() };
  if (node.transport === 'sftp') {
    const host = node.sftp?.host || node.address;
    const r = await tcpProbe(host, node.sftp?.port ?? 22, timeoutMs);
    return { ...base, ok: r.ok, latencyMs: r.ms, detail: r.ok ? `SSH ${host}:${node.sftp?.port ?? 22} yanıt verdi (${r.ms} ms)` : `SSH yanıt vermedi: ${r.error}` };
  }
  if (node.transport === 'path' || node.path) {
    const p = node.path ?? root;
    const start = Date.now();
    try {
      const st = await withTimeout(fsp.stat(p), timeoutMs * 2);
      return { ...base, ok: st.isDirectory(), latencyMs: Date.now() - start, detail: st.isDirectory() ? 'Klasör erişilebilir' : 'Yol bir klasör değil' };
    } catch (e) {
      return { ...base, ok: false, detail: `Klasöre erişilemedi: ${errMessage(e)}` };
    }
  }
  // SMB: a quick TCP check on 445 avoids waiting for the OS network timeout on a powered off machine.
  const r = await tcpProbe(node.address, 445, timeoutMs);
  if (!r.ok) return { ...base, ok: false, latencyMs: r.ms, detail: `SMB (445) yanıt vermedi: ${r.error}` };
  if (process.platform !== 'win32') {
    try {
      await withTimeout(fsp.stat(smbRoot(cfg, node)), timeoutMs * 2);
      return { ...base, ok: true, latencyMs: r.ms, detail: `SMB yanıt verdi (${r.ms} ms), bağlama noktası erişilebilir` };
    } catch {
      return { ...base, ok: false, latencyMs: r.ms, detail: `SMB yanıt verdi ama ${smbRoot(cfg, node)} bağlı değil` };
    }
  }
  return { ...base, ok: true, latencyMs: r.ms, detail: `SMB (445) yanıt verdi (${r.ms} ms)` };
}

export async function probeNodes(cfg: AppConfig, nodes: NodeConfig[], timeoutMs = 1500): Promise<ProbeResult[]> {
  return mapLimit(nodes, 24, (n) => probeNode(cfg, n, timeoutMs));
}
