// Server mode: the window of SamSync, served to browsers on the network by the copy that runs on an always-on
// machine. Same UI, same API, same events: a browser gets the built renderer and talks to this process over HTTP
// (POST /api/<method>, events as Server-Sent Events) instead of IPC. Nothing has to be installed on the machines
// people sit at.
//
// It is a door into this computer's file system, so: a password is required (stored as a scrypt hash), sessions are
// random tokens in an HttpOnly SameSite=Strict cookie, API calls must carry a custom header (a cross-site form
// cannot), failed logins are slowed down per address, and the calls that act on this desktop (dialogs, opening
// files, window control, installing an update, changing this server) are refused for browsers. Plain HTTP: meant
// for a trusted network, or behind a reverse proxy that adds TLS.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AppEvent } from '../shared/types';
import { isApiMethod, type ApiMethod } from '../shared/api';

/** Methods a browser may not call: they would act on this computer's desktop, or on this server itself. */
export const REMOTE_DENIED: ReadonlySet<string> = new Set<ApiMethod>([
  'pick',
  'pickSave',
  'openPath',
  'showInFolder',
  'openTarget',
  'openExternal',
  'openLog',
  'windowControl',
  'setChrome',
  'exportDiagnostics',
  'updateInstall',
  'integrationSet',
  'webUiConfigure',
]);

/** What a viewer may call: everything that only reads (plans and comparisons write nothing until a run starts). */
export const VIEWER_ALLOWED: ReadonlySet<string> = new Set<string>([
  'bootstrap',
  'lastDrift',
  'machineTimeline',
  'machineFolders',
  'scheduledSends',
  'busyFiles',
  'releaseDiff',
  'stagedSend',
  'whoHolds',
  'probe',
  'describeSources',
  'mapPath',
  'planSend',
  'runs',
  'run',
  'gitRepos',
  'gitStatus',
  'gitLog',
  'gitBranches',
  'gitSources',
  'compareJob',
  'browse',
  'findBackups',
  'backupSets',
  'browseBackup',
  'diffNodes',
  'whatsNew',
  'assistantStatus',
  'statFile',
  'integrationStatus',
  'updateState',
  'automationState',
  'relayState',
  'pendingSends',
  'inventory',
  'findInHistory',
  'rootLabel',
  'webUiState',
  'discoverHosts',
]);

const COOKIE = 'samsync_session';
const SESSION_MS = 12 * 3600_000;
const MAX_BODY = 32 * 1024 * 1024;
/** The sign-in form holds a password: anything bigger is not one. */
const MAX_LOGIN_BODY = 4096;
/** Password checks at once (each takes a moment of CPU); more wait for a minute like a locked address. */
const MAX_LOGINS = 4;
/** Failed logins from one address before it has to wait, and how long. */
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

// ---------------------------------------------------------------- passwords

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** "scrypt$<salt hex>$<hash hex>" */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFC'), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** The same check off the main thread: a burst of sign-ins does not freeze the app and its sends. */
export async function verifyPasswordAsync(password: string, stored: string | undefined): Promise<boolean> {
  const m = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(stored ?? '');
  if (!m) return false;
  const got = await new Promise<Buffer>((resolve, reject) => crypto.scrypt(password.normalize('NFC'), Buffer.from(m[1], 'hex'), 32, SCRYPT, (e, key) => (e ? reject(e) : resolve(key))));
  return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), got);
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  const m = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(stored ?? '');
  if (!m) return false;
  const want = Buffer.from(m[2], 'hex');
  const got = crypto.scryptSync(password.normalize('NFC'), Buffer.from(m[1], 'hex'), 32, SCRYPT);
  return crypto.timingSafeEqual(want, got);
}

// ---------------------------------------------------------------- the server

export interface WebServerOptions {
  port: number;
  /** 127.0.0.1 (this computer only) or 0.0.0.0 (the network). */
  host: string;
  passwordHash: string;
  /** A browser signed in with this password only looks: every call that would change something is refused. */
  viewerHash?: string;
  /** The built renderer (index.html and assets/). */
  staticDir: string;
  /** Runs an API method as the window would; the server has checked it is allowed. */
  call(method: ApiMethod, args: unknown[]): Promise<unknown>;
  /** Texts of the login page, in the app's language. */
  texts?: () => { title: string; password: string; signIn: string; wrong: string; locked: string; readOnly?: string };
  log?: (level: 'info' | 'warn', message: string) => void;
  /** HTTPS with this certificate and key (PEM); plain HTTP without. */
  tls?: { cert: string; key: string };
}

export interface WebServerState {
  running: boolean;
  port: number;
  host: string;
  /** Browsers listening for events right now. */
  clients: number;
  sessions: number;
  error?: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // a cookie of another program on this host may not be encoded the way ours are: it is skipped, not an error
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* not ours */
    }
  }
  return out;
}

