import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppEvent } from '../shared/types';

const bridge = {
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke('samsync:api', method, args),
  on: (cb: (e: AppEvent) => void) => {
    const listener = (_: unknown, e: AppEvent) => cb(e);
    ipcRenderer.on('samsync:event', listener);
    return () => ipcRenderer.removeListener('samsync:event', listener);
  },
  /** Absolute path of a dropped File (Electron removed File.path). */
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('samsync', bridge);

export type Bridge = typeof bridge;
