// Content comparison with SamSync on the target: instead of reading every file of the target back over the
// network to hash it, the sender asks the machine for the hashes. SamSync there hashes its own disk (fast) and
// writes the answer next to the request in its relay folder. A machine that does not pick the request up within a
// few seconds is read over the network as before.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Transport } from './transport';
import type { HashCache } from './hashcache';
import { RELAY_FOLDER } from '../shared/relay';
import { relJoin } from './paths';
import { hashStream } from './compare';
import { mapLimit, newId, sleep } from './util';
import { fileBlocks, type BlockList } from './delta';

export const HASH_DIR = relJoin(RELAY_FOLDER, 'hashes');
export interface HashFile {
  rel: string;
  size: number;
  mtimeMs: number;
}
export interface HashRequest {
  id: string;
  at: number;
  files: HashFile[];
  /** block lists for a block delta (see delta.ts): of these files as they are now */
  blocks?: { rels: string[]; blockSize: number };
}
export interface HashAnswer {
  id: string;
  /** null: the file is not there as listed (gone, or changed meanwhile) */
  hashes: Record<string, string | null>;
  blocks?: Record<string, BlockList | null>;
}

const PICKUP_MS = 6000;
const BATCH_MAX = 2000;
/** the slowest hashing speed expected on the target; the wait for an answer grows with the bytes asked */
const HASH_RATE = 20 * 1024 * 1024;
/** two times this close count as the same file */
const TIME_SLACK_MS = 2000;

async function writeJson(tgt: Transport, rel: string, value: unknown): Promise<void> {
  const tmp = `${rel}.${newId()}.tmp`;
  await tgt.writeStream(tmp, Readable.from([Buffer.from(JSON.stringify(value), 'utf8')]));
  await tgt.rename(tmp, rel);
}

async function readJson<T>(tgt: Transport, rel: string): Promise<T | null> {
  if (!(await tgt.stat(rel))) return null;
  const chunks: Buffer[] = [];
  for await (const c of await tgt.readStream(rel)) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return null; // half written: the next look gets the whole file
  }
}

/** The sender's side: batches hash questions for one target and waits for SamSync there to answer them. */
export class AgentHasher {
  private known = new Map<string, Promise<string | null>>();
  private queued: { f: HashFile; resolve: (h: string | null) => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dead = false;
  /** files whose hash came from the target */
  answered = 0;

  constructor(
    private tgt: Transport,
    private cancelled: () => boolean = () => false,
    private pickupMs = PICKUP_MS,
  ) {}

  /** Asks for many files in one request (a folder's worth); hash() then waits for these. */
  prefetch(files: HashFile[]): void {
    const fresh = files.filter((f) => !this.known.has(f.rel));
    for (let i = 0; i < fresh.length; i += BATCH_MAX) this.send(fresh.slice(i, i + BATCH_MAX));
  }

  /** The hash SamSync on the target computed for this file, or null: read it over the network then. */
  hash(rel: string, size: number, mtimeMs: number): Promise<string | null> {
    const known = this.known.get(rel);
    if (known) return known;
    if (this.dead) return Promise.resolve(null);
    const p = new Promise<string | null>((resolve) => this.queued.push({ f: { rel, size, mtimeMs }, resolve }));
    this.known.set(rel, p);
    if (this.queued.length >= BATCH_MAX) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 80);
    return p;
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const q = this.queued;
    this.queued = [];
    const done = this.dead ? Promise.resolve(null) : this.request(q.map((x) => x.f)).then((a) => a?.hashes ?? null).catch(() => null);
    void done.then((r) => {
      for (const x of q) x.resolve(this.pick(r, x.f.rel));
    });
  }

  private send(files: HashFile[]): void {
    const done = this.dead ? Promise.resolve(null) : this.request(files).then((a) => a?.hashes ?? null).catch(() => null);
    for (const f of files) this.known.set(f.rel, done.then((r) => this.pick(r, f.rel)));
  }

  private pick(r: Record<string, string | null> | null, rel: string): string | null {
    const h = r?.[rel] ?? null;
    if (h) this.answered++;
    return h;
  }

  /** The block lists of these files on the target (for a block delta); null when SamSync there does not answer. */
  async blocks(files: { rel: string; size: number }[], blockSize: number): Promise<Record<string, BlockList | null> | null> {
    if (!files.length || this.dead) return null;
    const a = await this.request([], { rels: files.map((f) => f.rel), blockSize }, files.reduce((n, f) => n + f.size, 0)).catch(() => null);
    return a?.blocks ?? null;
  }

