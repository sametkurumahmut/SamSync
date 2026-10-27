import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline, Transform, type Readable } from 'node:stream';
import type { NodeConfig, RunDetail, RunLogLine, RunOpResult, RunSummary, RunTargetState, SendOptions, SendRequest, SrcRef, StashFile } from '../shared/types';
import type { CoreContext } from './context';
import { InUseError, type Transport } from './transport';
import { RelayError, heartbeatFresh, readHeartbeat, signalRelayJob, submitRelayJob, submitRelayPack, waitRelayResult } from './relay';
import { AgentHasher } from './agenthash';
import { DELTA_BLOCK, DELTA_MIN, changedBlocks, patchedStream, type BlockList, type DeltaInfo } from './delta';
import { openPackEntry, packStream, type PackEntry, type PackSource } from './pack';
import type { PackOp, RelayJob } from '../shared/relay';
import { blobStream } from './git';
import { openPlain, openVars } from './template';
import { hashStream, hashing } from './compare';
import { joinRoot, relBase, relDepth, relJoin, relParent } from './paths';
import { RELAY_FOLDER } from '../shared/relay';
import { myLock, otherLock, removeLock, writeLock } from './lock';
import { applyOps, forgetManifestSubtrees, saveManifestSubtree } from './manifest';
import { PART_MAX_AGE_MS } from './scan';
import type { Entry } from './transport';
import os from 'node:os';
import { CancelToken, RateLimiter, errMessage, formatBytes, mapLimit, newId, parseStamp, sleep, stamp, throttle } from './util';
import { t } from '../shared/i18n';

export interface ExecOp {
  id: string;
  kind: 'copy' | 'delete' | 'mkdir';
  rel: string;
  isDir: boolean;
  size: number;
  mtimeMs?: number;
  src?: SrcRef;
  replaceType?: boolean;
  /** Whether the target held something at this path when the plan was made (false lets the run skip a look). */
  dstExists?: boolean;
  /**
   * A folder to remove only once it is empty: what the scan saw in it goes as ops of their own, and what the filter
   * left out (an excluded or ignored file) keeps the folder where it is.
   */
  onlyIfEmpty?: boolean;
}

export interface ExecGroup {
  key: string;
  title: string;
  rootLabel: string;
  open: () => Promise<Transport>;
  ops: ExecOp[];
  node?: NodeConfig;
  /** Transports a sync op may read from (key -> transport opener). */
  endpoints?: Record<string, () => Promise<Transport>>;
  /** This target's own backup choice; the run setting applies when it is not given. */
  backup?: boolean;
  /** A local folder side of a sync job that sends replaced and deleted items to the operating system's trash. */
  trash?: (absPath: string) => Promise<void>;
  /** This target is a relay: once its own copy is done, the job goes to it and these machines get the files from it. */
  relay?: { targets: NodeConfig[]; job: RelayJob };
  /** What the plan saw below each sent folder on this target: the run leaves it, updated, as the target's manifest. */
  manifest?: Map<string, Map<string, Entry>>;
  /** The exclusions the manifest's entries were taken with (manifest.ts exclusionsOf). */
  manifestExcluded?: string[];
  /** A relay: the files it keeps aside for the machines behind it (machine folder, raw templates), carried in its pack. */
  stash?: StashFile[];
  /** SamSync's temporary files that copies cut short left here (the plan found them): removed once the run is done. */
  cleanup?: string[];
}

export interface ExecSettings {
  label: string;
  origin: SendRequest['origin'];
  dryRun: boolean;
  backup: boolean;
  backupKeep: number;
  /** Backup folders older than this many days go too, after a successful run (0 or undefined = no age limit). */
  backupMaxDays?: number;
  backupFolderName: string;
  verify: boolean;
  retryCount: number;
  waitSeconds: number;
  parallelGroups: number;
  parallelFiles: number;
  /** Runs before the first file goes to a target; a non-zero exit skips that target. */
  preCommand?: string;
  postCommand?: string;
  /** A failing post-copy command marks the target as failed. */
  postCommandFails?: boolean;
  postCommandTimeoutSeconds: number;
  /** Per target transfer limit in MB/s; 0 or undefined = unlimited. */
  bandwidthMBps?: number;
  /** The run waits for this before the first machine is started (another run writing to the same machines). */
  waitFor?: Promise<void>;
  /** A file a program holds open is tried once more after everything else for that target. */
  retryInUseAtEnd?: boolean;
  /** Relay: how long it may take to pick a job up, and to finish it. */
  relayAckMs?: number;
  relayDoneMs?: number;
  /** After a cancel, how long to wait for a relay to say what it had done (tests shorten it). */
  relayCancelGraceMs?: number;
  sources: string[];
  /** Where the sources outside every local root went on the targets, by path (Send again puts them there again). */
  sourceRels?: Record<string, string>;
  /** Last source item and its target relative path: {source} and {destination} of the post-copy command. */
  postSource?: { path: string; rel: string };
  targetIds: string[];
  options?: Partial<SendOptions>;
}

export interface RunHandle {
  id: string;
  cancel: CancelToken;
  done: Promise<RunDetail>;
  /** Holds the run between files (and inside a streamed copy) until resumed; the targets keep their state. */
  pause(on: boolean): void;
  readonly paused: boolean;
  /** Stops one target only: its remaining operations are skipped, the other targets go on. */
  cancelTarget(key: string): void;
}

const TMP_SUFFIX = '.samsync-tmp';
/** Files at least this big are checked for being in use on the target before they are carried over. */
const IN_USE_CHECK_MIN = 1024 * 1024;
/** A file held open is tried again at the end of the run no sooner than this after it was first found in use. */
const IN_USE_RETRY_WAIT_MS = 5000;
/**
 * Files at least this big are written under a fixed temporary name, so a copy that broke off (cancel, a dropped
 * link, the app closed) continues from where it stopped the next time instead of starting over.
 */
export const RESUME_MIN = 8 * 1024 * 1024;
/** The target's tail that is compared with the source before a partial file is continued. */
const RESUME_TAIL = 256 * 1024;
/** A partial file nobody continued for this long is thrown away (a scan reports it as a leftover then). */
const RESUME_MAX_AGE_MS = PART_MAX_AGE_MS;
/** Local files at least this big are streamed (and hashed on the way) instead of copied by the OS, when a hash cache is on. */
const HASH_WHILE_COPY_MIN = 256 * 1024;
/** A run keeps this many of its latest log lines in memory once the rest went to its log file. */
const LOG_KEEP = 2000;

/** The name carries when the copy started, so a later scan can tell one a dropped link left behind (scan.ts staleTemp). */
function tmpRelFor(rel: string): string {
  const parent = relParent(rel);
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return relJoin(parent, `.${relBase(rel)}.${Date.now().toString(36)}-${rand}${TMP_SUFFIX}`);
}
/**
 * The partial file of a big copy, named after the source version it holds the start of (size and time): a source
 * changed since (even in place, same size) gets a partial of its own instead of a mix of old and new bytes.
 */
export function partRelFor(rel: string, size: number, mtimeMs = 0): string {
  return relJoin(relParent(rel), `.${relBase(rel)}.resume-${size}-${Math.floor(mtimeMs)}${TMP_SUFFIX}`);
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks);
}

/** True when the last bytes of the partial file on the target are the same bytes of the source, so it is a prefix of it. */
async function tailMatches(srcAbs: string, tgt: Transport, partRel: string, partSize: number): Promise<boolean> {
  const start = Math.max(0, partSize - RESUME_TAIL);
  const range = { start, end: partSize - 1 };
  const [a, b] = await Promise.all([readAll(fs.createReadStream(srcAbs, range)), readAll(await tgt.readStream(partRel, range))]);
  return a.length === partSize - start && a.equals(b);
}

