// In a browser (server mode) there is no file dialog: pick and pickSave open the in-page picker that browses the
// server's disks through listDir. The API layer calls requestWebPick; the ServerPicker component answers it.
import { create } from 'zustand';
import type { PickOptions } from '@shared/api';

export interface PickRequest {
  opts: PickOptions;
  save: boolean;
  resolve: (v: string[] | string | null) => void;
}

export const usePicker = create<{ req: PickRequest | null }>(() => ({ req: null }));

export function requestWebPick(opts: PickOptions, save: boolean): Promise<string[] | string | null> {
  return new Promise((resolve) => {
    // a picker already open is answered "cancelled" first
    const prev = usePicker.getState().req;
    prev?.resolve(prev.save ? null : []);
    usePicker.setState({ req: { opts: opts ?? {}, save, resolve } });
  });
}
