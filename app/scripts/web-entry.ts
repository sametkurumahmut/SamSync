// Development aid: runs the real core (Service) behind a small HTTP API and serves the renderer
// through Vite, so the UI can be opened in any browser. Electron-only features (dialogs, tray,
// notifications, updater, safe storage) are simply unavailable here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { Service, type HostAdapter } from '../src/core/service';
import type { AppEvent } from '../src/shared/types';
import { isApiMethod } from '../src/shared/api';

const root = path.resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const port = Number(arg('port') || process.env.PORT || 5198);
const userDataPath = arg('user-data') || process.env.SAMSYNC_USER_DATA || path.join(os.tmpdir(), 'samsync-web-userdata');
const clients = new Set<http.ServerResponse>();

const host: HostAdapter = {
  isElectron: false,
  appVersion: pkg.version,
  userDataPath,
  initialPaths: (process.env.SAMSYNC_PATHS || '').split(';').filter(Boolean),
  systemLanguages: [process.env.SAMSYNC_LANG, Intl.DateTimeFormat().resolvedOptions().locale].filter((x): x is string => !!x),
  emit(e: AppEvent) {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of clients) c.write(data);
  },
};

async function main() {
  const service = new Service(host);
  await service.init();
  const vite = await createVite({
    configFile: false,
    root: path.join(root, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': path.join(root, 'src/shared'), '@': path.join(root, 'src/renderer/src') } },
    server: { middlewareMode: true, hmr: { port: port + 1 } },
    appType: 'spa',
  });

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.startsWith('/api/') && req.method === 'POST') {
      const method = url.slice(5);
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        res.setHeader('content-type', 'application/json');
        try {
          const fn = (service as unknown as Record<string, unknown>)[method];
          if (!isApiMethod(method) || typeof fn !== 'function') throw new Error(`Bilinmeyen işlem: ${method}`);
          const args = body ? JSON.parse(body) : [];
          const result = await (fn as (...a: unknown[]) => unknown).apply(service, args);
          res.end(JSON.stringify({ ok: true, result: result ?? null }));
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
      return;
    }
    vite.middlewares(req, res);
  });
  server.listen(port, () => console.log(`SamSync web preview: http://localhost:${port}  (userData: ${userDataPath})`));
}

void main();