export function startRun(ctx: CoreContext, groups: ExecGroup[], s: ExecSettings): RunHandle {
  const id = newId('run-');
  const cancel = new CancelToken();
  const runStamp = stamp();
  const startedAt = Date.now();
  const states: RunTargetState[] = [];
  /** group key -> the states of the machines that get the files from that relay */
  const relayed = new Map<string, RunTargetState[]>();
  for (const g of groups) {
    states.push({
      key: g.key,
      title: g.title,
      root: g.rootLabel,
      total: g.ops.length,
      done: 0,
      failed: 0,
      bytesTotal: g.ops.filter((o) => o.kind === 'copy').reduce((a, o) => a + o.size, 0),
      bytesDone: 0,
      status: 'queued',
    });
    if (g.relay) {
      // the same work again on each relayed machine, done by the relay; the counts come with its result
      const list = g.relay.targets.map((n): RunTargetState => ({ key: n.id, title: n.name, root: t('{relay} üzerinden', { relay: g.title }), total: g.ops.length, done: 0, failed: 0, bytesTotal: 0, bytesDone: 0, status: 'queued', via: g.key }));
      relayed.set(g.key, list);
      states.push(...list);
    }
  }
  const results: RunOpResult[] = [];
  const logLines: RunLogLine[] = [];
  let pendingLog: RunLogLine[] = [];

  // pause: operations wait here before they start, streamed copies between chunks; cancel lets them through
  let paused = false;
  const pauseWaiters: (() => void)[] = [];
  const holdWhilePaused = async () => {
    while (paused && !cancel.cancelled) await new Promise<void>((r) => pauseWaiters.push(r));
  };
  const release = () => {
    for (const w of pauseWaiters.splice(0)) w();
  };
  cancel.onCancel(release);
  /** group key -> the relay job it waits for: the run's pause goes on to it */
  const relayWaits = new Map<string, { tgt: Transport; id: string }>();
  // each target has a token of its own, tripped by the run's cancel too, so one machine can be dropped from a run
  const groupCancel = new Map<string, CancelToken>();
  for (const g of groups) {
    const gc = new CancelToken();
    cancel.onCancel(() => gc.cancel());
    groupCancel.set(g.key, gc);
  }

  const summary = (): RunSummary => {
    const failed = results.filter((r) => !r.ok).length;
    return {
      id,
      label: s.label,
      origin: s.origin,
      startedAt,
      status: 'running',
      dryRun: s.dryRun,
      targets: states.map((x) => ({ ...x })),
      opsTotal: groups.reduce((a, g) => a + g.ops.length, 0),
      opsOk: results.length - failed,
      opsFailed: failed,
      bytes: states.reduce((a, x) => a + x.bytesDone, 0),
      sources: s.sources,
      sourceRels: s.sourceRels,
      targetIds: s.targetIds,
      options: s.options,
      paused: paused || undefined,
      inUseFailed: results.filter((r) => !r.ok && r.inUse).length || undefined,
    };
  };

  const emitProgress = throttle(() => ctx.emit({ type: 'run-progress', runId: id, targets: states.map((x) => ({ ...x })) }), 150);
  // the lines go to the run's log file as they come; memory keeps only the tail of a big run
  const sink = ctx.runLog?.(id);
  const emitLog = throttle(() => {
    if (!pendingLog.length) return;
    const lines = pendingLog;
    pendingLog = [];
    sink?.write(lines);
    ctx.emit({ type: 'run-log', runId: id, lines });
  }, 200);
  const log = (level: RunLogLine['level'], message: string, key?: string) => {
    const line: RunLogLine = { t: Date.now(), level, message, key };
    logLines.push(line);
    if (sink && logLines.length > LOG_KEEP * 1.5) logLines.splice(0, logLines.length - LOG_KEEP);
    pendingLog.push(line);
    const comp = t('Kopyala');
    const msg = key ? `[${key}] ${message}` : message;
    if (level === 'error') ctx.log.error(comp, msg);
    else if (level === 'warn') ctx.log.warn(comp, msg);
    else ctx.log.info(comp, msg);
    emitLog();
  };

  // a cancel stops copies in flight at once; what a relay does by then comes back with its answer
  cancel.onCancel(() => log('warn', t('İptal istendi; süren işler durduruluyor')));

  const done = (async (): Promise<RunDetail> => {
    ctx.emit({ type: 'run-start', run: summary() });
    const startParams = { label: s.label, targets: groups.length, ops: summary().opsTotal };
    log(
      'info',
      s.dryRun
        ? t('{label} başladı: {targets} hedef, {ops} işlem (deneme çalıştırması, hiçbir şey yazılmayacak)', startParams)
        : t('{label} başladı: {targets} hedef, {ops} işlem', startParams),
    );
    if (s.waitFor) {
      log('info', t('Sırada: aynı makinelere giden önceki gönderim bitince başlayacak'));
      await Promise.race([s.waitFor, new Promise<void>((r) => cancel.onCancel(r))]);
      if (!cancel.cancelled) log('info', t('Sıra geldi; başlıyor'));
    }
    await mapLimit(groups, Math.max(1, s.parallelGroups), (g) => runGroup(g, states.find((x) => x.key === g.key && !x.via)!));
    emitProgress.flush();
    emitLog.flush();
    const sum = summary();
    // a target the user dropped from the run counts like a failed one: the run did not do all it set out to do
    const anyFailed = states.some((x) => x.status === 'failed' || x.status === 'partial' || x.status === 'cancelled');
    const allFailed = states.length > 0 && states.every((x) => x.status === 'failed');
    sum.status = cancel.cancelled ? 'cancelled' : allFailed ? 'failed' : anyFailed ? 'partial' : 'ok';
    sum.finishedAt = Date.now();
    const secs = ((sum.finishedAt - startedAt) / 1000).toFixed(1);
    log(
      sum.status === 'ok' ? 'ok' : sum.status === 'cancelled' ? 'warn' : 'error',
      t('Bitti: {ok} başarılı, {failed} hatalı, {size}, {s} sn', { ok: sum.opsOk, failed: sum.opsFailed, size: formatBytes(sum.bytes), s: secs }),
    );
    emitLog.flush();
    await sink?.close();
    const detail: RunDetail = { ...sum, results, log: logLines };
    ctx.emit({ type: 'run-done', run: sum });
    return detail;
  })();

  async function runGroup(g: ExecGroup, st: RunTargetState) {
    const gc = groupCancel.get(g.key)!;
    await holdWhilePaused();
    if (gc.cancelled) {
      st.status = 'cancelled';
      st.finishedAt = Date.now();
      emitProgress();
      return;
    }
    st.status = 'running';
    st.startedAt = Date.now();
    emitProgress();
    let tgt: Transport;
    try {
      tgt = await g.open();
    } catch (e) {
      st.status = 'failed';
      st.error = errMessage(e);
      st.finishedAt = Date.now();
      log('error', t('Hedefe bağlanılamadı: {error}', { error: st.error }), g.key);
      for (const op of g.ops) results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok: false, error: st.error });
      st.failed = g.ops.length;
      failRelayed(g, t('Röle {name} erişilemedi', { name: g.title }));
      emitProgress();
      return;
    }
    const endpointCache = new Map<string, Promise<Transport>>();
    const endpoint = (key: string) => {
      if (!endpointCache.has(key)) {
        const opener = g.endpoints?.[key];
        if (!opener) throw new Error(t('Kaynak uç bulunamadı: {key}', { key }));
        endpointCache.set(key, opener());
      }
      return endpointCache.get(key)!;
    };

    // say who writes here; a fresh lock of someone else is a warning, not a stop (the review said it too)
    const lock = myLock(s.label, ctx.appVersion);
    if (tgt.kind === 'fs' && !s.dryRun) {
      const other = await otherLock(tgt, lock).catch(() => null);
      if (other) log('warn', t('{user} ({host}) burada {label} gönderimini sürdürüyor; iki gönderim aynı dosyalara yazabilir', { user: other.user, host: other.host, label: other.label }), g.key);
      await writeLock(tgt, lock).catch((e) => log('warn', t('Kilit yazılamadı: {error}', { error: errMessage(e) }), g.key));
    }
    const backupBase = relJoin(s.backupFolderName, runStamp);
    const backup = g.backup ?? s.backup;
    let backedUpAny = false;
    let trashed = 0;
    let trashFailed = false;
    const groupParams = { root: g.rootLabel, n: g.ops.length };
    log('info', backup ? t('→ {root} ({n} işlem, yedekli)', groupParams) : t('→ {root} ({n} işlem)', groupParams), g.key);

    const record = (op: ExecOp, ok: boolean, error?: string, backedUp?: boolean, inUse?: boolean) => {
      results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok, error, backedUp, inUse: inUse || undefined, created: (ok && op.kind === 'copy' && op.dstExists === false) || undefined });
      st.done++;
      if (!ok) {
        st.failed++;
        log('error', `${opLabel(op)} ${op.rel}: ${error}`, g.key);
      }
      emitProgress();
    };

    /** Moves the current item to the trash or into the backup folder; true when it was kept one of these ways. */
    const keepOld = async (rel: string): Promise<boolean> => {
      if (g.trash && tgt.localPath && !trashFailed) {
        try {
          await g.trash(tgt.localPath(rel));
          trashed++;
          return true;
        } catch (e) {
          // no trash here (a network drive, a system without one): the versioning folder keeps it instead
          trashFailed = true;
          log('warn', t('Geri dönüşüm kutusu kullanılamadı ({error}); eski hâller yedek klasörüne taşınacak.', { error: errMessage(e) }), g.key);
        }
      }
      if (!backup) return false;
      await moveInto(tgt, rel, relJoin(backupBase, rel));
      backedUpAny = true;
      return true;
    };

    /** Nothing keeps the old file: no backup, no trash. Then a plain remove or a rename over it is enough. */
    const nothingToKeep = !backup && !g.trash;

    const backupOrRemove = async (rel: string, isDir: boolean): Promise<boolean> => {
      if (nothingToKeep) {
        // a missing path is not an error for remove, so no look first; a folder where the plan saw a file is
        try {
          await tgt.remove(rel, isDir);
          return false;
        } catch (e) {
          const cur = await tgt.stat(rel);
          if (!cur) return false;
          if (cur.isDir === isDir) throw e;
          await tgt.remove(rel, cur.isDir);
          return false;
        }
      }
      const cur = await tgt.stat(rel);
      if (!cur) return false;
      if (await keepOld(rel)) return true;
      await tgt.remove(rel, cur.isDir || isDir);
      return false;
    };

    const limiter = s.bandwidthMBps && s.bandwidthMBps > 0 ? new RateLimiter(s.bandwidthMBps * 1024 * 1024) : null;
    /** The source through the bandwidth limit (when set) and the pause gate: a paused run stops mid-file, not after it. */
    const limited = (src: Readable): Readable => {
      let out = src;
      if (limiter) {
        const t2 = limiter.transform();
        out.on('error', (e) => t2.destroy(e));
        out = out.pipe(t2);
      }
      const gate = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          if (!paused) cb(null, chunk);
          else void holdWhilePaused().then(() => cb(null, chunk));
        },
      });
      out.on('error', (e) => gate.destroy(e));
      return out.pipe(gate);
    };

    const openSource = async (op: ExecOp): Promise<Readable> => {
      const src = op.src!;
      if (src.kind === 'fs') return fs.createReadStream(src.abs, { highWaterMark: limiter ? 256 * 1024 : 1024 * 1024 });
      if (src.kind === 'git') return blobStream(src.repo, src.rev, src.path);
      if (src.kind === 'pack') return openPackEntry(src.file, src);
      if (src.kind === 'patch') return patchedStream(openPackEntry(src.file, src), src.base, src.size, src);
      if (src.kind === 'vars') return openVars(src);
      const et = await endpoint(src.key);
      return et.readStream(src.rel);
    };

    const dropOtherPartials = async (rel: string, keep: string) => {
      const prefix = `.${relBase(rel)}.resume`;
      for (const e of await tgt.list(relParent(rel)).catch(() => [])) {
        const name = relBase(e.rel);
        if (!e.isDir && name.startsWith(prefix) && name.endsWith(TMP_SUFFIX) && name !== relBase(keep)) await tgt.remove(relJoin(relParent(rel), name), false).catch(() => undefined);
      }
    };

    /** A partial file from an earlier attempt that can be continued: its size, or 0 to start from the beginning. */
    const resumePoint = async (op: ExecOp, partRel: string): Promise<number> => {
      const src = op.src!;
      const part = await tgt.stat(partRel).catch(() => null);
      if (!part) return 0;
      const usable = !part.isDir && part.size > 0 && part.size < op.size && src.kind === 'fs' && !!tgt.appendStream && Date.now() - part.mtimeMs < RESUME_MAX_AGE_MS;
      if (usable && (await tailMatches(src.abs as string, tgt, partRel, part.size).catch(() => false))) return part.size;
      await tgt.remove(partRel, false).catch(() => undefined);
      return 0;
    };

    /** Stage and switch: copies written next to their places, waiting to go in together (see switchStaged). */
    const switching = !!s.options?.stageSwitch && !s.dryRun && !g.trash;
    const staged: { op: ExecOp; tmp: string; hashed: { digest: () => string } | null; mtime?: number }[] = [];

    const doCopy = async (op: ExecOp, stage?: typeof staged): Promise<boolean> => {
      const big = op.size >= RESUME_MIN;
      const tmp = big ? partRelFor(op.rel, op.size, op.mtimeMs) : tmpRelFor(op.rel);
      // partials of other versions of this file (older sources, an older SamSync) can never be continued
      if (big && !s.dryRun) await dropOtherPartials(op.rel, tmp);
      let base = 0;
      const onProgress = (n: number) => {
        st.bytesDone += n - base;
        base = n;
        st.current = op.rel;
        emitProgress();
      };
      // the partial file is kept only when the copy itself broke off, not when what was written turned out wrong
      let keepPartial = false;
      try {
        const src = op.src!;
        const mtime = op.mtimeMs ?? (src.kind === 'git' ? Date.now() : undefined);
        // a big file that a program on the target holds open would fail at the rename, after the whole copy
        // (staged copies are checked all together, right before the switch)
        if (!stage && op.dstExists && op.size >= IN_USE_CHECK_MIN && tgt.checkReplaceable) await tgt.checkReplaceable(op.rel);
        const from = big ? await resumePoint(op, tmp) : 0;
        // the writer reports what it wrote; a file that changed size since the plan is caught here
        let written: number;
        keepPartial = big;
        const signal = gc.signal;
        const finalMtime = mtime ?? (src.kind === 'fs' ? fs.statSync(src.abs).mtimeMs : undefined);
        // a send compared by content hashes the bytes on their way through (streamed copies of the bigger files),
        // so the next content comparison can skip the read; other sends keep the operating system's copy
        const hashOnCopy = !!ctx.hashCache && s.options?.compare === 'content' && op.size >= HASH_WHILE_COPY_MIN;
        let hashed: { digest: () => string } | null = null;
        if (from > 0 && src.kind === 'fs') {
          log('info', t('{path}: kaldığı yerden sürüyor ({done} / {size})', { path: op.rel, done: formatBytes(from), size: formatBytes(op.size) }), g.key);
          onProgress(from);
          const rest = fs.createReadStream(src.abs, { start: from, highWaterMark: limiter ? 256 * 1024 : 1024 * 1024 });
          written = await tgt.appendStream!(tmp, limited(rest), { mtimeMs: finalMtime, onProgress, signal });
        } else if (src.kind === 'fs' && tgt.copyFromLocal && !limiter && !hashOnCopy && !paused) written = await tgt.copyFromLocal(src.abs, tmp, { mtimeMs: mtime, onProgress, signal });
        else {
          const h = hashOnCopy ? hashing() : null;
          hashed = h;
          const data = limited(await openSource(op));
          written = await tgt.writeStream(tmp, h ? data.pipe(h.stream) : data, { mtimeMs: finalMtime, onProgress, signal });
        }
        keepPartial = false;
        if (written !== op.size) throw new Error(t('Boyut tutmuyor: {written} ≠ {expected}', { written, expected: op.size }));
        if (s.verify) {
          const [a, b] = await Promise.all([hashStream(await openSource(op)), hashStream(await tgt.readStream(tmp))]);
          if (a !== b) throw new Error(t('Doğrulama başarısız: içerik özeti tutmuyor'));
          hashed = { digest: () => a };
        }
        if (stage) {
          stage.push({ op, tmp, hashed, mtime: finalMtime });
          return false;
        }
        const backedUp = await backupOrRemoveForReplace(op);
        await tgt.rename(tmp, op.rel);
        if (hashed && ctx.hashCache && finalMtime != null) ctx.hashCache.set(tgt.root, op.rel, op.size, finalMtime, hashed.digest());
        return backedUp;
      } catch (e) {
        st.bytesDone -= base;
        if (!keepPartial || e instanceof InUseError) await tgt.remove(tmp, false).catch(() => undefined);
        throw e;
      }
    };

    /**
     * A file a program on the target holds open cannot be replaced; when it already holds exactly what would be
     * written (copied earlier without its date, so the time comparison keeps picking it), only its date is
     * aligned, and the item counts as done rather than failed. False when the content differs or nothing is known.
     */
    const alignInUse = async (op: ExecOp): Promise<boolean> => {
      if (op.kind !== 'copy' || !op.src || s.dryRun) return false;
      const cur = await tgt.stat(op.rel);
      if (!cur || cur.isDir || cur.size !== op.size) return false;
      const [a, b] = await Promise.all([hashStream(await openSource(op)), hashStream(await tgt.readStream(op.rel))]);
      if (a !== b) return false;
      const mtime = op.mtimeMs ?? (op.src.kind === 'fs' ? fs.statSync(op.src.abs).mtimeMs : undefined);
      if (mtime == null) return false;
      await tgt.setMtime(op.rel, mtime);
      ctx.hashCache?.set(tgt.root, op.rel, op.size, mtime, a);
      st.bytesDone += op.size;
      st.current = op.rel;
      log('info', t('{path}: dosya kullanımda ama içeriği zaten aynı; yalnızca tarihi eşitlendi', { path: op.rel }), g.key);
      return true;
    };

    const backupOrRemoveForReplace = async (op: ExecOp): Promise<boolean> => {
      // a file is replaced by the rename itself; only something to keep, or a folder in the way, needs a look first
      if (!op.replaceType && (nothingToKeep || op.dstExists === false)) return false;
      const cur = await tgt.stat(op.rel);
      if (!cur) return false;
      if (cur.isDir || op.replaceType) return backupOrRemove(op.rel, cur.isDir);
      return keepOld(op.rel); // otherwise the rename replaces it
    };

    /** Puts every staged copy in its place, after checking that none is held open; when one did not come, none goes in. */
    const switchStaged = async (deletes: ExecOp[]): Promise<boolean> => {
      const abort = async (why: string, held = new Set<string>()) => {
        for (const x of staged.splice(0)) {
          await tgt.remove(x.tmp, false).catch(() => undefined);
          record(x.op, false, why, undefined, held.has(x.op.id));
        }
        for (const op of deletes) record(op, false, why);
        log('error', why, g.key);
        return false;
      };
      if (gc.cancelled) return abort(t('İptal edildi; bu makinede hiçbir dosya değiştirilmedi'));
      if (st.failed > 0) return abort(t('Hazırlık tamamlanmadı; bu makinede hiçbir dosya değiştirilmedi'));
      // a program holding a file would stop the switch halfway: all of them are looked at before the first goes in
      if (tgt.checkReplaceable) {
        const busy = new Set<string>();
        await mapLimit(
          staged.filter((x) => x.op.dstExists),
          8,
          async (x) => {
            try {
              await tgt.checkReplaceable!(x.op.rel);
            } catch (e) {
              if (e instanceof InUseError) busy.add(x.op.id);
            }
          },
        );
        if (busy.size) return abort(t('{n} dosya kullanımda; bu makinede hiçbir dosya değiştirilmedi', { n: busy.size }), busy);
      }
      if (!staged.length) return true;
      const t0 = Date.now();
      log('info', t('{n} dosya hazır; hepsi birden yerine konuyor', { n: staged.length }), g.key);
      await mapLimit(staged.splice(0), s.parallelFiles, async (x) => {
        try {
          const backedUp = await backupOrRemoveForReplace(x.op);
          await tgt.rename(x.tmp, x.op.rel);
          if (x.hashed && ctx.hashCache && x.mtime != null) ctx.hashCache.set(tgt.root, x.op.rel, x.op.size, x.mtime, x.hashed.digest());
          record(x.op, true, undefined, backedUp);
        } catch (e) {
          await tgt.remove(x.tmp, false).catch(() => undefined);
          record(x.op, false, errMessage(e), undefined, e instanceof InUseError);
        }
      });
      log('info', t('Değiştirme {ms} ms sürdü', { ms: Date.now() - t0 }), g.key);
      return true;
    };

    // files a program held open, tried once more at the end when asked for: the program may have let go by then
    const held: ExecOp[] = [];
    let heldAt = 0;
    /** Folders not removed because files the filter left out are still in them. */
    const kept: string[] = [];
    const runOp = async (op: ExecOp, _index?: number, last = false) => {
      await holdWhilePaused();
      if (gc.cancelled) return;
      if (s.dryRun) {
        if (op.kind === 'copy') st.bytesDone += op.size;
        record(op, true);
        return;
      }
      let lastErr: unknown;
      let inUse = false;
      // across attempts: an attempt that moved the old file to the backup and then failed has still kept it
      let backedUp = false;
      for (let attempt = 0; attempt <= s.retryCount; attempt++) {
        await holdWhilePaused();
        if (gc.cancelled) return;
        try {
          if (op.kind === 'copy' && switching) {
            // written beside its place; it is recorded when the switch puts it in
            await doCopy(op, staged);
            return;
          }
          if (op.kind === 'copy') backedUp = (await doCopy(op)) || backedUp;
          else if (op.kind === 'mkdir') {
            if (op.dstExists !== false || op.replaceType) {
              const cur = await tgt.stat(op.rel);
              if (cur && !cur.isDir) backedUp = (await backupOrRemove(op.rel, false)) || backedUp;
            }
            await tgt.mkdirp(op.rel);
          } else if (op.isDir && op.onlyIfEmpty && (await tgt.list(op.rel).catch(() => [])).length) {
            kept.push(op.rel);
            record(op, true);
            return;
          } else backedUp = (await backupOrRemove(op.rel, op.isDir)) || backedUp;
          record(op, true, undefined, backedUp);
          return;
        } catch (e) {
          lastErr = e;
          // a file in use stays in use for the retry period: say so at once, unless it is the same file already
          if (e instanceof InUseError) {
            if (await alignInUse(op).catch(() => false)) {
              record(op, true, undefined, backedUp);
              return;
            }
            if (s.retryInUseAtEnd && !last) {
              if (!held.length) heldAt = Date.now();
              held.push(op);
              log('warn', t('{path}: kullanımda; sonda bir kez daha denenecek', { path: op.rel }), g.key);
              return;
            }
            inUse = true;
            break;
          }
          if (attempt < s.retryCount && !gc.cancelled) {
            log('warn', t('{path}: {error} — yeniden denenecek ({attempt}/{max})', { path: op.rel, error: errMessage(e), attempt: attempt + 1, max: s.retryCount }), g.key);
            await sleep(s.waitSeconds * 1000);
          }
        }
      }
      record(op, false, errMessage(lastErr), undefined, inUse);
    };

    try {
      if (g.relay && tgt.kind === 'fs' && !s.dryRun) {
        // a machine running SamSync takes the changes as one compressed pack and applies them itself
        await runPacked(g, st, tgt);
        return;
      }
      // the pre-copy command (stop the program that holds the files, say): when it fails, nothing is written here
      if (!s.dryRun && s.preCommand && g.node && g.ops.length) {
        const { ok } = await runHook(t('Öncesi komut'), s.preCommand, s.postCommandTimeoutSeconds, g, tgt, s.postSource, (lvl, m) => log(lvl, m, g.key));
        if (!ok) {
          for (const op of g.ops) record(op, false, t('Öncesi komut başarısız; bu makineye yazılmadı'));
          st.status = 'failed';
          return;
        }
      }
      const mkdirs = g.ops.filter((o) => o.kind === 'mkdir').sort((a, b) => relDepth(a.rel) - relDepth(b.rel));
      const copies = g.ops.filter((o) => o.kind === 'copy').sort((a, b) => b.size - a.size);
      const deletes = g.ops.filter((o) => o.kind === 'delete');
      const delFiles = deletes.filter((o) => !o.isDir);
      const delDirs = deletes.filter((o) => o.isDir).sort((a, b) => relDepth(b.rel) - relDepth(a.rel));

      // parents first: one depth level at a time
      const levels = new Map<number, ExecOp[]>();
      for (const m of mkdirs) levels.set(relDepth(m.rel), [...(levels.get(relDepth(m.rel)) ?? []), m]);
      for (const lvl of [...levels.keys()].sort((a, b) => a - b)) await mapLimit(levels.get(lvl)!, s.parallelFiles, runOp);
      // folders the plan saw on the target need no look before the first file goes into them
      if (tgt.assumeDir) for (const op of copies) if (op.dstExists) tgt.assumeDir(relParent(op.rel));
      await mapLimit(copies, s.parallelFiles, runOp);
      // stage and switch: everything came, so everything goes in now (and only then are things deleted); else nothing
      if (switching && !(await switchStaged(deletes))) {
        /* the live folder stays as it was */
      } else {
        await mapLimit(delFiles, s.parallelFiles, runOp);
        for (const d of delDirs) await runOp(d);
        if (kept.length) log('info', t('{n} klasör, içinde filtrenin dışarıda bıraktığı dosyalar olduğu için yerinde kaldı: {dirs}', { n: kept.length, dirs: kept.slice(0, 5).join(', ') + (kept.length > 5 ? '…' : '') }), g.key);
      }
      if (held.length && !gc.cancelled) {
        await sleep(Math.max(0, heldAt + IN_USE_RETRY_WAIT_MS - Date.now()));
        log('info', t('{n} kullanımdaki dosya bir kez daha deneniyor', { n: held.length }), g.key);
        for (const op of held.splice(0)) await runOp(op, 0, true);
      }

      // what this run wrote and no manifest of its own describes: the manifest there no longer does either
      const forget = async () => {
        if (s.dryRun || tgt.kind !== 'fs') return;
        const wrote = results.filter((r) => r.key === g.key && r.ok).map((r) => r.rel);
        await forgetManifestSubtrees(tgt, wrote).catch((e) => log('warn', t('Manifest güncellenemedi: {error}', { error: errMessage(e) }), g.key));
      };
      if (gc.cancelled) {
        st.status = 'cancelled';
        log('warn', t('İptal edildi'), g.key);
        await forget();
      } else {
        st.status = st.failed === 0 ? 'ok' : st.failed === g.ops.length ? 'failed' : 'partial';
        if (g.manifest?.size && tgt.kind === 'fs' && !s.dryRun && st.status !== 'failed') await leaveManifest(g, tgt);
        else await forget();
        if (g.cleanup?.length && !s.dryRun) {
          let gone = 0;
          for (const rel of g.cleanup) if (await tgt.remove(rel, false).then(() => true, () => false)) gone++;
          if (gone) log('info', t('Yarım kalmış kopyalardan {n} geçici dosya silindi', { n: gone }), g.key);
        }
        if (trashed) log('info', t('{n} eski hâl geri dönüşüm kutusuna taşındı', { n: trashed }), g.key);
        if (backedUpAny) {
          st.backupPath = relJoin(s.backupFolderName, runStamp);
          log('info', t('Eski hâller yedeklendi: {path}', { path: st.backupPath }), g.key);
        }
        // an age limit also clears versions on a side that kept nothing new this time
        const byAge = !!s.backupMaxDays && s.backupMaxDays > 0 && backup && !s.dryRun && st.status === 'ok';
        // an undo keeps every backup: going back several sends needs the older sends' backups after this one
        if ((backedUpAny || byAge) && s.origin !== 'restore') {
          // the copies are done: an unreadable backup folder is worth a warning, not a failed run
          await pruneBackups(tgt, s.backupFolderName, s.backupKeep, (m) => log('info', m, g.key), s.backupMaxDays).catch((e) =>
            log('warn', t('Eski yedekler temizlenemedi: {error}', { error: errMessage(e) }), g.key),
          );
        }
        const ok = g.ops.length - st.failed;
        const doneParams = { ok, n: g.ops.length };
        const doneMsg =
          st.status === 'ok'
            ? s.dryRun
              ? t('Başarılı: {ok}/{n} işlem (deneme)', doneParams)
              : t('Başarılı: {ok}/{n} işlem', doneParams)
            : s.dryRun
              ? t('Hatalı: {ok}/{n} işlem (deneme)', doneParams)
              : t('Hatalı: {ok}/{n} işlem', doneParams);
        log(st.status === 'ok' ? 'ok' : 'error', doneMsg, g.key);
        // how fast this machine took the data: a slow one stands out in the log and in the history
        const took = Date.now() - (st.startedAt ?? startedAt);
        if (st.bytesDone > 0 && took >= 500 && !s.dryRun) log('info', t('{size} • {s} sn • {speed}/sn', { size: formatBytes(st.bytesDone), s: (took / 1000).toFixed(1), speed: formatBytes((st.bytesDone / took) * 1000) }), g.key);
        if (st.status === 'ok' && !s.dryRun && s.postCommand && g.node) {
          const r = await runHook(t('Sonrası komut'), s.postCommand, s.postCommandTimeoutSeconds, g, tgt, s.postSource, (lvl, m) => log(lvl, m, g.key));
          st.check = { label: t('Sonrası komut'), ok: r.ok, code: r.code, output: r.output };
          // the command as a health check of the machine: when it says no, the machine did not get a working release
          if (!r.ok && s.postCommandFails) {
            st.status = 'failed';
            st.error = t('Sonrası komut başarısız (kod {code})', { code: String(r.code) });
          }
        }
        if (g.relay) {
          if (s.dryRun) for (const r of relayed.get(g.key) ?? []) Object.assign(r, { status: 'ok', done: r.total, startedAt: Date.now(), finishedAt: Date.now() });
          else if (st.status === 'ok') await runRelay(g, tgt);
          else failRelayed(g, t('Röle {name} üzerindeki kopya tamamlanmadı; dağıtım yapılmadı', { name: g.title }));
        }
      }
    } catch (e) {
      st.status = 'failed';
      st.error = errMessage(e);
      log('error', st.error, g.key);
      failRelayed(g, st.error);
    } finally {
      st.current = undefined;
      st.finishedAt = Date.now();
      emitProgress();
      if (tgt.kind === 'fs' && !s.dryRun) await removeLock(tgt, lock).catch(() => undefined);
      await tgt.close().catch(() => undefined);
      for (const p of endpointCache.values()) await p.then((x) => x.close()).catch(() => undefined);
    }
  }

  /** The target's manifest after this run: what the plan saw, with the operations that succeeded applied. */
  async function leaveManifest(g: ExecGroup, tgt: Transport) {
    const okIds = new Set(results.filter((r) => r.key === g.key && r.ok).map((r) => r.opId));
    const done = g.ops.filter((op) => okIds.has(op.id));
    const by = { host: os.hostname(), user: process.env.USERNAME || undefined, version: ctx.appVersion };
    for (const [rel, scanned] of g.manifest!) {
      try {
        await saveManifestSubtree(tgt, rel, applyOps(scanned, rel, done), by, s.label, g.manifestExcluded);
      } catch (e) {
        log('warn', t('Manifest yazılamadı ({path}): {error}', { path: rel || '/', error: errMessage(e) }), g.key);
      }
    }
  }

  /** The machines behind a relay get no files when the relay's own copy did not happen. */
  function failRelayed(g: ExecGroup, why: string) {
    for (const r of relayed.get(g.key) ?? []) {
      if (r.status !== 'queued') continue;
      Object.assign(r, { status: 'failed', error: why, failed: r.total, done: r.total, startedAt: Date.now(), finishedAt: Date.now() });
    }
  }

  /**
   * The changes for a machine that runs SamSync go to it as one compressed pack with the job; it applies
   * them to its own disk and reports back, then sends on to the machines behind it, if any. One stream over
   * the network instead of a few round trips per file, and about half the bytes for programs and text.
   */
  async function runPacked(g: ExecGroup, st: RunTargetState, tgt: Transport) {
    const job = g.relay!.job;
    const copies = g.ops.filter((o) => o.kind === 'copy' && o.src && o.src.kind !== 'endpoint');
    // big files already there go as the blocks that differ, when SamSync on the target applies block deltas
    const deltas = new Map<string, { list: BlockList; out: { info?: DeltaInfo; size: number; sent: number } }>();
    const big = copies.filter((o) => o.dstExists && !o.replaceType && o.size >= DELTA_MIN && o.src!.kind === 'fs');
    if (big.length) {
      const beat = await readHeartbeat(tgt).catch(() => null);
      if (beat?.blocks && heartbeatFresh(beat)) {
        log('info', t('{n} büyük dosyanın blok listesi hedeften isteniyor', { n: big.length }), g.key);
        const lists = await new AgentHasher(tgt, () => groupCancel.get(g.key)!.cancelled).blocks(big.map((o) => ({ rel: o.rel, size: o.size })), DELTA_BLOCK);
        for (const o of big) {
          const list = lists?.[o.rel];
          if (list) deltas.set(o.rel, { list, out: { size: 0, sent: 0 } });
        }
      }
    }
    const entries: PackEntry[] = [];
    const sources: PackSource[] = copies.map((op) => ({
      rel: op.rel,
      size: op.size,
      mtimeMs: op.mtimeMs ?? Date.now(),
      open: () => {
        const src = op.src!;
        const d = deltas.get(op.rel);
        if (d && src.kind === 'fs') return changedBlocks(fs.createReadStream(src.abs, { highWaterMark: DELTA_BLOCK }), d.list, DELTA_BLOCK, d.out);
        if (src.kind === 'fs') return fs.createReadStream(src.abs, { highWaterMark: 1024 * 1024 });
        if (src.kind === 'git') return blobStream(src.repo, src.rev, src.path);
        // a member of a pack file added as a source goes into the machine's pack as it is
        if (src.kind === 'pack') return openPackEntry(src.file, src) as Readable;
        if (src.kind === 'vars') return openVars(src);
        throw new Error(t('Kaynak uç bulunamadı: {key}', { key: (src as { key?: string }).key ?? '' }));
      },
    }));
    // a relay keeps the machine-specific files of the machines behind it aside, in its relay folder (not counted as sent)
    const stashRel = (f: StashFile) => relJoin(RELAY_FOLDER, 'stash', job.id, f.rel);
    for (const f of g.stash ?? []) sources.push({ rel: stashRel(f), size: f.size, mtimeMs: f.mtimeMs, open: () => openPlain(f.src) });
    let written = 0;
    let packed = 0;
    const stream = packStream(sources, entries, (src) => {
      if (src.rel.startsWith(`${RELAY_FOLDER}/`)) return;
      written += src.size;
      st.bytesDone = written;
      st.current = src.rel;
      emitProgress();
    });
    const limiter = s.bandwidthMBps && s.bandwidthMBps > 0 ? new RateLimiter(s.bandwidthMBps * 1024 * 1024) : null;
    const gc = groupCancel.get(g.key)!;
    // the upload is most of the time on a slow link: Pause holds it between chunks, Cancel stops it at once
    const gate = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (!paused) cb(null, chunk);
        else void holdWhilePaused().then(() => cb(null, chunk));
      },
    });
    // one chain: an error anywhere (a source gone, a cancel, the network) ends every part, the pack's open files too
    pipeline([stream, ...(limiter ? [limiter.transform()] : []), gate], () => undefined);
    try {
      packed = await submitRelayPack(tgt, job.id, gate, undefined, gc.signal);
    } catch (e) {
      const stopped = gc.cancelled;
      st.status = stopped ? 'cancelled' : 'failed';
      st.error = stopped ? t('İptal edildi; bu makinede hiçbir dosya değiştirilmedi') : errMessage(e);
      for (const op of g.ops) results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok: false, error: st.error });
      st.failed = g.ops.length;
      st.done = g.ops.length;
      log(stopped ? 'warn' : 'error', stopped ? st.error : t('Paket yazılamadı: {error}', { error: st.error }), g.key);
      if (stopped) {
        for (const r of relayed.get(g.key) ?? []) if (r.status === 'queued') Object.assign(r, { status: 'cancelled', error: t('İptal edildi'), failed: r.total, done: r.total, finishedAt: Date.now() });
      } else failRelayed(g, t('Röle {name} üzerindeki kopya tamamlanmadı; dağıtım yapılmadı', { name: g.title }));
      emitProgress();
      return;
    }
    const total = entries.reduce((a, e) => a + e.size, 0);
    if (total > 0) log('info', t('Paket: {size} → {packed} (%{pct})', { size: formatBytes(total), packed: formatBytes(packed), pct: Math.round((100 * packed) / total) }), g.key);
    if (deltas.size) {
      const ds = [...deltas.values()];
      log('info', t('Blok farkı: {n} dosyanın {size} boyutundan yalnızca değişen {sent} gönderildi', { n: ds.length, size: formatBytes(ds.reduce((a, d) => a + d.out.size, 0)), sent: formatBytes(ds.reduce((a, d) => a + d.out.sent, 0)) }), g.key);
    }
    // the job tells the relay what to do with the pack on its own disk
    const byRel = new Map(entries.map((e) => [e.rel, e]));
    const ops: PackOp[] = g.ops.map((op) => {
      if (op.kind === 'copy') {
        const e = byRel.get(op.rel)!;
        return { kind: 'copy', id: op.id, rel: op.rel, size: e.size, mtimeMs: e.mtimeMs, offset: e.offset, length: e.length, method: e.method, replaceType: op.replaceType, dstExists: op.dstExists, delta: deltas.get(op.rel)?.out.info };
      }
      if (op.kind === 'mkdir') return { kind: 'mkdir', id: op.id, rel: op.rel, replaceType: op.replaceType, dstExists: op.dstExists };
      return { kind: 'delete', id: op.id, rel: op.rel, isDir: op.isDir, onlyIfEmpty: op.onlyIfEmpty };
    });
    for (const [i, f] of (g.stash ?? []).entries()) {
      const e = byRel.get(stashRel(f));
      if (e) ops.push({ kind: 'copy', id: `stash-${i}`, rel: e.rel, size: e.size, mtimeMs: e.mtimeMs, offset: e.offset, length: e.length, method: e.method, dstExists: false });
    }
    job.pack = { ops, backup: g.backup ?? s.backup, verify: s.verify, subtrees: g.manifest ? [...g.manifest.keys()] : undefined, excluded: g.manifestExcluded };
    const rows = relayed.get(g.key) ?? [];
    const now = Date.now();
    for (const r of rows) Object.assign(r, { status: 'running', startedAt: now });
    st.current = undefined;
    emitProgress();
    try {
      await submitRelayJob(tgt, job);
      log('info', rows.length ? t('Röle işi bırakıldı: {targets}', { targets: rows.map((r) => r.title).join(', ') }) : t('Paket bırakıldı; makine kendisi uyguluyor'), g.key);
      const result = await waitRelay(g, tgt, job.id, rows.length ? t('Röle işi aldı, dağıtıyor') : t('Makine paketi aldı, uyguluyor'));
      // the relay's own apply
      const own = result.targets.find((x) => x.targetId === g.key);
      if (!own) {
        st.status = 'failed';
        st.error = t('Röle bu makine için sonuç bildirmedi');
        for (const op of g.ops) results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok: false, error: st.error });
        st.failed = g.ops.length;
      } else {
        st.status = own.status === 'cancelled' ? (groupCancel.get(g.key)!.cancelled ? 'cancelled' : 'failed') : own.status === 'deferred' ? 'failed' : own.status;
        st.error = own.error;
        const failedIds = new Set(own.failedOps ?? []);
        const heldIds = new Set(own.inUseOps ?? []);
        // what went to the backup there, so an undo restores it instead of removing it; an older SamSync does not
        // say: a file that was there before is backed up whenever the pack carries a backup
        const backedIds = own.backedUpOps ? new Set(own.backedUpOps) : null;
        const packBackup = !!job.pack?.backup && !!own.backupPath;
        for (const op of g.ops) {
          const ok = own.status === 'ok' || !failedIds.has(op.id);
          const backedUp = ok && op.kind !== 'mkdir' && (backedIds ? backedIds.has(op.id) : packBackup && !!op.dstExists);
          results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok, error: ok ? undefined : own.error ?? t('Röle uygulayamadı'), inUse: (!ok && heldIds.has(op.id)) || undefined, backedUp: backedUp || undefined, created: (ok && op.kind === 'copy' && op.dstExists === false) || undefined });
        }
        st.failed = own.opsFailed;
        if (own.backupPath) st.backupPath = own.backupPath;
        if (own.check) st.check = own.check;
        // a machine that only passes its own files on (distributing from it) had nothing to apply
        if (g.ops.length || own.status !== 'ok') log(own.status === 'ok' ? 'ok' : 'error', own.status === 'ok' ? t('Paket uygulandı: {ok}/{n} işlem', { ok: own.opsOk, n: g.ops.length }) : t('Paket uygulanamadı: {ok} başarılı, {failed} hatalı{error}', { ok: own.opsOk, failed: own.opsFailed, error: own.error ? `: ${own.error}` : '' }), g.key);
      }
      st.done = g.ops.length;
      st.bytesDone = st.bytesTotal;
      applyRelayResult(rows, result);
    } catch (e) {
      const unanswered = e instanceof RelayError && e.unanswered;
      const stopped = groupCancel.get(g.key)!.cancelled;
      const why = stopped ? t('İptal edildi') : errMessage(e);
      st.status = stopped ? 'cancelled' : 'failed';
      st.error = why;
      st.relayUnanswered = unanswered || undefined;
      for (const op of g.ops) results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok: false, error: why });
      st.failed = g.ops.length;
      st.done = g.ops.length;
      for (const r of rows) Object.assign(r, { status: stopped ? 'cancelled' : 'failed', error: why, failed: r.total, done: r.total, finishedAt: Date.now(), relayUnanswered: unanswered || undefined });
      log(stopped ? 'warn' : 'error', why, g.key);
      if (unanswered) await tgt.remove(relJoin(RELAY_FOLDER, 'jobs', `${job.id}.pack`), false).catch(() => undefined);
    }
    emitProgress();
  }

  /** The rows of the machines behind a relay follow what the relay reported for them. */
  function applyRelayResult(rows: RunTargetState[], result: { targets: { targetId: string; status: string; opsOk: number; opsFailed: number; bytes: number; error?: string; check?: RunTargetState['check'] }[] }) {
    for (const r of rows) {
      const got = result.targets.find((x) => x.targetId === r.key);
      if (!got) {
        Object.assign(r, { status: 'failed', error: t('Röle bu makine için sonuç bildirmedi'), failed: r.total, done: r.total });
      } else if (got.status === 'deferred') {
        // the machine was off: the relay keeps the job and delivers it when the machine is back
        Object.assign(r, { status: 'failed', deferred: true, done: r.total, failed: r.total, error: got.error ?? t('Makine kapalı; röle açılınca teslim edecek') });
        log('warn', t('{name}: kapalı; röle açılınca teslim edecek', { name: r.title }), r.key);
      } else {
        Object.assign(r, { status: got.status, done: got.opsOk + got.opsFailed, failed: got.opsFailed, total: Math.max(got.opsOk + got.opsFailed, 1), bytesTotal: got.bytes, bytesDone: got.bytes, error: got.error, check: got.check });
        if (got.status !== 'ok') log('error', t('{name}: röle dağıtımı başarısız ({ok} başarılı, {failed} hatalı){error}', { name: r.title, ok: got.opsOk, failed: got.opsFailed, error: got.error ? `: ${got.error}` : '' }), r.key);
        else log('ok', t('{name}: röle dağıttı ({ok} işlem, {size})', { name: r.title, ok: got.opsOk, size: formatBytes(got.bytes) }), r.key);
      }
      r.finishedAt = Date.now();
    }
  }

  /** Waits for a relay's answer; meanwhile the run's pause and cancel go on to the relay. */
  async function waitRelay(g: ExecGroup, tgt: Transport, jobId: string, acked: string) {
    relayWaits.set(g.key, { tgt, id: jobId });
    if (paused) void signalRelayJob(tgt, jobId, 'pause').catch(() => undefined);
    try {
      return await waitRelayResult(tgt, jobId, {
        cancel: groupCancel.get(g.key)!,
        ackMs: s.relayAckMs ?? 60_000,
        doneMs: s.relayDoneMs ?? 15 * 60_000,
        cancelGraceMs: s.relayCancelGraceMs,
        paused: () => paused,
        onAck: () => log('info', acked, g.key),
        onCancelSent: () => log('warn', t('İptal makineye bildirildi; orada yapılanlar bekleniyor'), g.key),
      });
    } finally {
      relayWaits.delete(g.key);
      // nothing waits any more: a pause sent there must not outlive the wait
      if (paused) void signalRelayJob(tgt, jobId, 'pause', false).catch(() => undefined);
    }
  }

  /** Hands the job to the relay and waits for its result; each relayed machine's row follows what it reports. */
  async function runRelay(g: ExecGroup, tgt: Transport) {
    const rows = relayed.get(g.key) ?? [];
    const job = g.relay!.job;
    const now = Date.now();
    for (const r of rows) Object.assign(r, { status: 'running', startedAt: now });
    emitProgress();
    try {
      await submitRelayJob(tgt, job);
      log('info', t('Röle işi bırakıldı: {targets}', { targets: rows.map((r) => r.title).join(', ') }), g.key);
      const result = await waitRelay(g, tgt, job.id, t('Röle işi aldı, dağıtıyor'));
      applyRelayResult(rows, result);
    } catch (e) {
      const unanswered = e instanceof RelayError && e.unanswered;
      const stopped = groupCancel.get(g.key)!.cancelled;
      const why = stopped ? t('İptal edildi') : errMessage(e);
      for (const r of rows) Object.assign(r, { status: stopped ? 'cancelled' : 'failed', error: why, failed: r.total, done: r.total, finishedAt: Date.now(), relayUnanswered: unanswered || undefined });
      log(stopped ? 'warn' : 'error', why, g.key);
    }
    emitProgress();
  }

  return {
    id,
    cancel,
    done,
    get paused() {
      return paused;
    },
    pause(on: boolean) {
      if (paused === on || cancel.cancelled) return;
      paused = on;
      log(on ? 'warn' : 'info', on ? t('Duraklatıldı') : t('Sürdürülüyor'));
      // a relay or a machine applying a pack holds its own work too
      for (const w of relayWaits.values()) void signalRelayJob(w.tgt, w.id, 'pause', on).catch(() => undefined);
      ctx.emit({ type: 'run-paused', runId: id, paused: on });
      if (!on) release();
    },
    cancelTarget(key: string) {
      const gc = groupCancel.get(key);
      if (!gc || gc.cancelled) return;
      const st = states.find((x) => x.key === key && !x.via);
      log('warn', t('{name} bu çalıştırmadan çıkarıldı; kalan işlemleri atlanıyor', { name: st?.title ?? key }), key);
      gc.cancel();
      // a paused run lets the dropped target's wait end so its state is settled at once
      release();
    },
  };
}

