import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, NodeConfig } from '../src/shared/types';
import { emptyConfig } from '../src/core/config';
import { menuEntries, explorerPlan, entryCommand, quoteArg } from '../src/shared/menu';
import { explorerRegBody, explorerRegFile, EXPLORER_ROOT } from '../src/main/integration/explorer';
import {
  parseShortcut,
  updateShortcutsXml,
  updateTabMenuXml,
  signConfigXml,
  shortcutsHmac,
  nppPlan,
  applyNotepadPlusPlus,
  versionTooOld,
  DEFAULT_TAB_MENU_XML,
  type NppInstall,
} from '../src/main/integration/notepadpp';
import { tmpDir, read } from './helpers';

const node = (id: string, group?: string, extra: Partial<NodeConfig> = {}): NodeConfig => ({ id, name: `${id} adı`, group, address: '10.0.0.1', localRoots: ['C:\\x'], networkRoot: 'x', enabled: true, ...extra });

/** The machine list of the PowerShell tool's config: four groups and one machine outside them. */
function fleet(): AppConfig {
  const cfg = emptyConfig();
  cfg.nodes = [
    node('Root'),
    ...['Server', 'PC1', 'PC2', 'PC3', 'PC4'].map((x) => node(`Delta${x}`, 'Delta')),
    ...[1, 2, 3].flatMap((u) => ['Server', 'PC1', 'PC2', 'PC3'].map((x) => node(`Lab${u}${x}`, `Lab${u}`))),
    node('Old', undefined, { enabled: false }),
  ];
  return cfg;
}

describe('menu entries', () => {
  it('lists aggregates, profiles, groups with their machines and the rest, without this machine or disabled ones', () => {
    const cfg = fleet();
    cfg.profiles = [{ id: 'Gece', name: 'Gece', targetIds: ['Root'] }];
    const ids = menuEntries(cfg, 'Lab2PC1').map((e) => e.id);
    expect(ids.slice(0, 6)).toEqual(['all', 'wizard', 'wizard:last', 'restore', 'profile:Gece', 'group:Delta']);
    expect(ids).toContain('Lab2Server');
    expect(ids).not.toContain('Lab2PC1');
    expect(ids).not.toContain('Old');
    expect(ids[ids.length - 1]).toBe('Root');
  });

  it('builds the command for each entry', () => {
    const [all, wizard, last, restore] = menuEntries(fleet());
    const exe = '"C:\\Apps\\SamSync\\SamSync.exe"';
    expect(entryCommand(exe, all, '%1')).toBe('"C:\\Apps\\SamSync\\SamSync.exe" --send --to all --yes "%1"');
    expect(entryCommand(exe, wizard, '%1')).toBe('"C:\\Apps\\SamSync\\SamSync.exe" --send "%1"');
    expect(entryCommand(exe, last, '%1')).toContain('--to last --yes');
    expect(entryCommand(exe, restore, '%1')).toContain('--restore "%1"');
    expect(quoteArg('group:Unit 1')).toBe('"group:Unit 1"');
  });
});

