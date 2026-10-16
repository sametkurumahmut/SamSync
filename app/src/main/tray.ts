import { Menu, Tray, nativeImage } from 'electron';
import type { AutomationState, QuickSend } from '../shared/types';
import { getLang, t } from '../shared/i18n';

export interface TrayActions {
  show(): void;
  setPaused(paused: boolean): void;
  quit(): void;
  /** The saved sends of this machine, for the "Hızlı gönder" submenu. */
  quickSends(): QuickSend[];
  runQuick(q: QuickSend): void;
}

/** Notification area icon, shown while "keep running in the tray" is on. */
export class TrayManager {
  private tray: Tray | null = null;
  private lastKey = '';

  constructor(
    private iconPath: string,
    private actions: TrayActions,
  ) {}

  /** Builds the menu and tooltip again whenever the state or the UI language changed. */
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
    const summary = t('{watches} izleme • {schedules} zamanlanmış iş', { watches, schedules });
    const quick = this.actions.quickSends();
    const key = `${getLang()}|${state.paused}|${busy}|${summary}|${quick.map((q) => q.id + q.name).join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.tray.setToolTip(`SamSync — ${state.paused ? t('otomasyon duraklatıldı') : busy ? t('gönderiliyor…') : summary}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('SamSync’i aç'), click: () => this.actions.show() },
        ...(quick.length ? [{ label: t('Hızlı gönder'), submenu: quick.map((q) => ({ label: q.name, click: () => this.actions.runQuick(q) })) }] : []),
        { type: 'separator' },
        { label: summary, enabled: false },
        { label: state.paused ? t('Otomasyonu sürdür') : t('Otomasyonu duraklat'), click: () => this.actions.setPaused(!state.paused) },
        { type: 'separator' },
        { label: t('Çıkış'), click: () => this.actions.quit() },
      ]),
    );
  }
}
