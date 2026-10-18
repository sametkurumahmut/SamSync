// Password protection for pack files. An encrypted pack is the plain pack (members, index, trailer) run through
// AES-256-CTR behind a 40-byte header; CTR keeps every member readable at its own offset, so an encrypted pack
// is applied member by member like a plain one. The key comes from the password with scrypt and lives only in
// this process: once a pack was opened with its password, its members are read without asking again.
//
//   [magic "SSPACK02", 8][salt, 16][nonce, 16][AES-256-CTR(plain pack bytes)]
import crypto from 'node:crypto';
import path from 'node:path';
import { Transform } from 'node:stream';

export const ENC_MAGIC = Buffer.from('SSPACK02', 'latin1');
/** magic + salt + nonce */
export const ENC_HEADER = 40;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** The pack is password-protected and no password (or remembered key) is at hand. */
export class PackLockedError extends Error {
  constructor() {
    super('pack locked');
    this.name = 'PackLockedError';
  }
}

/** The password given does not open this pack. */
export class PackPasswordError extends Error {
  constructor() {
    super('wrong pack password');
    this.name = 'PackPasswordError';
  }
}

export interface PackKey {
  key: Buffer;
  nonce: Buffer;
}

export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password.normalize('NFC'), salt, 32, SCRYPT);
}

export function newPackKey(password: string): { k: PackKey; header: Buffer } {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(16);
  return { k: { key: deriveKey(password, salt), nonce }, header: Buffer.concat([ENC_MAGIC, salt, nonce]) };
}

/** The counter block for body offset `pos`: the nonce as a 128-bit number plus the block index, wrapping. */
function counterAt(nonce: Buffer, pos: number): Buffer {
  const base = (nonce.readBigUInt64BE(0) << 64n) | nonce.readBigUInt64BE(8);
  const n = (base + BigInt(Math.floor(pos / 16))) & ((1n << 128n) - 1n);
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(n >> 64n, 0);
  iv.writeBigUInt64BE(n & ((1n << 64n) - 1n), 8);
  return iv;
}

function cipherAt(k: PackKey, pos: number): crypto.Cipheriv {
  const c = crypto.createCipheriv('aes-256-ctr', k.key, counterAt(k.nonce, pos));
  const skip = pos % 16;
  if (skip) c.update(Buffer.alloc(skip)); // move into the first block
  return c;
}

/** Encrypts or decrypts (the same operation in CTR) bytes that start at body offset `pos`. */
export function ctrTransform(k: PackKey, pos: number): Transform {
  const c = cipherAt(k, pos);
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      cb(null, c.update(chunk));
    },
  });
}

export function ctrBuffer(k: PackKey, pos: number, data: Buffer): Buffer {
  return cipherAt(k, pos).update(data);
}

// ---- keys of the packs opened in this process, by file

const keys = new Map<string, PackKey>();
const keyOf = (file: string) => {
  const p = path.resolve(file);
  return process.platform === 'win32' ? p.toLowerCase() : p;
};

export function rememberPackKey(file: string, k: PackKey): void {
  keys.set(keyOf(file), k);
}
export function packKeyFor(file: string): PackKey | undefined {
  return keys.get(keyOf(file));
}
export function forgetPackKey(file: string): void {
  keys.delete(keyOf(file));
}