describe('Explorer menu plan (16 items)', () => {
  it('collapses every group on a machine outside the groups when expanding them would not fit', () => {
    const p = explorerPlan(menuEntries(fleet(), 'Root'));
    expect(p.items.map((i) => i.entry.id)).toEqual(['all', 'wizard', 'wizard:last', 'restore', 'group:Delta', 'group:Lab1', 'group:Lab2', 'group:Lab3']);
    expect(p.expanded).toEqual([]);
    expect(p.items.map((i) => i.separatorBefore)).toEqual([false, true, false, true, true, false, false, false]);
  });

  it("expands this machine's own group first and keeps the others collapsed", () => {
    const p = explorerPlan(menuEntries(fleet(), 'Lab2Server'), { localGroup: 'Lab2' });
    expect(p.expanded).toEqual(['Lab2']);
    const u2 = p.items.find((i) => i.entry.id === 'group:Lab2')!;
    expect(u2.children!.map((c) => c.id)).toEqual(['group:Lab2', 'Lab2PC1', 'Lab2PC2', 'Lab2PC3']);
    expect(u2.children![0].label).toBe('Lab2 - Tümü');
    expect(p.items[p.items.length - 1].entry.id).toBe('Root');
    expect(p.overBudget).toBe(false);
  });

  it('expands all groups when they fit, nothing with never, everything with always', () => {
    const small = emptyConfig();
    small.nodes = [node('A1', 'A'), node('A2', 'A'), node('B1', 'B'), node('Solo')];
    expect(explorerPlan(menuEntries(small)).expanded).toEqual(['A', 'B']);
    expect(explorerPlan(menuEntries(small), { showNodes: 'never' }).items.map((i) => i.entry.id)).toEqual(['all', 'wizard', 'wizard:last', 'restore', 'group:A', 'group:B']);
    const always = explorerPlan(menuEntries(fleet(), 'Root'), { showNodes: 'always' });
    expect(always.expanded).toHaveLength(4);
    expect(always.overBudget).toBe(true);
  });

  it('writes the cascade as .reg text with separators, icons on aggregates and quoted commands', () => {
    const plan = explorerPlan(menuEntries(fleet(), 'Lab2Server'), { localGroup: 'Lab2' });
    const body = explorerRegBody({ title: 'SamSync', plan, launcher: '"C:\\Apps\\SamSync\\SamSync.exe"', icon: '"C:\\Apps\\SamSync\\SamSync.exe",0' });
    expect(body).toContain(`[${EXPLORER_ROOT}]\r\n"MUIVerb"="SamSync"`);
    expect(body).toContain(`[${EXPLORER_ROOT}\\shell\\000_all]\r\n"MUIVerb"="Tümüne gönder"\r\n"Icon"="\\"C:\\\\Apps\\\\SamSync\\\\SamSync.exe\\",0"\r\n"MultiSelectModel"="Player"`);
    expect(body).toContain(`[${EXPLORER_ROOT}\\shell\\000_all\\command]\r\n@="\\"C:\\\\Apps\\\\SamSync\\\\SamSync.exe\\" --send --to all --yes \\"%1\\""`);
    expect(body).toMatch(/\\shell\\010_wizard\]\r\n[^[]*"CommandFlags"=dword:00000020/);
    expect(body).toMatch(/\\shell\\060_group_Lab2\]\r\n[^[]*"SubCommands"=""/);
    expect(body).toContain('\\shell\\060_group_Lab2\\shell\\010_Lab2PC1\\command]');
    const file = explorerRegFile({ title: 'SamSync', plan, launcher: '"x.exe"', icon: 'x.exe' });
    expect(file.text.startsWith('Windows Registry Editor Version 5.00\r\n\r\n[-HKEY_CURRENT_USER')).toBe(true);
    expect(file.text).toContain(`"SamSyncMenu"="${file.hash}"`);
    expect(explorerRegFile({ title: 'SamSync', plan, launcher: '"x.exe"', icon: 'x.exe' }).hash).toBe(file.hash);
  });
});

describe('Notepad++ shortcuts', () => {
  it('parses modifiers, letters, F keys and named keys', () => {
    expect(parseShortcut('Ctrl+Alt+W')).toEqual({ ctrl: true, alt: true, shift: false, key: 87 });
    expect(parseShortcut('shift + f5')).toEqual({ ctrl: false, alt: false, shift: true, key: 116 });
    expect(parseShortcut('Ctrl+PageDown').key).toBe(34);
    expect(() => parseShortcut('W')).toThrow(/değiştirici/);
    expect(() => parseShortcut('Ctrl+A+B')).toThrow(/tek bir tuş/);
    expect(() => parseShortcut('Ctrl+Hyper')).toThrow(/Tanınmayan/);
  });

  it('knows which versions are too old', () => {
    expect(versionTooOld('8.4.7')).toBe(true);
    expect(versionTooOld('8.4.8')).toBe(false);
    expect(versionTooOld('8.9.7.0')).toBe(false);
    expect(versionTooOld(undefined)).toBe(false);
  });
});

