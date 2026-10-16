import net from 'node:net';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, NodeConfig, ProbeResult } from '../shared/types';
import { nodeRootLabel, smbRoot } from './transport';
import { ALIVE_FILE, heartbeatFresh, type Heartbeat } from './relay';
import { mapLimit, withTimeout, errMessage } from './util';
import { t } from '../shared/i18n';

export function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean, error?: string) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve({ ok, ms: Date.now() - start, error });
    };
    sock.setTimeout(timeoutMs, () => done(false, t('{ms} ms içinde yanıt yok', { ms: timeoutMs })));
    sock.once('connect', () => done(true));
    sock.once('error', (e) => done(false, errMessage(e)));
  });
}

/**
 * Whether a machine can be reached. `deep` (the periodic check from the window) also touches the share on
 * Windows: it tells a machine that answers on 445 but does not give the share apart, and it keeps the SMB
 * session open, so the next send does not pay for setting one up (a second on a slow network). A plan does
 * not need that: its first file operation opens the session anyway.
 */
export async function probeNode(cfg: AppConfig, node: NodeConfig, timeoutMs = 1500, deep = true): Promise<ProbeResult> {
  const root = nodeRootLabel(cfg, node);
  const base = { nodeId: node.id, root, checkedAt: Date.now() };
  if (node.transport === 'sftp') {
    const host = node.sftp?.host || node.address;
    const r = await tcpProbe(host, node.sftp?.port ?? 22, timeoutMs);
    const port = node.sftp?.port ?? 22;
    return { ...base, ok: r.ok, latencyMs: r.ms, detail: r.ok ? t('SSH {host}:{port} yanıt verdi ({ms} ms)', { host, port, ms: r.ms }) : t('SSH yanıt vermedi: {error}', { error: r.error ?? '' }) };
  }
  if (node.transport === 'path' || node.path) {
    const p = node.path ?? root;
    const start = Date.now();
    try {
      const st = await withTimeout(fsp.stat(p), timeoutMs * 2);
      const r: ProbeResult = { ...base, ok: st.isDirectory(), latencyMs: Date.now() - start, detail: st.isDirectory() ? t('Klasör erişilebilir') : t('Yol bir klasör değil') };
      return deep && r.ok ? withRelayAlive(r, p, node) : r;
    } catch (e) {
      return { ...base, ok: false, detail: t('Klasöre erişilemedi: {error}', { error: errMessage(e) }) };
    }
  }
  // SMB: a quick TCP check on 445 avoids waiting for the OS network timeout on a powered off machine.
  const r = await tcpProbe(node.address, 445, timeoutMs);
  if (!r.ok) return { ...base, ok: false, latencyMs: r.ms, detail: t('SMB (445) yanıt vermedi: {error}', { error: r.error ?? '' }) };
  if (process.platform !== 'win32') {
    try {
      await withTimeout(fsp.stat(smbRoot(cfg, node)), timeoutMs * 2);
      return { ...base, ok: true, latencyMs: r.ms, detail: t('SMB yanıt verdi ({ms} ms), bağlama noktası erişilebilir', { ms: r.ms }) };
    } catch {
      return { ...base, ok: false, latencyMs: r.ms, detail: t('SMB yanıt verdi ama {path} bağlı değil', { path: smbRoot(cfg, node) }) };
    }
  }
  if (deep) {
    const start = Date.now();
    try {
      const st = await withTimeout(fsp.stat(smbRoot(cfg, node)), Math.max(timeoutMs * 4, 6000));
      if (!st.isDirectory()) return { ...base, ok: false, latencyMs: r.ms, detail: t('{path} bir klasör değil', { path: smbRoot(cfg, node) }) };
      const ok: ProbeResult = { ...base, ok: true, latencyMs: Date.now() - start, detail: t('Paylaşım erişilebilir ({ms} ms)', { ms: Date.now() - start }) };
      return withRelayAlive(ok, smbRoot(cfg, node), node);
    } catch (e) {
      return { ...base, ok: false, latencyMs: r.ms, detail: t('SMB yanıt verdi ama {path} açılamadı: {error}', { path: smbRoot(cfg, node), error: errMessage(e) }) };
    }
  }
  return { ...base, ok: true, latencyMs: r.ms, detail: t('SMB (445) yanıt verdi ({ms} ms)', { ms: r.ms }) };
}

/** For a machine marked as relay: reads the heartbeat SamSync there writes, so the window can say whether it runs. */
async function withRelayAlive(r: ProbeResult, root: string, node: NodeConfig): Promise<ProbeResult> {
  if (!node.relay) return r;
  try {
    const raw = await withTimeout(fsp.readFile(path.join(root, ...ALIVE_FILE.split('/')), 'utf8'), 4000);
    const h = JSON.parse(raw) as Heartbeat;
    const alive = heartbeatFresh(h);
    return { ...r, relayAlive: alive, relaySeenAt: h.at, detail: alive ? t('{detail}; röle çalışıyor', { detail: r.detail }) : t('{detail}; röle yanıt vermiyor (son {ago})', { detail: r.detail, ago: agoText(h.at) }) };
  } catch {
    return { ...r, relayAlive: false, detail: t('{detail}; rölede SamSync çalışmıyor', { detail: r.detail }) };
  }
}

function agoText(at: number): string {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 60 ? t('{n} dk önce', { n: Math.max(1, m) }) : t('{n} sa önce', { n: Math.round(m / 60) });
}

export async function probeNodes(cfg: AppConfig, nodes: NodeConfig[], timeoutMs = 1500, deep = true): Promise<ProbeResult[]> {
  return mapLimit(nodes, 24, (n) => probeNode(cfg, n, timeoutMs, deep));
}
