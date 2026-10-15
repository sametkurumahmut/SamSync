// The entries of the right-click menus (Explorer and Notepad++), built from the machine list. Pure: no Electron,
// no registry, so the tests can run it anywhere. The ids are the ones the PowerShell tool used, so a shared
// config.json keeps its notepadPlusPlusShortcuts keys ("wizard:last", "group:Unit1", node ids).
import type { AppConfig } from './types';
import { t } from './i18n';

export type EntryKind = 'all' | 'wizard' | 'wizardLast' | 'restore' | 'profile' | 'group' | 'node';
export type Section = 'all' | 'wizard' | 'restore' | 'profile' | 'group' | 'single';

export interface MenuEntry {
  kind: EntryKind;
  /** all, wizard, wizard:last, restore, profile:<name>, group:<name> or a node id. */
  id: string;
  label: string;
  section: Section;
  /** Group of a group entry or of a node inside a group. */
  group?: string;
  /** Aggregate entries carry the app icon; single machines do not. */
  icon: boolean;
  /** Command-line arguments that go before the selected path. */
  args: string[];
}

export type ShowNodes = 'auto' | 'always' | 'never';

/** Every entry, in menu order: all, review, last settings, restore, profiles, groups with their machines, the rest. */
export function menuEntries(cfg: AppConfig, localNodeId?: string): MenuEntry[] {
  const targets = cfg.nodes.filter((n) => n.enabled && n.id !== localNodeId);
  const out: MenuEntry[] = [
    { kind: 'all', id: 'all', label: t('Tümüne gönder'), section: 'all', icon: true, args: ['--to', 'all', '--yes'] },
    { kind: 'wizard', id: 'wizard', label: t('İncele ve gönder…'), section: 'wizard', icon: true, args: [] },
    { kind: 'wizardLast', id: 'wizard:last', label: t('Son ayarla gönder'), section: 'wizard', icon: true, args: ['--to', 'last', '--yes'] },
    { kind: 'restore', id: 'restore', label: t('Yedekten geri al…'), section: 'restore', icon: true, args: ['--restore'] },
  ];
  for (const p of cfg.profiles) {
    out.push({ kind: 'profile', id: `profile:${p.name}`, label: t('{name} (profil)', { name: p.name }), section: 'profile', icon: true, args: ['--to', `profile:${p.id}`, '--yes'] });
  }
  const groups: string[] = [];
  for (const n of targets) if (n.group && !groups.includes(n.group)) groups.push(n.group);
  for (const g of groups) {
    out.push({ kind: 'group', id: `group:${g}`, label: g, section: 'group', group: g, icon: true, args: ['--to', `group:${g}`, '--yes'] });
    for (const n of targets.filter((x) => x.group === g)) {
      out.push({ kind: 'node', id: n.id, label: n.name || n.id, section: 'group', group: g, icon: false, args: ['--to', n.id, '--yes'] });
    }
  }
  for (const n of targets.filter((x) => !x.group)) {
    out.push({ kind: 'node', id: n.id, label: n.name || n.id, section: 'single', icon: false, args: ['--to', n.id, '--yes'] });
  }
  return out;
}

export interface PlannedItem {
  entry: MenuEntry;
  /** An expanded group: its "<group> - All" entry and then its machines. */
  children?: MenuEntry[];
  separatorBefore: boolean;
}

export interface MenuPlan {
  items: PlannedItem[];
  expanded: string[];
  collapsed: string[];
  /** More items than the budget (only possible with "always"; submenu items count, separators do not). */
  overBudget: boolean;
}

/**
 * Explorer shows a static cascade menu comfortably up to 16 items, so not every machine fits. Aggregate entries
 * and one entry per group always go in; machines outside groups and the machines of each group (as a submenu)
 * go in while they fit, this machine's own group first, the other groups all together or not at all.
 */
export function explorerPlan(entries: MenuEntry[], opts: { showNodes?: ShowNodes; localGroup?: string; budget?: number } = {}): MenuPlan {
  const budget = opts.budget ?? 16;
  const showNodes = opts.showNodes ?? 'auto';
  const agg = entries.filter((e) => e.kind !== 'group' && e.kind !== 'node');
  const groups = entries.filter((e) => e.kind === 'group');
  const members = (g: string) => entries.filter((e) => e.kind === 'node' && e.group === g);
  const ungrouped = entries.filter((e) => e.kind === 'node' && !e.group);
  const cost = (g: string) => 1 + members(g).length;

  let used = agg.length + groups.length;
  let includeUngrouped = false;
  const expand = new Set<string>();
  if (!groups.length) includeUngrouped = true;
  else if (showNodes === 'always') {
    includeUngrouped = true;
    groups.forEach((g) => expand.add(g.group!));
  } else if (showNodes === 'auto') {
    if (used + ungrouped.length <= budget) {
      includeUngrouped = true;
      used += ungrouped.length;
    }
    if (opts.localGroup && groups.some((g) => g.group === opts.localGroup) && used + cost(opts.localGroup) <= budget) {
      expand.add(opts.localGroup);
      used += cost(opts.localGroup);
    }
    const rest = groups.filter((g) => !expand.has(g.group!));
    const restCost = rest.reduce((s, g) => s + cost(g.group!), 0);
    if (rest.length && used + restCost <= budget) rest.forEach((g) => expand.add(g.group!));
  }

  const items: PlannedItem[] = [];
  let prev = '';
  let total = 0;
  for (const e of entries) {
    if (e.kind === 'node' && (e.group || !includeUngrouped)) continue;
    const item: PlannedItem = { entry: e, separatorBefore: prev !== '' && prev !== e.section };
    if (e.kind === 'group' && expand.has(e.group!)) {
      item.children = [{ ...e, label: t('{group} - Tümü', { group: e.group! }) }, ...members(e.group!)];
      total += item.children.length;
    }
    items.push(item);
    total++;
    prev = e.section;
  }
  return {
    items,
    expanded: groups.filter((g) => expand.has(g.group!)).map((g) => g.group!),
    collapsed: groups.filter((g) => !expand.has(g.group!)).map((g) => g.group!),
    overBudget: total > budget,
  };
}

/** Quotes one command-line argument for Windows when it needs it. */
export function quoteArg(a: string): string {
  return /[\s"]/.test(a) || a === '' ? `"${a.replace(/"/g, '\\"')}"` : a;
}

/** "<launcher> <args> "<path>"" for an entry; launcher is the already quoted program (and app folder in dev). */
export function entryCommand(launcher: string, e: MenuEntry, pathToken: string): string {
  return [launcher, '--send', ...e.args.map(quoteArg), `"${pathToken}"`].join(' ');
}