const USER_SHORTCUTS = [
  '<?xml version="1.0" encoding="UTF-8" ?>',
  '<NotepadPlus>',
  '    <InternalCommands />',
  '    <Macros>',
  '        <Macro name="Trim" Ctrl="yes" Alt="yes" Shift="no" Key="87">',
  '            <Action type="2" message="0" wParam="42024" lParam="0" sParam="" />',
  '        </Macro>',
  '    </Macros>',
  '    <UserDefinedCommands>',
  '        <Command name="Launch in Firefox" Ctrl="yes" Alt="yes" Shift="yes" Key="88">firefox &quot;$(FULL_CURRENT_PATH)&quot;</Command>',
  '    </UserDefinedCommands>',
  '    <PluginCommands />',
  '    <ScintillaKeys />',
  '</NotepadPlus>',
  '',
].join('\r\n');

describe('Notepad++ files', () => {
  const launcher = '"C:\\Apps\\SamSync\\SamSync.exe"';

  it('adds our Run commands next to the user ones and takes them out again without touching the rest', () => {
    const plan = nppPlan(menuEntries(fleet(), 'Root'), launcher, { 'wizard:last': 'Ctrl+Alt+W' }, USER_SHORTCUTS);
    const xml = updateShortcutsXml(USER_SHORTCUTS, plan.commands);
    expect(xml).toContain('        <Command name="[SamSync] wizard:last" Ctrl="yes" Alt="yes" Shift="no" Key="87">&quot;C:\\Apps\\SamSync\\SamSync.exe&quot; --send --to last --yes &quot;$(FULL_CURRENT_PATH)&quot;</Command>\r\n');
    expect(xml).toContain('Launch in Firefox');
    expect(xml.indexOf('[SamSync] all')).toBeLessThan(xml.indexOf('</UserDefinedCommands>'));
    expect(updateShortcutsXml(xml, plan.commands)).toBe(xml);
    expect(updateShortcutsXml(xml, [])).toBe(USER_SHORTCUTS);
    // the macro on Ctrl+Alt+W is reported
    expect(plan.warnings.some((w) => w.includes('Trim'))).toBe(true);
  });

  it('opens a self-closing or missing UserDefinedCommands section and builds a new file', () => {
    const cmd = [{ name: '[SamSync] all', text: 'x' }];
    expect(updateShortcutsXml('<NotepadPlus>\n    <UserDefinedCommands />\n</NotepadPlus>\n', cmd)).toBe('<NotepadPlus>\n    <UserDefinedCommands>\n        <Command name="[SamSync] all" Ctrl="no" Alt="no" Shift="no" Key="0">x</Command>\n    </UserDefinedCommands>\n</NotepadPlus>\n');
    expect(updateShortcutsXml('<NotepadPlus>\n</NotepadPlus>\n', cmd)).toContain('    <UserDefinedCommands>\n        <Command name="[SamSync] all"');
    expect(updateShortcutsXml(null, cmd)).toContain('<ScintillaKeys />');
  });

  it('puts a folder in the tab menu with separators between sections and removes it with its separators', () => {
    const plan = nppPlan(menuEntries(fleet(), 'Root'), launcher, {}, null);
    const xml = updateTabMenuXml(DEFAULT_TAB_MENU_XML, 'SamSync', plan.tabItems);
    expect(xml).toContain('<Item FolderName="SamSync" MenuEntryName="Run" MenuItemName="[SamSync] all" ItemNameAs="Tümüne gönder" />');
    // all | review + last | restore | Delta | Lab1 | Lab2 | Lab3
    expect(xml.match(/FolderName="SamSync" id="0"/g)).toHaveLength(6);
    expect(xml).toContain('ItemNameAs="DeltaPC1 adı"');
    expect(updateTabMenuXml(xml, 'SamSync', plan.tabItems)).toBe(xml);
    expect(updateTabMenuXml(xml, 'SamSync', [])).toBe(DEFAULT_TAB_MENU_XML);
  });

  it('skips entries whose command is longer than Notepad++ accepts and rejects a shortcut used twice', () => {
    const long = `"C:\\${'x'.repeat(205)}\\SamSync.exe"`;
    const plan = nppPlan(menuEntries(fleet(), 'Root'), long, { all: 'Ctrl+Alt+Q', 'group:delta': 'ctrl+alt+q', nope: 'Ctrl+1' }, null);
    expect(plan.skipped).toContain('all');
    expect(plan.commands.find((c) => c.name === '[SamSync] wizard')).toBeDefined();
    expect(plan.warnings.some((w) => w.includes('iki girdiye'))).toBe(true);
    expect(plan.warnings.some((w) => w.includes('nope'))).toBe(true);
  });

  it('stores the signature in config.xml, replacing an old one and keeping CRLF', () => {
    const cfg = '<NotepadPlus>\r\n    <GUIConfigs>\r\n        <GUIConfig name="TabBar" />\r\n    </GUIConfigs>\r\n</NotepadPlus>\r\n';
    const once = signConfigXml(cfg, 'abc')!;
    expect(once).toContain('        <GUIConfig name="shortcutsXmlHMAC" value="abc" />\r\n    </GUIConfigs>');
    expect(signConfigXml(once, 'def')).toBe(once.replace('abc', 'def'));
    expect(signConfigXml('<NotepadPlus>\n</NotepadPlus>\n', 'v')).toContain('    <GUIConfigs>\n        <GUIConfig name="shortcutsXmlHMAC" value="v" />\n    </GUIConfigs>\n</NotepadPlus>');
    expect(signConfigXml('<x/>', 'v')).toBeNull();
  });

  it('installs into a configuration folder, signs it, does nothing the second time and uninstalls cleanly', async () => {
    const dir = await tmpDir('samsync-npp-');
    const install: NppInstall = { exe: path.join(dir, 'notepad++.exe'), version: '8.9.7', configDir: dir, portable: true, running: false };
    await fsp.writeFile(path.join(dir, 'shortcuts.xml'), USER_SHORTCUTS);
    await fsp.writeFile(path.join(dir, 'config.xml'), '<NotepadPlus>\r\n    <GUIConfigs>\r\n    </GUIConfigs>\r\n</NotepadPlus>\r\n');
    const guid = '0f1e2d3c-1111-2222-3333-444455556666';
    const plan = nppPlan(menuEntries(fleet(), 'Root'), launcher, { 'wizard:last': 'Ctrl+Alt+W' }, USER_SHORTCUTS);

    const first = await applyNotepadPlusPlus(install, 'SamSync', plan, guid);
    expect(first.changed).toBe(true);
    expect(first.installed).toBe(true);
    const bytes = await fsp.readFile(path.join(dir, 'shortcuts.xml'));
    expect(read(path.join(dir, 'config.xml'))).toContain(`value="${shortcutsHmac(guid, bytes)}"`);
    expect(read(path.join(dir, 'tabContextMenu.xml'))).toContain('MenuItemName="[SamSync] wizard:last"');

    expect((await applyNotepadPlusPlus(install, 'SamSync', plan, guid)).changed).toBe(false);

    const removed = await applyNotepadPlusPlus(install, 'SamSync', null, guid);
    expect(removed.installed).toBe(false);
    expect(read(path.join(dir, 'shortcuts.xml'))).toBe(USER_SHORTCUTS);
    expect(read(path.join(dir, 'tabContextMenu.xml'))).not.toContain('SamSync');
    expect(read(path.join(dir, 'config.xml'))).toContain(`value="${shortcutsHmac(guid, Buffer.from(USER_SHORTCUTS))}"`);
  });

  it('leaves an old Notepad++ alone', async () => {
    const dir = await tmpDir('samsync-npp-');
    const install: NppInstall = { exe: path.join(dir, 'notepad++.exe'), version: '8.1.0', configDir: dir, portable: true, running: false };
    const r = await applyNotepadPlusPlus(install, 'SamSync', nppPlan(menuEntries(fleet()), launcher, {}, null), null);
    expect(r.installed).toBe(false);
    expect(r.warnings[0]).toMatch(/8\.4\.8/);
    expect(read(path.join(dir, 'shortcuts.xml'))).toBeNull();
  });
});
