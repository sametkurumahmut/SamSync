import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { NodeConfig, RunDetail, RunLogLine, RunOpResult, RunSummary, RunTargetState, SendOptions, SendRequest, SrcRef } from '../shared/types';
import type { CoreContext } from './context';
import type { Transport } from './transport';
import { blobStream } from './git';
import { hashStream } from './compare';
import { relBase, relDepth, relJoin, relParent } from './paths';
import { CancelToken, RateLimiter, errMessage, formatBytes, mapLimit, newId, parseStamp, sleep, stamp, throttle } from './util';

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
}

export interface ExecSettings {
  label: string;
  origin: SendRequest['origin'];
  dryRun: boolean;
  backup: boolean;
  backupKeep: number;
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
    const comp = 'Kopyala';
    const msg = key ? `[${key}] ${message}` : message;
    if (level === 'error') ctx.log.error(comp, msg);
    else if (level === 'warn') ctx.log.warn(comp, msg);
    else ctx.log.info(comp, msg);
    emitLog();
  };

  const done = (async (): Promise<RunDetail> => {
    ctx.emit({ type: 'run-start', run: summary() });
    log('info', `${s.label} başladı: ${groups.length} hedef, ${summary().opsTotal} işlem${s.dryRun ? ' (deneme çalıştırması, hiçbir şey yazılmayacak)' : ''}`);
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
      `Bitti: ${sum.opsOk} başarılı, ${sum.opsFailed} hatalı, ${formatBytes(sum.bytes)}, ${secs} sn`,
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
    let t: Transport;
    try {
      t = await g.open();
    } catch (e) {
      st.status = 'failed';
      st.error = errMessage(e);
      st.finishedAt = Date.now();
      log('error', `Hedefe bağlanılamadı: ${st.error}`, g.key);
      for (const op of g.ops) results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok: false, error: st.error });
      st.failed = g.ops.length;
      emitProgress();
      return;
    }
    const endpointCache = new Map<string, Promise<Transport>>();
    const endpoint = (key: string) => {
      if (!endpointCache.has(key)) {
        const opener = g.endpoints?.[key];
        if (!opener) throw new Error(`Kaynak uç bulunamadı: ${key}`);
        endpointCache.set(key, opener());
      }
      return endpointCache.get(key)!;
    };

    const backupBase = relJoin(s.backupFolderName, runStamp);
    let backedUpAny = false;
    log('info', `→ ${g.rootLabel} (${g.ops.length} işlem${s.backup ? ', yedekli' : ''})`, g.key);

    const record = (op: ExecOp, ok: boolean, error?: string, backedUp?: boolean) => {
      results.push({ key: g.key, opId: op.id, rel: op.rel, kind: op.kind, ok, error, backedUp });
      st.done++;
      if (!ok) {
        st.failed++;
        log('error', `${opLabel(op)} ${op.rel}: ${error}`, g.key);
      }
      emitProgress();
    };

    const backupOrRemove = async (rel: string, isDir: boolean): Promise<boolean> => {
      const cur = await t.stat(rel);
      if (!cur) return false;
      if (s.backup) {
        await t.rename(rel, relJoin(backupBase, rel));
        backedUpAny = true;
        return true;
      }
      await t.remove(rel, cur.isDir || isDir);
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
        if (src.kind === 'fs' && t.copyFromLocal && !limiter) await t.copyFromLocal(src.abs, tmp, { mtimeMs: mtime, onProgress });
        else await t.writeStream(tmp, limited(await openSource(op)), { mtimeMs: mtime ?? (src.kind === 'fs' ? fs.statSync(src.abs).mtimeMs : undefined), onProgress });
        const written = await t.stat(tmp);
        if (!written) throw new Error('Yazılan geçici dosya bulunamadı');
        if (written.size !== op.size) throw new Error(`Boyut tutmuyor: ${written.size} ≠ ${op.size}`);
        if (s.verify) {
          const [a, b] = await Promise.all([hashStream(await openSource(op)), hashStream(await t.readStream(tmp))]);
          if (a !== b) throw new Error('Doğrulama başarısız: içerik özeti tutmuyor');
        }
        const backedUp = await backupOrRemoveForReplace(op);
        await t.rename(tmp, op.rel);
        return backedUp;
      } catch (e) {
        st.bytesDone -= base;
        await t.remove(tmp, false).catch(() => undefined);
        throw e;
      }
    };

    const backupOrRemoveForReplace = async (op: ExecOp): Promise<boolean> => {
      const cur = await t.stat(op.rel);
      if (!cur) return false;
      if (cur.isDir || op.replaceType) return backupOrRemove(op.rel, cur.isDir);
      if (s.backup) {
        await t.rename(op.rel, relJoin(backupBase, op.rel));
        backedUpAny = true;
        return true;
      }
      return false; // the rename replaces it
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
            const cur = await t.stat(op.rel);
            if (cur && !cur.isDir) backedUp = await backupOrRemove(op.rel, false);
            await t.mkdirp(op.rel);
          } else backedUp = await backupOrRemove(op.rel, op.isDir);
          record(op, true, undefined, backedUp);
          return;
        } catch (e) {
          lastErr = e;
          if (attempt < s.retryCount && !cancel.cancelled) {
            log('warn', `${op.rel}: ${errMessage(e)} — yeniden denenecek (${attempt + 1}/${s.retryCount})`, g.key);
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
        log('warn', 'İptal edildi', g.key);
      } else {
        st.status = st.failed === 0 ? 'ok' : st.failed === g.ops.length ? 'failed' : 'partial';
        if (backedUpAny) {
          st.backupPath = relJoin(s.backupFolderName, runStamp);
          log('info', `Eski hâller yedeklendi: ${st.backupPath}`, g.key);
          await pruneBackups(t, s.backupFolderName, s.backupKeep, (m) => log('info', m, g.key));
        }
        const ok = g.ops.length - st.failed;
        log(st.status === 'ok' ? 'ok' : 'error', `${st.status === 'ok' ? 'Başarılı' : 'Hatalı'}: ${ok}/${g.ops.length} işlem${s.dryRun ? ' (deneme)' : ''}`, g.key);
        if (st.status === 'ok' && !s.dryRun && s.postCommand && g.node) {
          await runPostCommand(s.postCommand, s.postCommandTimeoutSeconds, g, t, (lvl, m) => log(lvl, m, g.key));
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
      await t.close().catch(() => undefined);
      for (const p of endpointCache.values()) await p.then((x) => x.close()).catch(() => undefined);
    }
  }

  return { id, cancel, done };
}

