// Questions a sender asks SamSync on a target through the target's share, the way content comparisons ask for
// hashes: which program holds a file, closing those programs, a drift check of the sent folders. SamSync there
// takes the question (the request file goes away), works on its own disk and writes the answer next to it. A
// machine that does not take it within a few seconds has no SamSync running, or one too old to know the question.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Transport } from './transport';
import { RELAY_FOLDER } from '../shared/relay';
import { relJoin } from './paths';
import { errMessage, newId, sleep } from './util';
import { t } from '../shared/i18n';

export const ASK_DIR = relJoin(RELAY_FOLDER, 'asks');
/** The questions this version answers (named in its heartbeat). */
export const ASK_KINDS = ['holders', 'close', 'drift'] as const;

export type AgentAsk = { kind: 'holders'; rels: string[] } | { kind: 'close'; rels: string[]; pids: number[] } | { kind: 'drift'; subtrees?: string[] };
interface AskFile {
  id: string;
  at: number;
  ask: AgentAsk;
}
interface AnswerFile {
  id: string;
  ok: boolean;
  error?: string;
  result?: unknown;
}

export class AgentAskError extends Error {
  constructor(
    message: string,
    /** Nobody took the question: SamSync does not run there (or does not know it). */
    readonly unanswered: boolean,
  ) {
    super(message);
    this.name = 'AgentAskError';
  }
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

/** The sender's side: puts the question on the target's share and waits for the answer. */
export async function askAgent<T>(tgt: Transport, ask: AgentAsk, opts: { pickupMs?: number; answerMs?: number; cancelled?: () => boolean } = {}): Promise<T> {
  const id = newId('q-');
  const req = relJoin(ASK_DIR, `${id}.req.json`);
  const ans = relJoin(ASK_DIR, `${id}.ans.json`);
  await tgt.mkdirp(ASK_DIR);
  const tmp = `${req}.${newId()}.tmp`;
  await tgt.writeStream(tmp, Readable.from([Buffer.from(JSON.stringify({ id, at: Date.now(), ask } satisfies AskFile), 'utf8')]));
  await tgt.rename(tmp, req);
  const started = Date.now();
  let pickedAt = 0;
  while (!opts.cancelled?.()) {
    await sleep(pickedAt ? 250 : 150);
    const a = await readJson<AnswerFile>(tgt, ans).catch(() => null);
    if (a?.id === id) {
      await tgt.remove(ans, false).catch(() => undefined);
      if (!a.ok) throw new AgentAskError(a.error || t('Makinedeki SamSync isteği yerine getiremedi'), false);
      return a.result as T;
    }
    if (!pickedAt) {
      if (!(await tgt.stat(req).catch(() => null))) pickedAt = Date.now();
      else if (Date.now() - started > (opts.pickupMs ?? 6000)) {
        await tgt.remove(req, false).catch(() => undefined);
        throw new AgentAskError(t('Makinedeki SamSync isteği almadı (çalışmıyor ya da eski bir sürüm)'), true);
      }
    } else if (Date.now() - pickedAt > (opts.answerMs ?? 60_000)) throw new AgentAskError(t('Makinedeki SamSync zamanında yanıt vermedi'), false);
  }
  await tgt.remove(req, false).catch(() => undefined);
  throw new AgentAskError(t('İptal edildi'), false);
}

/** SamSync on the target: answers the questions waiting in its relay folder. */
export async function answerAsks(localRoot: string, handle: (ask: AgentAsk) => Promise<unknown>, busy: Set<string>): Promise<void> {
  const dir = path.join(localRoot, ...ASK_DIR.split('/'));
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
    void answerOne(dir, id, handle)
      .catch(() => undefined)
      .finally(() => busy.delete(id));
  }
}

async function answerOne(dir: string, id: string, handle: (ask: AgentAsk) => Promise<unknown>): Promise<void> {
  // taking the request away tells the sender it is being worked on
  const work = path.join(dir, `${id}.work`);
  try {
    await fsp.rename(path.join(dir, `${id}.req.json`), work);
  } catch {
    return; // half written, or taken back by the sender
  }
  let f: AskFile;
  try {
    f = JSON.parse(await fsp.readFile(work, 'utf8')) as AskFile;
  } catch {
    await fsp.rm(work, { force: true });
    return;
  }
  let a: AnswerFile;
  try {
    a = { id, ok: true, result: await handle(f.ask) };
  } catch (e) {
    a = { id, ok: false, error: errMessage(e) };
  }
  const ans = path.join(dir, `${id}.ans.json`);
  await fsp.writeFile(`${ans}.tmp`, JSON.stringify(a));
  await fsp.rename(`${ans}.tmp`, ans);
  await fsp.rm(work, { force: true });
}

/** Leftovers of senders that gave up and of answers nobody fetched. */
export async function pruneAsks(localRoot: string, olderThanMs = 3600_000): Promise<void> {
  const dir = path.join(localRoot, ...ASK_DIR.split('/'));
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
