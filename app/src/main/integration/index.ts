// Keeps the Explorer menu and the Notepad++ entries in step with the machine list, the language and the
// settings: rebuilt shortly after any of them changes and on every start (so the menu follows the program
// after an update or a move), written only when something differs.
import type { IntegrationStatus } from '../../shared/api';
import type { AppConfig, LocalSettings, NodeConfig } from '../../shared/types';
import type { Logger } from '../../core/logger';
import { t } from '../../shared/i18n';
import { errMessage } from '../../core/util';
import { explorerPlan, menuEntries } from '../../shared/menu';
import { explorerInstall, explorerRemove, explorerState } from './explorer';
import { applyNotepadPlusPlus, findNotepadPlusPlus, machineGuid, notepadPlusPlusRunning, nppInstalled, nppPlan } from './notepadpp';

export const MENU_TITLE = 'SamSync';
const DEFAULT_SHORTCUTS = { 'wizard:last': 'Ctrl+Alt+W' };

export interface IntegrationDeps {
  config(): AppConfig;
  localNode(): NodeConfig | null;
  settings(): LocalSettings;
  /** Quoted program (and app folder in development) the menu commands start. */
  launcher(): string;
  /** Icon resource for the menu, "C:\...\SamSync.exe",0 */
  icon(): string;
  log: Logger;
  onChange(s: IntegrationStatus): void;
  /** Whether a switch nobody has touched counts as on: the installed app yes, a development run no. */
  defaultOn: boolean;
}

/** Takes the Explorer menu and every Notepad++ entry out (the uninstaller runs this). */
export async function removeIntegrations(): Promise<void> {
  if (process.platform !== 'win32') return;
  await explorerRemove().catch(() => undefined);
  const guid = await machineGuid();
  for (const i of await findNotepadPlusPlus()) await applyNotepadPlusPlus(i, MENU_TITLE, null, guid).catch(() => undefined);
}

export class Integrations {
  private st: IntegrationStatus = {
    // SAMSYNC_NO_INTEGRATION: a test run of a packaged build leaves this machine's menus alone
    supported: process.platform === 'win32' && !process.env.SAMSYNC_NO_INTEGRATION,
    explorer: { enabled: true, installed: false, expanded: [], collapsed: [], overBudget: false },
    notepadPlusPlus: { enabled: true, installs: [], waitingForExit: false },
  };
  private timer: NodeJS.Timeout | null = null;
  private exitWatch: NodeJS.Timeout | null = null;
  private running: Promise<IntegrationStatus> | null = null;
  private again = false;

  constructor(private deps: IntegrationDeps) {}

  status(): IntegrationStatus {
    return this.st;
  }

  /** Re-applies a moment later, so a burst of config saves writes once. */
  refresh(delayMs = 800): void {
    if (!this.st.supported) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.apply(), delayMs);
  }

  async apply(force = false): Promise<IntegrationStatus> {
    if (!this.st.supported) return this.st;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.doApply(force).finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.refresh(0);
      }
    });
    return this.running;
  }

  private async doApply(force: boolean): Promise<IntegrationStatus> {
    const s = this.deps.settings();
    const cfg = this.deps.config();
    const local = this.deps.localNode();
    const entries = menuEntries(cfg, local?.id);
    const log = this.deps.log;

    // ---- Explorer
    const ex = this.st.explorer;
    ex.enabled = s.explorerMenu ?? this.deps.defaultOn;
    ex.error = undefined;
    try {
      if (ex.enabled) {
        const plan = explorerPlan(entries, { showNodes: cfg.menuShowNodes, localGroup: local?.group });
        ex.expanded = plan.expanded;
        ex.collapsed = plan.collapsed;
        ex.overBudget = plan.overBudget;
        const wrote = await explorerInstall({ title: MENU_TITLE, plan, launcher: this.deps.launcher(), icon: this.deps.icon() }, force);
        if (wrote) {
          log.info(t('Explorer menüsü'), t('Menü yazıldı: {n} girdi; alt menüsü açık gruplar: {open}; tek girdi olan gruplar: {closed}', { n: plan.items.length, open: plan.expanded.join(', ') || '-', closed: plan.collapsed.join(', ') || '-' }));
        }
        if (plan.overBudget) log.warn(t('Explorer menüsü'), t('Menüde 16 girdiden fazlası var; Windows bazılarını göstermeyebilir'));
      } else if (s.explorerMenu === false && (await explorerState()).installed) {
        // only an explicit "off" removes it: a development run must not take away the installed app's menu
        await explorerRemove();
        log.info(t('Explorer menüsü'), t('Menü kaldırıldı'));
      }
      const state = await explorerState();
      ex.installed = state.installed;
      ex.command = state.command;
    } catch (e) {
      ex.error = errMessage(e);
      log.error(t('Explorer menüsü'), t('Menü yazılamadı'), e);
    }

    // ---- Notepad++
    const np = this.st.notepadPlusPlus;
    np.enabled = s.notepadPlusPlus ?? this.deps.defaultOn;
    np.error = undefined;
    try {
      const installs = await findNotepadPlusPlus();
      const guid = installs.length ? await machineGuid() : null;
      const shortcuts = cfg.notepadPlusPlusShortcuts ?? DEFAULT_SHORTCUTS;
      let changedWhileOpen = false;
      np.installs = [];
      for (const i of installs) {
        let warnings: string[] = [];
        let installed = await nppInstalled(i);
        if (np.enabled || (installed && s.notepadPlusPlus === false)) {
          const plan = np.enabled ? nppPlan(entries, this.deps.launcher(), shortcuts, null) : null;
          const r = await applyNotepadPlusPlus(i, MENU_TITLE, plan, guid);
          warnings = [...(plan?.warnings ?? []), ...r.warnings];
          installed = r.installed;
          if (r.changed) {
            log.info('Notepad++', np.enabled ? t('{dir} içine menü ve kısayollar yazıldı', { dir: i.configDir }) : t('{dir} içinden menü ve kısayollar kaldırıldı', { dir: i.configDir }));
            if (i.running) changedWhileOpen = true;
          }
          for (const w of warnings) log.warn('Notepad++', w);
        }
        np.installs.push({ ...i, installed, warnings });
      }
      np.waitingForExit = changedWhileOpen;
      if (changedWhileOpen) this.watchExit();
    } catch (e) {
      np.error = errMessage(e);
      log.error('Notepad++', t('Notepad++ ayarları yazılamadı'), e);
    }

    this.st = { ...this.st };
    this.deps.onChange(this.st);
    return this.st;
  }

  /** Notepad++ writes its in-memory settings back when it exits; apply again once it has closed. */
  private watchExit() {
    if (this.exitWatch) return;
    this.exitWatch = setInterval(async () => {
      if (await notepadPlusPlusRunning()) return;
      clearInterval(this.exitWatch!);
      this.exitWatch = null;
      this.deps.log.info('Notepad++', t('Notepad++ kapandı; menü ve kısayollar yeniden yazılıyor'));
      await this.apply(true);
    }, 15000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.exitWatch) clearInterval(this.exitWatch);
  }
}
