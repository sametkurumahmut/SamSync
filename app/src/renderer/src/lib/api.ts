import type { Api, PickOptions } from '@shared/api';
import type { AppEvent } from '@shared/types';
import { requestWebPick } from './webpick';

/** Calls that act on the desktop the window belongs to; a browser has none, so they quietly do nothing there. */
const DESKTOP_ONLY = new Set(['openPath', 'showInFolder', 'openLog', 'windowControl', 'setChrome']);

interface Bridge {
  invoke(method: string, args: unknown[]): Promise<unknown>;
  on(cb: (e: AppEvent) => void): () => void;
  pathForFile(f: File): string;
  platform: string;
}

declare global {
  interface Window {
    samsync?: Bridge;
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.samsync;

function cleanError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  // "Error invoking remote method 'samsync:api': Error: <message>"
  return new Error(msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
}

async function invoke(method: string, args: unknown[]): Promise<unknown> {
  if (window.samsync) {
    try {
      return await window.samsync.invoke(method, args);
    } catch (e) {
      throw cleanError(e);
    }
  }
  // a browser (server mode or the development preview): dialogs in the page, links in a new tab
  if (method === 'pick') return requestWebPick(args[0] as PickOptions, false);
  if (method === 'pickSave') return requestWebPick(args[0] as PickOptions, true);
  if (method === 'openExternal') {
    window.open(String(args[0]), '_blank', 'noopener');
    return undefined;
  }
  if (DESKTOP_ONLY.has(method)) return undefined;
  // the header tells the server this is the page and not a form from another site
  const res = await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-samsync': '1' }, body: JSON.stringify(args) });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('not signed in');
  }
  const body = await res.json();
  if (!body.ok) throw new Error(body.error);
  return body.result;
}

export const api = new Proxy({} as Api, {
  get: (_t, method: string) => (...args: unknown[]) => invoke(method, args),
});

type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  const dispatch = (e: AppEvent) => listeners.forEach((l) => l(e));
  if (window.samsync) {
    window.samsync.on(dispatch);
  } else {
    const es = new EventSource('/events');
    es.onmessage = (m) => dispatch(JSON.parse(m.data));
  }
}

export function onEvent(l: Listener): () => void {
  wire();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Absolute path of a dropped file (Electron only). */
export function pathForFile(f: File): string | null {
  if (window.samsync) {
    try {
      return window.samsync.pathForFile(f) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function newTaskId(): string {
  return 't' + Math.random().toString(36).slice(2, 10);
}
