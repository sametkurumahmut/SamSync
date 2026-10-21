// Waking a machine that is off (Wake-on-LAN): a magic packet, six 0xFF bytes and then the network card's MAC
// address sixteen times, sent as a broadcast on every network of this computer. The machine's card must have
// Wake-on-LAN turned on (in the BIOS and the driver). MAC addresses are learned while the machine is on: from the
// heartbeat of SamSync there, or from this computer's ARP table after a probe answered.
import dgram from 'node:dgram';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { sleep } from './util';
import { t } from '../shared/i18n';
import { normalizeMac } from '../shared/machine';

export { normalizeMac };

export function magicPacket(mac: string): Buffer {
  const m = Buffer.from(normalizeMac(mac)!.replace(/:/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => m)]);
}

/** The broadcast address of each IPv4 network of this computer, and the general one. */
export function broadcastAddresses(): string[] {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.internal || i.family !== 'IPv4' || !i.netmask) continue;
      const ip = i.address.split('.').map(Number);
      const mask = i.netmask.split('.').map(Number);
      out.add(ip.map((b, k) => (b & mask[k]) | (~mask[k] & 255)).join('.'));
    }
  }
  return [...out];
}

/** The machine's own network as a /24, for a machine on another subnet (when the router passes such broadcasts). */
export function subnetBroadcast(address: string): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(address.trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}.255` : null;
}

/** Sends the magic packets for these MAC addresses a few times to ports 9 and 7; how many went out. */
export async function wake(macs: string[], addresses = broadcastAddresses(), repeat = 3): Promise<number> {
  const packets = [...new Set(macs.map(normalizeMac).filter((m): m is string => !!m))].map(magicPacket);
  if (!packets.length) throw new Error(t('Geçerli bir MAC adresi yok'));
  const sock = dgram.createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    sock.once('error', reject);
    sock.bind(0, () => {
      sock.setBroadcast(true);
      resolve();
    });
  });
  let sent = 0;
  try {
    for (let r = 0; r < repeat; r++) {
      for (const p of packets) {
        for (const a of addresses) {
          for (const port of [9, 7]) {
            await new Promise<void>((resolve) =>
              sock.send(p, port, a, (e) => {
                if (!e) sent++;
                resolve();
              }),
            );
          }
        }
      }
      await sleep(150);
    }
  } finally {
    sock.close();
  }
  return sent;
}

/** IPv4 address -> MAC from this computer's ARP (neighbour) table: the machines it talked to lately. */
export function arpTable(): Promise<Map<string, string>> {
  const [cmd, args] = process.platform === 'linux' ? ['ip', ['neigh', 'show']] : ['arp', ['-a']];
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (_e, stdout) => {
      const out = new Map<string, string>();
      for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const ip = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(line)?.[1];
        const mac = /\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i.exec(line)?.[1];
        // macOS leaves out leading zeros ("0:1b:2c…")
        const norm = mac ? normalizeMac(mac.split(/[:-]/).map((x) => x.padStart(2, '0')).join('')) : null;
        if (ip && norm) out.set(ip, norm);
      }
      resolve(out);
    });
  });
}
