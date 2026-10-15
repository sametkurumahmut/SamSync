import { randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { t } from '../shared/i18n';

export const isWin = process.platform === 'win32';

export function newId(prefix = ''): string {
  return prefix + Date.now().toString(36) + randomBytes(4).toString('hex');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** yyyyMMdd-HHmmss in local time (legacy backup folder format). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function parseStamp(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number) as unknown as number[];
  return new Date(y, mo - 1, d, h, mi, se).getTime();
}

/** Runs tasks with at most `limit` in flight. Results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Rejects after `ms` unless the promise settles first. */
export function withTimeout<T>(p: Promise<T>, ms: number, message = t('Zaman aşımı')): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as NodeJS.ErrnoException).code;
    return code && !e.message.includes(code) ? `${code}: ${e.message}` : e.message;
  }
  return String(e);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}

/** Throttles a callback: fires at most once per `ms`, always delivers the trailing call. */
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { flush(): void } {
  let last = 0;
  let timer: NodeJS.Timeout | null = null;
  let pending: A | null = null;
  const fire = () => {
    timer = null;
    last = Date.now();
    if (pending) {
      const a = pending;
      pending = null;
      fn(...a);
    }
  };
  const wrapped = ((...a: A) => {
    pending = a;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) fire();
    else if (!timer) timer = setTimeout(fire, wait);
  }) as ((...a: A) => void) & { flush(): void };
  wrapped.flush = () => {
    if (timer) clearTimeout(timer);
    fire();
  };
  return wrapped;
}

/**
 * Shared byte budget (token bucket without burst): every stream that goes through transform() of the same
 * limiter shares one rate, so parallel copies to one target stay under the limit together.
 */
export class RateLimiter {
  private next = 0;
  constructor(private bytesPerSec: number) {}

  /** Milliseconds to wait before `n` more bytes may pass. */
  reserve(n: number): number {
    const now = Date.now();
    const start = Math.max(now, this.next);
    this.next = start + (n / this.bytesPerSec) * 1000;
    return start - now;
  }

  transform(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        const wait = this.reserve(chunk.length);
        if (wait > 0) setTimeout(() => cb(null, chunk), wait);
        else cb(null, chunk);
      },
    });
  }
}

export class CancelToken {
  cancelled = false;
  private listeners: (() => void)[] = [];
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const l of this.listeners.splice(0)) l();
  }
  onCancel(fn: () => void) {
    if (this.cancelled) fn();
    else this.listeners.push(fn);
  }
  throwIfCancelled() {
    if (this.cancelled) throw new CancelledError();
  }
}

export class CancelledError extends Error {
  constructor() {
    super(t('İptal edildi'));
    this.name = 'CancelledError';
  }
}
