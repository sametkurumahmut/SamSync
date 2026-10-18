import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WebServer, hashPassword, verifyPassword } from '../src/core/webserver';
import { tmpDir } from './helpers';

const servers: WebServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

let port = 0;
/** A free port, asked of the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

async function setup() {
  const dir = await tmpDir();
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(path.dirname(dir), 'secret.txt'), 'nope');
  port = await freePort();
  const calls: { method: string; args: unknown[] }[] = [];
  const server = new WebServer({
    port,
    host: '127.0.0.1',
    passwordHash: hashPassword('doğru-parola'),
    staticDir: dir,
    call: async (method, args) => {
      calls.push({ method, args });
      if (method === 'bootstrap') return { appVersion: 'x', isElectron: true };
      return { echo: args };
    },
  });
  servers.push(server);
  await server.start();
  return { server, calls };
}

async function req(p: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  return fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers, redirect: 'manual' });
}

async function login(password: string) {
  return req('/login', { method: 'POST', body: new URLSearchParams({ password }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
}

const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];

describe('server mode', () => {
  it('hashes passwords with a salt and checks them in constant time', () => {
    const a = hashPassword('pw');
    const b = hashPassword('pw');
    expect(a).not.toBe(b);
    expect(verifyPassword('pw', a)).toBe(true);
    expect(verifyPassword('pw ', a)).toBe(false);
    expect(verifyPassword('pw', undefined)).toBe(false);
    expect(verifyPassword('pw', 'plain')).toBe(false);
  });

  it('refuses to start without a password', async () => {
    const s = new WebServer({ port: await freePort(), host: '127.0.0.1', passwordHash: '', staticDir: '.', call: async () => null });
    await expect(s.start()).rejects.toThrow(/password/);
  });

  it('sends everything but the login page to the login, and lets the right password in', async () => {
    const { server, calls } = await setup();
    const home = await req('/');
    expect(home.status).toBe(303);
    expect(home.headers.get('location')).toBe('/login');
    expect((await req('/api/bootstrap', { method: 'POST', headers: { 'x-samsync': '1' } })).status).toBe(401);
    expect((await req('/events')).status).toBe(401);
    const page = await req('/login');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('type="password"');

    const wrong = await login('yanlış');
    expect(wrong.headers.get('location')).toBe('/login?e=1');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const ok = await login('doğru-parola');
    expect(ok.status).toBe(303);
    const cookie = cookieOf(ok);
    expect(cookie).toMatch(/^samsync_session=.{20,}/);
    expect(ok.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);

    // the page and its assets
    const index = await req('/', { cookie });
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('id="root"');
    expect((await req('/assets/app.js', { cookie })).headers.get('content-type')).toMatch(/javascript/);
    expect((await req('/assets/missing.js', { cookie })).status).toBe(404);
    expect((await req('/%2e%2e/secret.txt', { cookie })).status).toBeGreaterThanOrEqual(403);

    // the API: the header is required, the desktop's own calls are refused, the rest goes through
    expect((await req('/api/runs', { method: 'POST', cookie, body: '[]' })).status).toBe(403);
    const denied = await req('/api/pick', { method: 'POST', cookie, headers: { 'x-samsync': '1' }, body: '[{}]' });
    expect(denied.status).toBe(403);
    const boot = await (await req('/api/bootstrap', { method: 'POST', cookie, headers: { 'x-samsync': '1' }, body: '[]' })).json();
    expect(boot).toEqual({ ok: true, result: { appVersion: 'x', isElectron: true, remote: true } });
    const runs = (await (await req("/api/run", { method: "POST", cookie, headers: { "x-samsync": "1" }, body: "[\"r1\"]" })).json()) as { result: unknown };
    expect(runs.result).toEqual({ echo: ['r1'] });
    expect(calls.map((c) => c.method)).toEqual(['bootstrap', 'run']);
    expect(server.state()).toMatchObject({ running: true, sessions: 1 });

    // events reach a signed-in browser
    const ev = await req('/events', { cookie });
    expect(ev.headers.get('content-type')).toMatch(/event-stream/);
    const reader = ev.body!.getReader();
    await reader.read(); // ": ok"
    server.broadcast({ type: 'relay', state: { active: true, jobs: 2 } });
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('"jobs":2');
    await reader.cancel();

    // logout ends the session
    await req('/logout', { cookie });
    expect((await req('/', { cookie })).status).toBe(303);
  });

  it('locks an address out for a while after five wrong passwords', async () => {
    await setup();
    for (let i = 0; i < 4; i++) expect((await login('x')).headers.get('location')).toBe('/login?e=1');
    expect((await login('x')).headers.get('location')).toBe('/login?e=locked');
    // even the right password waits now
    const r = await login('doğru-parola');
    expect(r.headers.get('location')).toBe('/login?e=locked');
    expect(r.headers.get('set-cookie')).toBeNull();
  });
});
