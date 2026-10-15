import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { NodeConfig, RunDetail, RunLogLine, RunOpResult, RunSummary, RunTargetState, SendOptions, SendRequest, SrcRef } from '../shared/types';
import type { CoreContext } from './context';
import type { Transport } from './transport';
import { blobStream } from './git';
import { hashStream } from './compare';
import { joinRoot, relBase, relDepth, relJoin, relParent } from './paths';
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
  postCommand?: string;
  postCommandTimeoutSeconds: number;
  /** Per target transfer limit in MB/s; 0 or undefined = unlimited. */
  bandwidthMBps?: number;
  sources: string[];
  /** Last source item and its target relative path: {source} and {destination} of the post-copy command. */
  postSource?: { path: string; rel: string };
  targetIds: string[];
  options?: Partial<SendOptions>;
}

export interface RunHandle {
  id: string;
  cancel: CancelToken;
  done: Promise<RunDetail>;
}

const TMP_SUFFIX = '.samsync-tmp';

function tmpRelFor(rel: string): string {
  const parent = relParent(rel);
  return relJoin(parent, `.${relBase(rel)}.${Math.random().toString(36).slice(2, 8)}${TMP_SUFFIX}`);
}

export function startRun(ctx: CoreContext, groups: ExecGroup[], s: ExecSettings): RunHandle {
  const id = newId('run-');
  const cancel = new CancelToken();
  const runStamp = stamp();
  const startedAt = Date.now();
  const states: RunTargetState[] = groups.map((g) => ({
    key: g.key,
    title: g.title,
    root: g.rootLabel,
    total: g.ops.length,
    done: 0,
    failed: 0,
    bytesTotal: g.ops.filter((o) => o.kind === 'copy').reduce((a, o) => a + o.size, 0),
    bytesDone: 0,
    status: 'queued',
  }));
  const results: RunOpResult[] = [];
  const logLines: RunLogLine[] = [];
  let pendingLog: RunLogLine[] = [];

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
      targetIds: s.targetIds,
      options: s.options,
    };
  };

  const emitProgress = throttle(() => ctx.emit({ type: 'run-progress', runId: id, targets: states.map((x) => ({ ...x })) }), 150);
  const emitLog = throttle(() => {
    if (!pendingLog.length) return;
    const lines = pendingLog;
    pendingLog = [];
    ctx.emit({ type: 'run-log', runId: id, lines });
  }, 200);
  const log = (level: RunLogLine['level'], message: string, key?: string) => {
    const line: RunLogLine = { t: Date.now(), level, message, key };
    logLines.push(line);
    pendingLog.push(line);
    const comp = t('Kopyala');
    const msg = key ? `[${key}] ${message}` : message;
    if (level === 'error') ctx.log.error(comp, msg);
    else if (level === 'warn') ctx.log.warn(comp, msg);
    else ctx.log.info(comp, msg);
    emitLog();
  };

  const done = (async (): Promise<RunDetail> => {
    ctx.emit({ type: 'run-start', run: summary() });
    const startParams = { label: s.label, targets: groups.length, ops: summary().opsTotal };
    log(
      'info',
      s.dryRun
        ? t('{label} başladı: {targets} hedef, {ops} işlem (deneme çalıştırması, hiçbir şey yazılmayacak)', startParams)
        : t('{label} başladı: {targets} hedef, {ops} işlem', startParams),
    );
    await mapLimit(groups, Math.max(1, s.parallelGroups), (g, gi) => runGroup(g, states[gi]));
    emitProgress.flush();
    emitLog.flush();
    const sum = summary();
    const anyFailed = states.some((x) => x.status === 'failed' || x.status === 'partial');
    const allFailed = states.length > 0 && states.every((x) => x.status === 'failed');
    sum.status = cancel.cancelled ? 'cancelled' : allFailed ? 'failed' : anyFailed ? 'partial' : 'ok';
    sum.finishedAt = Date.now();
    const secs = ((sum.finishedAt - startedAt) / 1000).toFixed(1);
    log(
      sum.status === 'ok' ? 'ok' : sum.status === 'cancelled' ? 'warn' : 'error',
      t('Bitti: {ok} başarılı, {failed} hatalı, {size}, {s} sn', { ok: sum.opsOk, failed: sum.opsFailed, size: formatBytes(sum.bytes), s: secs }),
    );
    emitLog.flush();
    const detail: RunDetail = { ...sum, results, log: logLines };
    ctx.emit({ type: 'run-done', run: sum });
    return detail;
  })();

  async function runGroup(g: ExecGroup, st: RunTargetState) {
    if (cancel.cancelled) {
      st.status = 'cancelled';
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

    const backupBase = relJoin(s.backupFolderName, runStamp);
    const backup = g.backup ?? s.backup;
    let backedUpAny = false;
    let trashed = 0;
    let trashFailed = false;
    const groupParams = { root: g.rootLabel, n: g.ops.length };
    log('info', backup ? t('→ {root} ({n} işlem, yedekli)', groupParams) : t('→ {root} ({n} işlem)', groupParams), g.key);

    const record = (op: ExecOp, ok: boolean, error?: string, backedUp?: boolean) => {
      results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok, error, backedUp });
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

    const backupOrRemove = async (rel: string, isDir: boolean): Promise<boolean> => {
      const cur = await tgt.stat(rel);
      if (!cur) return false;
      if (await keepOld(rel)) return true;
      await tgt.remove(rel, cur.isDir || isDir);
      return false;
    };

    const limiter = s.bandwidthMBps && s.bandwidthMBps > 0 ? new RateLimiter(s.bandwidthMBps * 1024 * 1024) : null;
    const limited = (src: Readable): Readable => {
      if (!limiter) return src;
      const t2 = limiter.transform();
      src.on('error', (e) => t2.destroy(e));
      return src.pipe(t2);
    };

    const openSource = async (op: ExecOp): Promise<Readable> => {
      const src = op.src!;
      if (src.kind === 'fs') return fs.createReadStream(src.abs, { highWaterMark: limiter ? 256 * 1024 : 1024 * 1024 });
      if (src.kind === 'git') return blobStream(src.repo, src.rev, src.path);
      const et = await endpoint(src.key);
      return et.readStream(src.rel);
    };

    const doCopy = async (op: ExecOp): Promise<boolean> => {
      const tmp = tmpRelFor(op.rel);
      let base = 0;
      const onProgress = (n: number) => {
        st.bytesDone += n - base;
        base = n;
        st.current = op.rel;
        emitProgress();
      };
      try {
        const src = op.src!;
        const mtime = op.mtimeMs ?? (src.kind === 'git' ? Date.now() : undefined);
        if (src.kind === 'fs' && tgt.copyFromLocal && !limiter) await tgt.copyFromLocal(src.abs, tmp, { mtimeMs: mtime, onProgress });
        else await tgt.writeStream(tmp, limited(await openSource(op)), { mtimeMs: mtime ?? (src.kind === 'fs' ? fs.statSync(src.abs).mtimeMs : undefined), onProgress });
        const written = await tgt.stat(tmp);
        if (!written) throw new Error(t('Yazılan geçici dosya bulunamadı'));
        if (written.size !== op.size) throw new Error(t('Boyut tutmuyor: {written} ≠ {expected}', { written: written.size, expected: op.size }));
        if (s.verify) {
          const [a, b] = await Promise.all([hashStream(await openSource(op)), hashStream(await tgt.readStream(tmp))]);
          if (a !== b) throw new Error(t('Doğrulama başarısız: içerik özeti tutmuyor'));
        }
        const backedUp = await backupOrRemoveForReplace(op);
        await tgt.rename(tmp, op.rel);
        return backedUp;
      } catch (e) {
        st.bytesDone -= base;
        await tgt.remove(tmp, false).catch(() => undefined);
        throw e;
      }
    };

    const backupOrRemoveForReplace = async (op: ExecOp): Promise<boolean> => {
      const cur = await tgt.stat(op.rel);
      if (!cur) return false;
      if (cur.isDir || op.replaceType) return backupOrRemove(op.rel, cur.isDir);
      return keepOld(op.rel); // otherwise the rename replaces it
    };

    const runOp = async (op: ExecOp) => {
      if (cancel.cancelled) return;
      if (s.dryRun) {
        if (op.kind === 'copy') st.bytesDone += op.size;
        record(op, true);
        return;
      }
      let lastErr: unknown;
      for (let attempt = 0; attempt <= s.retryCount; attempt++) {
        if (cancel.cancelled) return;
        try {
          let backedUp = false;
          if (op.kind === 'copy') backedUp = await doCopy(op);
          else if (op.kind === 'mkdir') {
            const cur = await tgt.stat(op.rel);
            if (cur && !cur.isDir) backedUp = await backupOrRemove(op.rel, false);
            await tgt.mkdirp(op.rel);
          } else backedUp = await backupOrRemove(op.rel, op.isDir);
          record(op, true, undefined, backedUp);
          return;
        } catch (e) {
          lastErr = e;
          if (attempt < s.retryCount && !cancel.cancelled) {
            log('warn', t('{path}: {error} — yeniden denenecek ({attempt}/{max})', { path: op.rel, error: errMessage(e), attempt: attempt + 1, max: s.retryCount }), g.key);
            await sleep(s.waitSeconds * 1000);
          }
        }
      }
      record(op, false, errMessage(lastErr));
    };

    try {
      const mkdirs = g.ops.filter((o) => o.kind === 'mkdir').sort((a, b) => relDepth(a.rel) - relDepth(b.rel));
      const copies = g.ops.filter((o) => o.kind === 'copy').sort((a, b) => b.size - a.size);
      const deletes = g.ops.filter((o) => o.kind === 'delete');
      const delFiles = deletes.filter((o) => !o.isDir);
      const delDirs = deletes.filter((o) => o.isDir).sort((a, b) => relDepth(b.rel) - relDepth(a.rel));

      // parents first: one depth level at a time
      const levels = new Map<number, ExecOp[]>();
      for (const m of mkdirs) levels.set(relDepth(m.rel), [...(levels.get(relDepth(m.rel)) ?? []), m]);
      for (const lvl of [...levels.keys()].sort((a, b) => a - b)) await mapLimit(levels.get(lvl)!, s.parallelFiles, runOp);
      await mapLimit(copies, s.parallelFiles, runOp);
      await mapLimit(delFiles, s.parallelFiles, runOp);
      for (const d of delDirs) await runOp(d);

      if (cancel.cancelled) {
        st.status = 'cancelled';
        log('warn', t('İptal edildi'), g.key);
      } else {
        st.status = st.failed === 0 ? 'ok' : st.failed === g.ops.length ? 'failed' : 'partial';
        if (trashed) log('info', t('{n} eski hâl geri dönüşüm kutusuna taşındı', { n: trashed }), g.key);
        if (backedUpAny) {
          st.backupPath = relJoin(s.backupFolderName, runStamp);
          log('info', t('Eski hâller yedeklendi: {path}', { path: st.backupPath }), g.key);
        }
        // an age limit also clears versions on a side that kept nothing new this time
        const byAge = !!s.backupMaxDays && s.backupMaxDays > 0 && backup && !s.dryRun && st.status === 'ok';
        if (backedUpAny || byAge) {
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
        if (st.status === 'ok' && !s.dryRun && s.postCommand && g.node) {
          await runPostCommand(s.postCommand, s.postCommandTimeoutSeconds, g, tgt, s.postSource, (lvl, m) => log(lvl, m, g.key));
        }
      }
    } catch (e) {
      st.status = 'failed';
      st.error = errMessage(e);
      log('error', st.error, g.key);
    } finally {
      st.current = undefined;
      st.finishedAt = Date.now();
      emitProgress();
      await tgt.close().catch(() => undefined);
      for (const p of endpointCache.values()) await p.then((x) => x.close()).catch(() => undefined);
    }
  }

  return { id, cancel, done };
}