/**
 * Renames `from` to `to`. A folder whose files were moved to `to` before it (a deleted folder's own deletions run
 * first) is merged into it, as a folder cannot be renamed onto one that is not empty.
 */
async function moveInto(tgt: Transport, from: string, to: string): Promise<void> {
  // the usual case, a file or a folder with nothing in its way, is one rename
  try {
    await tgt.rename(from, to);
    return;
  } catch (e) {
    const dst = await tgt.stat(to);
    if (!dst?.isDir || !(await tgt.stat(from))?.isDir) throw e;
  }
  for (const c of await tgt.list(from)) await moveInto(tgt, c.rel, relJoin(to, relBase(c.rel)));
  await tgt.remove(from, true);
}

function opLabel(op: ExecOp): string {
  return op.kind === 'copy' ? t('Kopyalama') : op.kind === 'mkdir' ? t('Klasör') : t('Silme');
}

/**
 * Keeps the newest `keep` yyyyMMdd-HHmmss folders under the backup folder (0 = any number) and, with `maxDays`,
 * only those younger than that; hand made folders are left alone.
 */
export async function pruneBackups(tgt: Transport, folder: string, keep: number, log?: (m: string) => void, maxDays = 0, now = Date.now()): Promise<string[]> {
  const byAge = maxDays > 0;
  if (keep <= 0 && !byAge) return [];
  const list = (await tgt.list(folder)).filter((e) => e.isDir && parseStamp(relBase(e.rel)) != null);
  list.sort((a, b) => relBase(b.rel).localeCompare(relBase(a.rel)));
  const cutoff = byAge ? now - maxDays * 86400_000 : -Infinity;
  const removed: string[] = [];
  for (const old of list.filter((e, i) => (keep > 0 && i >= keep) || parseStamp(relBase(e.rel))! < cutoff)) {
    try {
      await tgt.remove(old.rel, true);
      removed.push(old.rel);
      log?.(t('Eski yedek silindi: {path}', { path: old.rel }));
    } catch (e) {
      log?.(t('Eski yedek silinemedi: {path} ({error})', { path: old.rel, error: errMessage(e) }));
    }
  }
  return removed;
}