  private async request(files: HashFile[], blocks?: HashRequest['blocks'], blockBytes = 0): Promise<HashAnswer | null> {
    if (!files.length && !blocks?.rels.length) return { id: '', hashes: {} };
    const id = newId('h-');
    const req = relJoin(HASH_DIR, `${id}.req.json`);
    const ans = relJoin(HASH_DIR, `${id}.ans.json`);
    await this.tgt.mkdirp(HASH_DIR);
    await writeJson(this.tgt, req, { id, at: Date.now(), files, blocks } satisfies HashRequest);
    const started = Date.now();
    const bytes = files.reduce((n, f) => n + f.size, 0) + blockBytes;
    let pickedAt = 0;
    while (!this.dead && !this.cancelled()) {
      await sleep(pickedAt ? 250 : 120);
      const a = await readJson<HashAnswer>(this.tgt, ans).catch(() => null);
      if (a?.id === id) {
        await this.tgt.remove(ans, false).catch(() => undefined);
        return a;
      }
      if (!pickedAt) {
        if (!(await this.tgt.stat(req).catch(() => null))) pickedAt = Date.now();
        else if (Date.now() - started > this.pickupMs) break; // nobody took it
      } else if (Date.now() - pickedAt > 60_000 + (bytes / HASH_RATE) * 1000) break;
    }
    // no answer: this target is read over the network from now on
    this.dead = true;
    await this.tgt.remove(req, false).catch(() => undefined);
    return null;
  }
}

/** SamSync on the target: answers the hash requests in its relay folder from its own disk. */
export async function answerHashRequests(localRoot: string, cache: HashCache | undefined, busy: Set<string>): Promise<void> {
  const dir = path.join(localRoot, ...HASH_DIR.split('/'));
  let names: string[];
  try {
    names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.req.json'));
  } catch {
    return;
  }
  for (const name of names) {
    const id = name.slice(0, -'.req.json'.length);
    if (busy.has(id)) continue;
    busy.add(id);
    void answerOne(dir, id, localRoot, cache)
      .catch(() => undefined)
      .finally(() => busy.delete(id));
  }
}

async function answerOne(dir: string, id: string, root: string, cache: HashCache | undefined): Promise<void> {
  // taking the request away tells the sender it is being worked on
  const work = path.join(dir, `${id}.work`);
  try {
    await fsp.rename(path.join(dir, `${id}.req.json`), work);
  } catch {
    return; // half written, or taken back by the sender
  }
  let req: HashRequest;
  try {
    req = JSON.parse(await fsp.readFile(work, 'utf8')) as HashRequest;
  } catch {
    await fsp.rm(work, { force: true });
    return;
  }
  const hashes: Record<string, string | null> = {};
  await mapLimit(req.files ?? [], 4, async (f) => {
    try {
      const abs = path.join(root, ...f.rel.split('/'));
      const st = await fsp.stat(abs);
      if (!st.isFile() || st.size !== f.size || Math.abs(st.mtimeMs - f.mtimeMs) > TIME_SLACK_MS) {
        hashes[f.rel] = null;
        return;
      }
      const hit = cache?.get(root, f.rel, st.size, st.mtimeMs);
      const h = hit ?? (await hashStream(fs.createReadStream(abs)));
      if (!hit) cache?.set(root, f.rel, st.size, st.mtimeMs, h);
      hashes[f.rel] = h;
    } catch {
      hashes[f.rel] = null;
    }
  });
  let blocks: HashAnswer['blocks'];
  if (req.blocks?.rels.length) {
    const lists: Record<string, BlockList | null> = {};
    await mapLimit(req.blocks.rels, 2, async (rel) => {
      lists[rel] = await fileBlocks(path.join(root, ...rel.split('/')), req.blocks!.blockSize).catch(() => null);
    });
    blocks = lists;
  }
  const ans = path.join(dir, `${id}.ans.json`);
  await fsp.writeFile(`${ans}.tmp`, JSON.stringify({ id, hashes, blocks } satisfies HashAnswer));
  await fsp.rename(`${ans}.tmp`, ans);
  await fsp.rm(work, { force: true });
}

/** Leftovers of senders that gave up and of answers nobody fetched. */
export async function pruneHashRequests(localRoot: string, olderThanMs = 3600_000): Promise<void> {
  const dir = path.join(localRoot, ...HASH_DIR.split('/'));
  try {
    const cutoff = Date.now() - olderThanMs;
    for (const n of await fsp.readdir(dir)) {
      const p = path.join(dir, n);
      const st = await fsp.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fsp.rm(p, { force: true });
    }
  } catch {
    /* nothing to prune */
  }
}
