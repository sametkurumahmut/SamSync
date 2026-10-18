// Finds the machines on the local network that could be targets: every address of this computer's IPv4 subnets
// (capped at a /24 around each address) is tried on the SMB and SSH ports, the ones that answer get a reverse
// name lookup and, on Windows, their share list from `net view`. Nothing is written anywhere; the result is a
// list the Targets page and the setup wizard turn into nodes.
import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import type { AppConfig, DiscoveredHost } from '../shared/types';
import { CancelToken, mapLimit } from './util';

export const SMB_PORT = 445;
export const SSH_PORT = 22;

/** The IPv4 addresses of one subnet this computer is on (the computer's own address left out). */
export interface Subnet {
  self: string;
  /** Interface name, for the log. */
  iface: string;
  hosts: string[];
}

const ipToInt = (ip: string) => ip.split('.').reduce((a, p) => (a << 8) + (Number(p) & 255), 0) >>> 0;
const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

/** The addresses to try for a host/netmask pair; a mask wider than /24 is narrowed to the /24 around the host. */
export function subnetHosts(address: string, netmask: string): string[] {
  const ip = ipToInt(address);
  let mask = ipToInt(netmask);
  if ((mask & 0xffffff00) !== 0xffffff00 && (mask >>> 0) < 0xffffff00) mask = 0xffffff00;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const out: string[] = [];
  for (let n = network + 1; n < broadcast; n++) if (n !== ip) out.push(intToIp(n));
  return out;
}

export function localSubnets(interfaces = os.networkInterfaces()): Subnet[] {
  const out: Subnet[] = [];
  for (const [iface, list] of Object.entries(interfaces)) {
    for (const a of list ?? []) {
      if (a.internal || a.family !== 'IPv4' && (a.family as unknown) !== 4) continue;
      if (a.address.startsWith('169.254.')) continue; // link-local, no neighbours worth scanning
      out.push({ self: a.address, iface, hosts: subnetHosts(a.address, a.netmask) });
    }
  }
  return out;
}

function portOpen(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, ip);
  });
}

async function reverseName(ip: string, timeoutMs: number): Promise<string | undefined> {
  const lookup = dns.reverse(ip).then((names) => names[0]).catch(() => undefined);
  const timer = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  const name = await Promise.race([lookup, timer]);
  return name ? name.replace(/\.$/, '') : undefined;
}

/**
 * The disk shares in the output of `net view \\host` (any Windows language: the name is the first column, the
 * type word "Disk" the second). Administrative shares (ending in $) are left out.
 */
export function parseNetView(output: string): string[] {
  const shares: string[] = [];
  let inTable = false;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^-{10,}/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.trim()) break;
    const m = /^(\S(?:.*?\S)?)\s{2,}(\S+)/.exec(line);
    if (!m) continue;
    const [, name, type] = m;
    if (!/^disk$/i.test(type)) continue;
    if (name.endsWith('$')) continue;
    shares.push(name);
  }
  return shares;
}

function listShares(ip: string, timeoutMs: number): Promise<string[] | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile('net', ['view', `\\\\${ip}`], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (err && !stdout) return resolve(undefined);
      resolve(parseNetView(String(stdout)));
    });
  });
}

export interface DiscoverOptions {
  cancel?: CancelToken;
  onProgress?: (done: number, total: number, found: number) => void;
  ports?: number[];
  connectTimeoutMs?: number;
  concurrency?: number;
  /** For tests: the subnets to scan instead of this computer's. */
  subnets?: Subnet[];
  probe?: (ip: string, port: number, timeoutMs: number) => Promise<boolean>;
  names?: (ip: string) => Promise<string | undefined>;
  shares?: (ip: string) => Promise<string[] | undefined>;
}

/** Scans this computer's subnets; the hosts that answer, with what is known about them and whether they are in `cfg` already. */
export async function discoverHosts(cfg: AppConfig, opts: DiscoverOptions = {}): Promise<DiscoveredHost[]> {
  const cancel = opts.cancel ?? new CancelToken();
  const ports = opts.ports ?? [SMB_PORT, SSH_PORT];
  const timeout = opts.connectTimeoutMs ?? 600;
  const probe = opts.probe ?? portOpen;
  const subnets = opts.subnets ?? localSubnets();
  const self = new Set(subnets.map((s) => s.self));
  const all = [...new Set(subnets.flatMap((s) => s.hosts))].filter((ip) => !self.has(ip));
  let done = 0;
  const found: DiscoveredHost[] = [];
  opts.onProgress?.(0, all.length, 0);
  await mapLimit(all, opts.concurrency ?? 64, async (ip) => {
    cancel.throwIfCancelled();
    const open: number[] = [];
    for (const p of ports) if (await probe(ip, p, timeout)) open.push(p);
    done++;
    if (open.length) found.push({ address: ip, ports: open });
    opts.onProgress?.(done, all.length, found.length);
  });
  cancel.throwIfCancelled();
  // names and shares only for the machines that answered: a few at a time, each with its own time limit
  const byAddress = new Map(cfg.nodes.map((n) => [n.address.toLowerCase(), n] as const));
  const byName = new Map<string, (typeof cfg.nodes)[number]>();
  for (const n of cfg.nodes) {
    byName.set(n.address.toLowerCase(), n);
    for (const x of n.localNames ?? []) byName.set(x.toLowerCase(), n);
  }
  await mapLimit(found, 8, async (h) => {
    cancel.throwIfCancelled();
    h.hostname = await (opts.names ?? ((ip) => reverseName(ip, 1500)))(h.address);
    if (h.ports.includes(SMB_PORT)) h.shares = await (opts.shares ?? ((ip) => listShares(ip, 4000)))(h.address);
    const short = h.hostname?.split('.')[0].toLowerCase();
    const known = byAddress.get(h.address.toLowerCase()) ?? (h.hostname ? byName.get(h.hostname.toLowerCase()) : undefined) ?? (short ? byName.get(short) : undefined);
    if (known) h.nodeId = known.id;
  });
  found.sort((a, b) => ipToInt(a.address) - ipToInt(b.address));
  return found;
}