/** Runs a pre- or post-copy command with the target's values filled in; ok when it exited with 0. */
async function runHook(
  label: string,
  template: string,
  timeoutSec: number,
  g: ExecGroup,
  tgt: Transport,
  source: ExecSettings['postSource'],
  log: (lvl: RunLogLine['level'], m: string) => void,
): Promise<{ ok: boolean; code: number | null; output: string }> {
  const n = g.node!;
  const cmd = template
    .replace(/\{address\}/g, n.address)
    .replace(/\{targetId\}/g, n.id)
    .replace(/\{targetName\}/g, n.name)
    .replace(/\{networkRoot\}/g, n.networkRoot)
    .replace(/\{destination\}/g, source ? joinRoot(tgt.root, source.rel) : tgt.root)
    .replace(/\{source\}/g, source?.path ?? '');
  log('info', `${label}: ${cmd}`);
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin ? spawn('cmd.exe', ['/d', '/s', '/c', cmd], { windowsHide: true, windowsVerbatimArguments: true }) : spawn('sh', ['-c', cmd]);
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      log('error', t('{label} {s} sn içinde bitmedi, durduruldu', { label, s: timeoutSec }));
    }, timeoutSec * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      log('error', t('{label} çalıştırılamadı: {error}', { label, error: e.message }));
      resolve({ ok: false, code: null, output: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = out.trim().split(/\r?\n/).slice(-5).join(' | ');
      const codeText = String(code);
      log(code === 0 ? 'ok' : 'error', tail ? t('{label} bitti (kod {code}): {output}', { label, code: codeText, output: tail }) : t('{label} bitti (kod {code})', { label, code: codeText }));
      resolve({ ok: code === 0, code, output: tail });
    });
  });
}
