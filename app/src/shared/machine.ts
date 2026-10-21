// How a machine is named on screen. Names often carry the address ("PC-1 - 10.10.1.11", "Server (10.10.1.10)"):
// the UI shows the short name as the title and the address on its own, in a smaller font, everywhere.

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const HOSTISH = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/;

export interface MachineLabel {
  /** The name without its address part. */
  title: string;
  /** The address (or what the name carried after the separator), when it differs from the title. */
  sub?: string;
}

/**
 * Splits a machine name into title and address. A trailing " - 10.0.0.5", " – host", " | host" or " (10.0.0.5)" that
 * is the node's address, an IPv4 address or a dotted host name becomes the subtitle; otherwise the node's address is.
 * "Build - Release" stays whole: its tail is none of those.
 */
export function machineLabel(name: string, address?: string): MachineLabel {
  const n = (name ?? '').trim();
  const addr = (address ?? '').trim();
  let head: string | undefined;
  let tail: string | undefined;
  const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(n);
  if (paren) {
    head = paren[1];
    tail = paren[2].trim();
  } else {
    // greedy head: the last separator wins ("Lab-B PC-2 | 10.10.1.32")
    const m = /^(.*\S)\s+[-–—|•]\s+(\S.*)$/.exec(n);
    if (m) {
      head = m[1];
      tail = m[2].trim();
    }
  }
  if (head && tail) {
    const isAddr = (addr && tail.toLowerCase() === addr.toLowerCase()) || IPV4.test(tail) || HOSTISH.test(tail);
    if (isAddr) return { title: head.trim(), sub: tail };
  }
  const sub = addr && n && addr.toLowerCase() !== n.toLowerCase() ? addr : undefined;
  return { title: n || addr, sub };
}

/** Just the short name, for sentences ("unreachable: PC-1, PC-3"). */
export function machineTitle(name: string, address?: string): string {
  return machineLabel(name, address).title;
}

/** A MAC address as "aa:bb:cc:dd:ee:ff", from any common way of writing one; null when it is not one. */
/** Whether this much free space is under the limit set in Settings (2 GB when none is set; 0 turns it off). */
export function lowOnSpace(free: number | undefined, minFreeGB: number | undefined): boolean {
  const gb = minFreeGB ?? 2;
  return free != null && gb > 0 && free < gb * 1024 ** 3;
}

export function normalizeMac(s: string): string | null {
  const hex = s.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length !== 12 || /^0+$/.test(hex) || /^f+$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}
