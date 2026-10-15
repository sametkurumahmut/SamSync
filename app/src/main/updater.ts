import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { LocalSettings, UpdateConfig, UpdateState } from '../shared/types';

const { autoUpdater } = electronUpdater;

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function cmpSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Minimal reader for electron-builder's yml files (top level scalars only). */
export function parseLatestYml(text: string): { version?: string; path?: string; sha512?: string; releaseDate?: string; releaseNotes?: string; owner?: string; repo?: string } {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z]\w*):\s*(.*)$/.exec(line);
    if (m && m[2] !== '') out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * The GitHub repository the build was published from. electron-builder writes it into app-update.yml
 * from the git remote at build time, so the code itself names no repository.
 */
function githubFeed(): { provider: 'github'; owner: string; repo: string } | null {
  try {
    const y = parseLatestYml(fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'));
    return y.owner && y.repo && y.owner !== 'none' ? { provider: 'github', owner: y.owner, repo: y.repo } : null;
  } catch {
    return null;
  }
}

/**
 * Two update paths behind one state machine:
 *  - github / url: electron-updater (NSIS on Windows, AppImage on Linux, signed builds on macOS)
 *  - folder: a shared LAN folder holding latest.yml + the NSIS installer, for machines without internet
 */
export class Updater {
  private st: UpdateState;
  private cfg: UpdateConfig = { source: 'github' };
  private settings!: LocalSettings;
  private timer: NodeJS.Timeout | null = null;
  private folderInstaller: string | null = null;
  private folderInfo: ReturnType<typeof parseLatestYml> | null = null;
  private wired = false;

  constructor(private emit: (s: UpdateState) => void) {
    this.st = { phase: 'idle', source: 'github', currentVersion: app.getVersion() };
  }

  private set(patch: Partial<UpdateState>) {
    this.st = { ...this.st, ...patch, source: this.cfg.source, currentVersion: app.getVersion() };
    this.emit(this.st);
  }

  state(): UpdateState {
    return this.st;
  }

  private supportReason(): string | null {
    if (!app.isPackaged) return 'Geliştirme modunda güncelleme denetlenmez.';
    if (process.env.PORTABLE_EXECUTABLE_DIR) return 'Taşınabilir (portable) sürüm kendini güncelleyemez; kurulum sürümünü kullanın.';
    if (this.cfg.source === 'off') return 'Güncellemeler kapalı.';
    if (this.cfg.source === 'folder' && process.platform !== 'win32') return 'Klasörden güncelleme yalnızca Windows kurulumunda desteklenir.';
    if (this.cfg.source === 'folder' && !this.cfg.folder) return 'Güncelleme klasörü ayarlanmamış.';
    if (this.cfg.source === 'url' && !this.cfg.url) return 'Güncelleme adresi ayarlanmamış.';
    if (process.platform === 'linux' && !process.env.APPIMAGE && this.cfg.source !== 'folder') return 'Linux’ta otomatik güncelleme yalnızca AppImage paketinde çalışır.';
    if (this.cfg.source === 'github' && !githubFeed()) return 'Bu pakette GitHub güncelleme adresi yok.';
    return null;
  }

  configure(cfg: UpdateConfig | undefined, settings: LocalSettings) {
    this.cfg = cfg ?? { source: 'github' };
    this.settings = settings;
    const reason = this.supportReason();
    if (reason) {
      this.set({ phase: 'unsupported', detail: reason });
    } else if (this.st.phase === 'unsupported') this.set({ phase: 'idle', detail: undefined });

    if (!reason && this.cfg.source !== 'folder') {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.setFeedURL(this.cfg.source === 'url' ? { provider: 'generic', url: this.cfg.url! } : githubFeed()!);
      this.wire();
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!reason && settings.updateAutoCheck) {
      setTimeout(() => void this.check(true), 8000);
      this.timer = setInterval(() => void this.check(true), CHECK_EVERY_MS);
    }
  }

  private wire() {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking', error: undefined }));
    autoUpdater.on('update-available', (info) => {
      this.set({ phase: 'available', version: info.version, releaseDate: info.releaseDate, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined, checkedAt: Date.now() });
      if (this.settings?.updateAutoDownload) void this.download();
    });
    autoUpdater.on('update-not-available', () => this.set({ phase: 'none', checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.set({ phase: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond }));
    autoUpdater.on('update-downloaded', (info) => this.set({ phase: 'ready', version: info.version, percent: 100 }));
    autoUpdater.on('error', (e) => this.set({ phase: 'error', error: e?.message ?? String(e) }));
  }

  async check(silent = false): Promise<UpdateState> {
    const reason = this.supportReason();
    if (reason) {
      this.set({ phase: 'unsupported', detail: reason });
      return this.st;
    }
    if (this.st.phase === 'downloading' || this.st.phase === 'ready') return this.st;
    try {
      if (this.cfg.source === 'folder') await this.checkFolder();
      else await autoUpdater.checkForUpdates();
    } catch (e) {
      if (!silent || this.st.phase !== 'error') this.set({ phase: 'error', error: (e as Error).message });
    }
    return this.st;
  }

  private async checkFolder() {
    this.set({ phase: 'checking', error: undefined });
    const folder = this.cfg.folder!;
    const yml = await fsp.readFile(path.join(folder, 'latest.yml'), 'utf8');
    const info = parseLatestYml(yml);
    if (!info.version || !info.path) throw new Error('latest.yml içinde version/path yok');
    this.folderInfo = info;
    if (cmpSemver(info.version, app.getVersion()) > 0) {
      this.set({ phase: 'available', version: info.version, releaseDate: info.releaseDate, checkedAt: Date.now() });
      if (this.settings?.updateAutoDownload) await this.download();
    } else this.set({ phase: 'none', version: info.version, checkedAt: Date.now() });
  }

  async download(): Promise<UpdateState> {
    if (this.st.phase !== 'available') return this.st;
    try {
      if (this.cfg.source !== 'folder') {
        this.set({ phase: 'downloading', percent: 0 });
        await autoUpdater.downloadUpdate();
        return this.st;
      }
      const info = this.folderInfo!;
      const src = path.join(this.cfg.folder!, info.path!);
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'samsync-update-'));
      const dst = path.join(dir, path.basename(info.path!));
      const total = (await fsp.stat(src)).size;
      this.set({ phase: 'downloading', percent: 0 });
      const hash = createHash('sha512');
      let done = 0;
      await new Promise<void>((resolve, reject) => {
        const rs = fs.createReadStream(src);
        const ws = fs.createWriteStream(dst);
        rs.on('data', (c) => {
          hash.update(c as Buffer);
          done += (c as Buffer).length;
          this.set({ phase: 'downloading', percent: (done / total) * 100 });
        });
        rs.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', () => resolve());
        rs.pipe(ws);
      });
      if (info.sha512 && hash.digest('base64') !== info.sha512) throw new Error('Kurulum dosyasının özeti latest.yml ile tutmuyor');
      this.folderInstaller = dst;
      this.set({ phase: 'ready', percent: 100 });
    } catch (e) {
      this.set({ phase: 'error', error: (e as Error).message });
    }
    return this.st;
  }

  install() {
    if (this.st.phase !== 'ready') return;
    if (this.cfg.source !== 'folder') {
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    if (!this.folderInstaller) return;
    // NSIS: /S silent, --updated keeps the shortcuts, --force-run starts the app again afterwards
    spawn(this.folderInstaller, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.quit(), 300);
  }
}
