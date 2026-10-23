// A self-signed certificate for the web interface's HTTPS, made with Node's own crypto: an EC P-256 key and a
// certificate for this computer's name and addresses. Kept in the user data folder and made again before it runs
// out or when the addresses change. Browsers warn about it once; the fingerprint shown in the settings lets the
// user check that the warning is about this computer.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DAY = 86400_000;
const VALID_DAYS = 730;
/** made again when fewer days than this are left */
const RENEW_DAYS = 30;

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
}

const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);

function int(b: Buffer): Buffer {
  return tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
}

function oid(s: string): Buffer {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const enc = [v & 0x7f];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) enc.unshift((x & 0x7f) | 0x80);
    out.push(...enc);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(d: Date): Buffer {
  const s = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(s.slice(2), 'ascii')) : tlv(0x18, Buffer.from(s, 'ascii'));
}

function ext(id: string, critical: boolean, value: Buffer): Buffer {
  return seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value));
}

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';

/** A self-signed server certificate for these names and IPv4 addresses, with its private key (both PEM). */
export function makeSelfSignedCert(names: string[], ips: string[], now = new Date()): { cert: string; key: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const cn = names[0] ?? 'SamSync';
  const name = seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const san = seq(...names.map((n) => tlv(0x82, Buffer.from(n, 'ascii'))), ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))));
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))),
    int(serial),
    seq(oid(ECDSA_SHA256)),
    name,
    seq(time(new Date(now.getTime() - DAY)), time(new Date(now.getTime() + VALID_DAYS * DAY))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(
      0xa3,
      seq(
        ext('2.5.29.17', false, san),
        ext('2.5.29.19', true, seq()),
        ext('2.5.29.15', true, tlv(0x03, Buffer.from([0x07, 0x80]))),
        ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
      ),
    ),
  );
  const sig = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, seq(oid(ECDSA_SHA256)), tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n');
  return { cert: `-----BEGIN CERTIFICATE-----\n${b64.replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}

/** This computer's IPv4 addresses on its networks (not loopback, not link-local). */
export function localIPv4(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address);
}

export interface WebCertificate {
  cert: string;
  key: string;
  /** SHA-256 fingerprint, as browsers show it */
  fingerprint: string;
  validTo: number;
}

/** The certificate kept in `dir`, or a new one when there is none, it runs out soon or the addresses changed. */
export async function webCertificate(dir: string, now = new Date()): Promise<WebCertificate> {
  const certFile = path.join(dir, 'webui-cert.pem');
  const keyFile = path.join(dir, 'webui-key.pem');
  const host = os.hostname().toLowerCase();
  const names = ['localhost', ...(host && host !== 'localhost' ? [host] : [])];
  const ips = ['127.0.0.1', ...localIPv4()];
  try {
    const [cert, key] = await Promise.all([fsp.readFile(certFile, 'utf8'), fsp.readFile(keyFile, 'utf8')]);
    const x = new crypto.X509Certificate(cert);
    const san = x.subjectAltName ?? '';
    const fresh = Date.parse(x.validTo) - now.getTime() > RENEW_DAYS * DAY;
    // whole entries: 10.0.0.1 is not covered by 10.0.0.10
    const entries = new Set(san.split(',').map((x) => x.trim()));
    const covers = names.every((n) => entries.has(`DNS:${n}`)) && ips.every((ip) => entries.has(`IP Address:${ip}`));
    if (fresh && covers && x.checkPrivateKey(crypto.createPrivateKey(key))) return { cert, key, fingerprint: x.fingerprint256, validTo: Date.parse(x.validTo) };
  } catch {
    /* none yet, or unreadable: a new one */
  }
  const made = makeSelfSignedCert(names, ips, now);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(keyFile, made.key, { mode: 0o600 });
  await fsp.writeFile(certFile, made.cert);
  const x = new crypto.X509Certificate(made.cert);
  return { ...made, fingerprint: x.fingerprint256, validTo: Date.parse(x.validTo) };
}