function opLabel(op: ExecOp): string {
  return op.kind === 'copy' ? 'Kopyalama' : op.kind === 'mkdir' ? 'Klasör' : 'Silme';
}

/** Keeps the newest `keep` yyyyMMdd-HHmmss folders under the backup folder; hand made folders are left alone. */
export async function pruneBackups(t: Transport, folder: string, keep: number, log?: (m: string) => void): Promise<string[]> {
  if (keep <= 0) return [];
  const list = (await t.list(folder)).filter((e) => e.isDir && parseStamp(relBase(e.rel)) != null);
  list.sort((a, b) => relBase(b.rel).localeCompare(relBase(a.rel)));
  const removed: string[] = [];
  for (const old of list.slice(keep)) {
    try {
      await t.remove(old.rel, true);
      removed.push(old.rel);
      log?.(`Eski yedek silindi: ${old.rel}`);
    } catch (e) {
      log?.(`Eski yedek silinemedi: ${old.rel} (${errMessage(e)})`);
    }
  }
  return removed;
}

async function runPostCommand(
  template: string,
  timeoutSec: number,
  g: ExecGroup,
  t: Transport,
  log: (lvl: RunLogLine['level'], m: string) => void,
): Promise<void> {
  const n = g.node!;
  const cmd = template
    .replace(/\{address\}/g, n.address)
    .replace(/\{targetId\}/g, n.id)
    .replace(/\{targetName\}/g, n.name)
    .replace(/\{networkRoot\}/g, n.networkRoot)
    .replace(/\{destination\}/g, t.root)
    .replace(/\{source\}/g, '');
  log('info', `Sonrası komut: ${cmd}`);
  await new Promise<void>((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin ? spawn('cmd.exe', ['/d', '/s', '/c', cmd], { windowsHide: true, windowsVerbatimArguments: true }) : spawn('sh', ['-c', cmd]);
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      log('error', `Sonrası komut ${timeoutSec} sn içinde bitmedi, durduruldu`);
    }, timeoutSec * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      log('error', `Sonrası komut çalıştırılamadı: ${e.message}`);
      resolve();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = out.trim().split(/\r?\n/).slice(-5).join(' | ');
      log(code === 0 ? 'ok' : 'error', `Sonrası komut bitti (kod ${code})${tail ? ': ' + tail : ''}`);
      resolve();
    });
  });
}
