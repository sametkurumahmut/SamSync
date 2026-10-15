import { Menu, Tray, nativeImage } from 'electron';
import type { AutomationState } from '../shared/types';

export interface TrayActions {
  show(): void;
  setPaused(paused: boolean): void;
  quit(): void;
}

/** Notification area icon, shown while "keep running in the tray" is on. */
export class TrayManager {
  private tray: Tray | null = null;
  private lastKey = '';

  constructor(
    private iconPath: string,
    private actions: TrayActions,
  ) {}

  update(enabled: boolean, state: AutomationState): void {
    if (!enabled) {
      this.tray?.destroy();
      this.tray = null;
      this.lastKey = '';
      return;
    }
    if (!this.tray) {
      const img = nativeImage.createFromPath(this.iconPath);
      this.tray = new Tray(img.isEmpty() ? img : img.resize({ width: 16, height: 16 }));
      this.tray.on('click', () => this.actions.show());
    }
    const watches = state.watches.filter((w) => w.enabled).length;
    const schedules = state.schedules.filter((s) => s.enabled && s.activeHere).length;
    const busy = state.watches.some((w) => w.status === 'sending') || state.schedules.some((s) => s.running);
    const summary = `${watches} izleme • ${schedules} zamanlanmış iş`;
    const key = `${state.paused}|${busy}|${summary}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.tray.setToolTip(`SamSync — ${state.paused ? 'otomasyon duraklatıldı' : busy ? 'gönderiliyor…' : summary}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'SamSync’i aç', click: () => this.actions.show() },
        { type: 'separator' },
        { label: summary, enabled: false },
        { label: state.paused ? 'Otomasyonu sürdür' : 'Otomasyonu duraklat', click: () => this.actions.setPaused(!state.paused) },
        { type: 'separator' },
        { label: 'Çıkış', click: () => this.actions.quit() },
      ]),
    );
  }
}