class BodyTooLarge extends Error {
  constructor() {
    super('body too large');
  }
}

function readBody(req: http.IncomingMessage, max = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        // nothing more is read; the answer (413) closes the connection, so the rest is never taken in
        req.pause();
        req.removeAllListeners('data');
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Settings (alone, or inside bootstrap's result) without the notification channel's token and URL. */
function withoutSecrets(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as { settings?: { notifications?: object }; notifications?: object };
  const strip = (n: object | undefined) => (n ? { ...n, telegramToken: undefined, webhookUrl: undefined } : n);
  if (r.settings) return { ...r, settings: { ...r.settings, notifications: strip(r.settings.notifications) } };
  if ('notifications' in r) return { ...r, notifications: strip(r.notifications) };
  return result;
}

export class WebServer {
  private server: http.Server | https.Server | null = null;
  private clients = new Set<http.ServerResponse>();
  private sessions = new Map<string, { until: number; role: 'admin' | 'viewer' }>();
  private fails = new Map<string, { n: number; until: number }>();
  private loginsRunning = 0;
  private lastError: string | undefined;

  constructor(private o: WebServerOptions) {}

  state(): WebServerState {
    this.prune();
    return { running: !!this.server?.listening, port: this.o.port, host: this.o.host, clients: this.clients.size, sessions: this.sessions.size, error: this.lastError };
  }

  start(): Promise<void> {
    if (!/^scrypt\$/.test(this.o.passwordHash)) return Promise.reject(new Error('password required'));
    return new Promise((resolve, reject) => {
      const handler = (req: http.IncomingMessage, res: http.ServerResponse) => void this.handle(req, res).catch((e) => this.fail(res, 500, e instanceof Error ? e.message : String(e)));
      const s = this.o.tls ? https.createServer({ cert: this.o.tls.cert, key: this.o.tls.key }, handler) : http.createServer(handler);
      s.once('error', (e) => {
        this.lastError = e.message;
        reject(e);
      });
      s.listen(this.o.port, this.o.host, () => {
        this.server = s;
        this.lastError = undefined;
        this.o.log?.('info', `web UI on ${this.o.tls ? 'https' : 'http'}://${this.o.host}:${this.o.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.end();
    this.clients.clear();
    this.sessions.clear();
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }

  /** An app event to every browser that listens. */
  broadcast(e: AppEvent): void {
    if (!this.clients.size) return;
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of this.clients) c.write(data);
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, s] of this.sessions) if (s.until < now) this.sessions.delete(k);
    for (const [k, f] of this.fails) if (f.until && f.until < now) this.fails.delete(k);
  }

  private session(req: http.IncomingMessage): { token: string; role: 'admin' | 'viewer' } | null {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s || s.until < Date.now()) return null;
    s.until = Date.now() + SESSION_MS; // sliding
    return { token, role: s.role };
  }

  private headers(res: http.ServerResponse): void {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
  }

  private fail(res: http.ServerResponse, code: number, message: string): void {
    if (res.headersSent) return void res.end();
    res.statusCode = code;
    if (code === 413) res.setHeader('connection', 'close');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: message }));
  }

  private redirect(res: http.ServerResponse, to: string, cookie?: string): void {
    res.statusCode = 303;
    res.setHeader('Location', to);
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.end();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.headers(res);
    const url = new URL(req.url ?? '/', 'http://x');
    const ip = req.socket.remoteAddress ?? '?';

    if (url.pathname === '/login') {
      if (req.method === 'POST') return this.login(req, res, ip);
      if (this.session(req)) return this.redirect(res, '/');
      return this.loginPage(res, url.searchParams.get('e'));
    }
    if (url.pathname === '/logout') {
      const token = cookies(req)[COOKIE];
      if (token) this.sessions.delete(token);
      return this.redirect(res, '/login', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict${this.o.tls ? '; Secure' : ''}; Max-Age=0`);
    }

    const session = this.session(req);
    const signedIn = !!session;
    if (url.pathname.startsWith('/api/')) {
      if (!session) return this.fail(res, 401, 'not signed in');
      if (req.method !== 'POST') return this.fail(res, 405, 'POST only');
      // a cross-site form cannot set this header, and the server allows no cross-origin requests
      if (req.headers['x-samsync'] !== '1') return this.fail(res, 403, 'missing header');
      const method = url.pathname.slice(5);
      if (!isApiMethod(method) || REMOTE_DENIED.has(method)) return this.fail(res, 403, `not available in the browser: ${method}`);
      if (session.role === 'viewer' && !VIEWER_ALLOWED.has(method)) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: this.o.texts?.().readOnly ?? 'This sign-in only looks: it cannot change anything.' }));
        return;
      }
      let args: unknown[];
      try {
        const body = await readBody(req);
        args = body ? (JSON.parse(body) as unknown[]) : [];
        if (!Array.isArray(args)) throw new Error('arguments must be an array');
      } catch (e) {
        return this.fail(res, e instanceof BodyTooLarge ? 413 : 400, e instanceof Error ? e.message : String(e));
      }
      try {
        let result = await this.o.call(method, args);
        if (method === 'bootstrap' && result && typeof result === 'object') result = { ...(result as object), remote: true, readOnly: session.role === 'viewer' || undefined };
        // a viewer does not get the channel's secrets (with a bot token one can post as the bot)
        if (session.role === 'viewer' && (method === 'bootstrap' || method === 'saveSettings')) result = withoutSecrets(result);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, result: result ?? null }));
      } catch (e) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (url.pathname === '/events') {
      if (!signedIn) return this.fail(res, 401, 'not signed in');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': ok\n\n');
      this.clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
      });
      return;
    }
    if (!signedIn) return this.redirect(res, '/login');
    return this.static(url.pathname, res);
  }

  private async login(req: http.IncomingMessage, res: http.ServerResponse, ip: string): Promise<void> {
    let body: string;
    try {
      body = await readBody(req, MAX_LOGIN_BODY);
    } catch {
      return this.fail(res, 413, 'too large');
    }
    // looked at once the form is in, so guesses sent side by side all see the count of the ones before them
    const f = this.fails.get(ip);
    if ((f && f.until > Date.now()) || this.loginsRunning >= MAX_LOGINS) return this.redirect(res, '/login?e=locked');
    const n = (f?.n ?? 0) + 1;
    this.fails.set(ip, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
    const given = new URLSearchParams(body).get('password') ?? '';
    let role: 'admin' | 'viewer' | null;
    this.loginsRunning++;
    try {
      role = (await verifyPasswordAsync(given, this.o.passwordHash)) ? 'admin' : this.o.viewerHash && (await verifyPasswordAsync(given, this.o.viewerHash)) ? 'viewer' : null;
    } finally {
      this.loginsRunning--;
    }
    if (!role) {
      this.o.log?.('warn', `web UI: wrong password from ${ip} (${n})`);
      return this.redirect(res, n >= MAX_FAILS ? '/login?e=locked' : '/login?e=1');
    }
    this.fails.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(token, { until: Date.now() + SESSION_MS, role });
    this.o.log?.('info', role === 'viewer' ? `web UI: viewer signed in from ${ip}` : `web UI: signed in from ${ip}`);
    return this.redirect(res, '/', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${this.o.tls ? '; Secure' : ''}; Max-Age=${SESSION_MS / 1000}`);
  }

  private loginPage(res: http.ServerResponse, error: string | null): void {
    const tx = this.o.texts?.() ?? { title: 'SamSync', password: 'Password', signIn: 'Sign in', wrong: 'Wrong password', locked: 'Too many attempts; wait a minute' };
    const msg = error === 'locked' ? tx.locked : error ? tx.wrong : '';
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; img-src 'self'");
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tx.title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0e13;color:#e7eaf0;font:15px system-ui,'Segoe UI',sans-serif}
@media (prefers-color-scheme:light){body{background:#f4f5f8;color:#141821}form{background:#fff!important;border-color:#e3e6ec!important}input{background:#fff!important;color:#141821!important;border-color:#d2d7e0!important}}
form{display:flex;flex-direction:column;gap:12px;width:min(340px,calc(100vw - 32px));padding:28px;border-radius:16px;background:#12151c;border:1px solid #222833}
h1{margin:0 0 4px;font-size:20px}label{font-size:13px;opacity:.8}input{height:38px;padding:0 12px;border-radius:9px;border:1px solid #2e3542;background:#0a0c10;color:#e7eaf0;font:inherit}
button{height:38px;border:0;border-radius:9px;background:#2f7cf6;color:#fff;font:600 14px system-ui;cursor:pointer}p{margin:0;color:#f87171;font-size:13px}</style></head>
<body><form method="post" action="/login"><h1>SamSync</h1><label for="pw">${esc(tx.password)}</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>${msg ? `<p role="alert">${esc(msg)}</p>` : ''}<button type="submit">${esc(tx.signIn)}</button></form></body></html>`);
  }

  private static(pathname: string, res: http.ServerResponse): void {
    const root = path.resolve(this.o.staticDir);
    let rel: string;
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      return this.fail(res, 400, 'bad path');
    }
    let file = path.resolve(root, rel || 'index.html');
    // nothing outside the renderer folder
    if (file !== root && !file.startsWith(root + path.sep)) return this.fail(res, 403, 'outside');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // the app's own routes are hashes; anything else that is not a file gets the page
      if (path.extname(rel)) return this.fail(res, 404, 'not found');
      file = path.join(root, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream');
    if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    fs.createReadStream(file).pipe(res);
  }
}