/**
 * Renames `from` to `to`. A folder whose files were moved to `to` before it (a deleted folder's own deletions run
 * first) is merged into it, as a folder cannot be renamed onto one that is not empty.
 */
async function moveInto(tgt: Transport, from: string, to: string): Promise<void> {
  const dst = await tgt.stat(to);
  if (!dst?.isDir || !(await tgt.stat(from))?.isDir) return tgt.rename(from, to);
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

async function runPostCommand(
  template: string,
  timeoutSec: number,
  g: ExecGroup,
  tgt: Transport,
  source: ExecSettings['postSource'],
  log: (lvl: RunLogLine['level'], m: string) => void,
): Promise<void> {
  const n = g.node!;
  const cmd = template
    .replace(/\{address\}/g, n.address)
    .replace(/\{targetId\}/g, n.id)
    .replace(/\{targetName\}/g, n.name)
    .replace(/\{networkRoot\}/g, n.networkRoot)
    .replace(/\{destination\}/g, source ? joinRoot(tgt.root, source.rel) : tgt.root)
    .replace(/\{source\}/g, source?.path ?? '');
  log('info', t('Sonrası komut: {cmd}', { cmd }));
  await new Promise<void>((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin ? spawn('cmd.exe', ['/d', '/s', '/c', cmd], { windowsHide: true, windowsVerbatimArguments: true }) : spawn('sh', ['-c', cmd]);
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      log('error', t('Sonrası komut {s} sn içinde bitmedi, durduruldu', { s: timeoutSec }));
    }, timeoutSec * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      log('error', t('Sonrası komut çalıştırılamadı: {error}', { error: e.message }));
      resolve();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = out.trim().split(/\r?\n/).slice(-5).join(' | ');
      const codeText = String(code);
      log(code === 0 ? 'ok' : 'error', tail ? t('Sonrası komut bitti (kod {code}): {output}', { code: codeText, output: tail }) : t('Sonrası komut bitti (kod {code})', { code: codeText }));
      resolve();
    });
  });
}
