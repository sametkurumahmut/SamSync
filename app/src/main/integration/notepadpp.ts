// Notepad++ integration (Windows): a "SamSync" folder in the tab right-click menu and Run commands with optional
// shortcuts (Ctrl+Alt+W = send with the last settings), the same entries as the Explorer menu.
//
// Notepad++ reads Run commands from shortcuts.xml (UserDefinedCommands) and the tab menu from tabContextMenu.xml.
// Since 8.9.6.2 it only trusts shortcuts.xml when config.xml holds shortcutsXmlHMAC: HMAC-SHA256 of the file's
// bytes keyed with the machine GUID. The files are edited as text so the user's own content and formatting stay
// as they are; only entries named "[SamSync] ..." are ours. Notepad++ rewrites both files from memory when it
// exits, so changes made while it runs are lost: the caller re-applies once it has closed.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from '../../shared/i18n';
import { entryCommand, type MenuEntry } from '../../shared/menu';

export const NPP_PREFIX = '[SamSync] ';
/** Notepad++ copies a Run command into a MAX_PATH buffer before it expands $(FULL_CURRENT_PATH). */
export const NPP_COMMAND_LIMIT = 260;
const MIN_VERSION = [8, 4, 8];
const PATH_TOKEN = '$(FULL_CURRENT_PATH)';

// ------------------------------------------------------------------ shortcuts

export interface Shortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Windows virtual key code. */
  key: number;
}

const NAMED_KEYS: Record<string, number> = {
  BACKSPACE: 8, TAB: 9, ENTER: 13, RETURN: 13, ESC: 27, ESCAPE: 27, SPACE: 32, PAGEUP: 33, PAGEDOWN: 34,
  END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, INSERT: 45, INS: 45, DELETE: 46, DEL: 46,
};

/** "Ctrl+Alt+W" -> modifiers and virtual key. Letters and digits need a modifier. */
export function parseShortcut(text: string): Shortcut {
  const sc: Shortcut = { ctrl: false, alt: false, shift: false, key: 0 };
  const keys: number[] = [];
  for (const raw of text.split('+').map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    if (raw === 'CTRL' || raw === 'CONTROL') sc.ctrl = true;
    else if (raw === 'ALT') sc.alt = true;
    else if (raw === 'SHIFT') sc.shift = true;
    else if (/^[A-Z0-9]$/.test(raw)) keys.push(raw.charCodeAt(0));
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(raw)) keys.push(111 + Number(raw.slice(1)));
    else if (raw in NAMED_KEYS) keys.push(NAMED_KEYS[raw]);
    else throw new Error(t('Tanınmayan tuş: {key} ({text})', { key: raw, text }));
  }
  if (keys.length !== 1) throw new Error(t('Kısayolda tek bir tuş olmalı: {text}', { text }));
  sc.key = keys[0];
  if (((sc.key >= 48 && sc.key <= 57) || (sc.key >= 65 && sc.key <= 90)) && !sc.ctrl && !sc.alt && !sc.shift) {
    throw new Error(t('Harf ve rakamlar en az bir değiştirici tuş ister (Ctrl, Alt, Shift): {text}', { text }));
  }
  return sc;
}

const sameShortcut = (a: Shortcut, b: Shortcut) => a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift;

// ------------------------------------------------------------------ XML text helpers

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const newline = (xml: string) => (xml.includes('\r\n') ? '\r\n' : '\n');
const yn = (b: boolean) => (b ? 'yes' : 'no');

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unesc(m[2]);
  return out;
}

/** Makes sure <tag> ... </tag> exists inside <NotepadPlus> and returns the text with it. */
function ensureSection(xml: string, tag: string): string {
  const nl = newline(xml);
  const selfClosing = new RegExp(`([ \\t]*)<${tag}\\s*/>`);
  if (selfClosing.test(xml)) return xml.replace(selfClosing, (_m, ind: string) => `${ind}<${tag}>${nl}${ind}</${tag}>`);
  if (new RegExp(`</${tag}>`).test(xml)) return xml;
  const root = /^([ \t]*)<\/NotepadPlus>/m.exec(xml);
  if (!root) throw new Error(t('Notepad++ dosyası tanınmadı: </NotepadPlus> yok'));
  const ind = `${root[1]}    `;
  return `${xml.slice(0, root.index)}${ind}<${tag}>${nl}${ind}</${tag}>${nl}${xml.slice(root.index)}`;
}

/** Inserts lines just before </tag>, indented one level deeper than it. */
function insertBefore(xml: string, tag: string, lines: string[]): string {
  if (!lines.length) return xml;
  const nl = newline(xml);
  const m = new RegExp(`^([ \\t]*)</${tag}>`, 'm').exec(xml);
  if (!m) throw new Error(t('Notepad++ dosyası tanınmadı: </{tag}> yok', { tag }));
  const ind = `${m[1]}    `;
  return `${xml.slice(0, m.index)}${lines.map((l) => `${ind}${l}${nl}`).join('')}${xml.slice(m.index)}`;
}

// ------------------------------------------------------------------ shortcuts.xml

export interface NppCommand {
  name: string;
  text: string;
  shortcut?: Shortcut;
}

const MANAGED_COMMAND = /[ \t]*<Command\b[^>]*?\bname="\[SamSync\] [^"]*"[^>]*?(?:\/>|>[\s\S]*?<\/Command>)[ \t]*\r?\n?/g;

export const DEFAULT_SHORTCUTS_XML = [
  '<?xml version="1.0" encoding="UTF-8" ?>',
  '<NotepadPlus>',
  '    <InternalCommands />',
  '    <Macros />',
  '    <UserDefinedCommands />',
  '    <PluginCommands />',
  '    <ScintillaKeys />',
  '</NotepadPlus>',
  '',
].join('\r\n');

/** shortcuts.xml with our commands replaced by these (none = removed). */
export function updateShortcutsXml(xml: string | null, commands: NppCommand[]): string {
  let s = (xml ?? DEFAULT_SHORTCUTS_XML).replace(MANAGED_COMMAND, '');
  if (!commands.length) return s;
  s = ensureSection(s, 'UserDefinedCommands');
  return insertBefore(
    s,
    'UserDefinedCommands',
    commands.map((c) => {
      const k = c.shortcut ?? { ctrl: false, alt: false, shift: false, key: 0 };
      return `<Command name="${esc(c.name)}" Ctrl="${yn(k.ctrl)}" Alt="${yn(k.alt)}" Shift="${yn(k.shift)}" Key="${k.key}">${esc(c.text)}</Command>`;
    }),
  );
}

/** Other entries of shortcuts.xml (macros, Run commands, plugin and Scintilla keys) that use the same keys. */
export function shortcutConflicts(xml: string, sc: Shortcut): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(\w+)\b([^>]*\bKey="\d+"[^>]*)>/g)) {
    const a = attrs(m[2]);
    if ((a.name ?? '').startsWith(NPP_PREFIX)) continue;
    const other: Shortcut = { ctrl: a.Ctrl === 'yes', alt: a.Alt === 'yes', shift: a.Shift === 'yes', key: Number(a.Key) };
    if (other.key && sameShortcut(other, sc)) out.push(a.name || a.id || m[1]);
  }
  return out;
}

// ------------------------------------------------------------------ tabContextMenu.xml

export type NppTabItem = { separator: true } | { name: string; label: string };

export const DEFAULT_TAB_MENU_XML = [
  '<?xml version="1.0" encoding="UTF-8" ?>',
  '<NotepadPlus>',
  '    <TabContextMenu>',
  '        <Item MenuEntryName="File" MenuItemName="Close" />',
  '        <Item MenuEntryName="File" MenuItemName="Save" />',
  '        <Item MenuEntryName="File" MenuItemName="Save As..." />',
  '        <Item MenuEntryName="File" MenuItemName="Reload from Disk" />',
  '        <Item MenuEntryName="File" MenuItemName="Print..." />',
  '        <Item FolderName="Copy to Clipboard" MenuEntryName="Edit" MenuItemName="Copy Current Full File Path" />',
  '        <Item FolderName="Copy to Clipboard" MenuEntryName="Edit" MenuItemName="Copy Current Filename" />',
  '        <Item FolderName="Copy to Clipboard" MenuEntryName="Edit" MenuItemName="Copy Current Dir. Path" />',
  '    </TabContextMenu>',
  '</NotepadPlus>',
  '',
].join('\r\n');

const ITEM = /[ \t]*<Item\b([^>]*?)\/>[ \t]*\r?\n?/g;

/** tabContextMenu.xml with our items (and the separators of our folder) replaced by these. */
export function updateTabMenuXml(xml: string, folder: string, items: NppTabItem[]): string {
  const folders = new Set([folder]);
  for (const m of xml.matchAll(ITEM)) {
    const a = attrs(m[1]);
    if ((a.MenuItemName ?? '').startsWith(NPP_PREFIX) && a.FolderName) folders.add(a.FolderName);
  }
  let s = xml.replace(ITEM, (whole, raw: string) => {
    const a = attrs(raw);
    if ((a.MenuItemName ?? '').startsWith(NPP_PREFIX)) return '';
    if (a.id === '0' && a.FolderName && folders.has(a.FolderName) && !a.MenuItemName) return '';
    return whole;
  });
  if (!items.length) return s;
  s = ensureSection(s, 'TabContextMenu');
  const f = esc(folder);
  return insertBefore(
    s,
    'TabContextMenu',
    items.map((i) => ('separator' in i ? `<Item FolderName="${f}" id="0" />` : `<Item FolderName="${f}" MenuEntryName="Run" MenuItemName="${esc(i.name)}" ItemNameAs="${esc(i.label)}" />`)),
  );
}

// ------------------------------------------------------------------ config.xml signature

export function shortcutsHmac(machineGuid: string, shortcutsBytes: Buffer): string {
  return crypto.createHmac('sha256', Buffer.from(machineGuid, 'ascii')).update(shortcutsBytes).digest('hex');
}

/** config.xml with shortcutsXmlHMAC set to value, or null when the file has no place for it. */
export function signConfigXml(xml: string, value: string): string | null {
  const nl = newline(xml);
  const el = `<GUIConfig name="shortcutsXmlHMAC" value="${value}" />`;
  const existing = /<GUIConfig\s+name="shortcutsXmlHMAC"[^>]*?(?:\/>|>[^<]*<\/GUIConfig>)/;
  if (existing.test(xml)) return xml.replace(existing, el);
  const configs = /^([ \t]*)<\/GUIConfigs>/m.exec(xml);
  if (configs) return `${xml.slice(0, configs.index)}${configs[1]}    ${el}${nl}${xml.slice(configs.index)}`;
  const root = /^([ \t]*)<\/NotepadPlus>/m.exec(xml);
  if (root) {
    const ind = `${root[1]}    `;
    return `${xml.slice(0, root.index)}${ind}<GUIConfigs>${nl}${ind}    ${el}${nl}${ind}</GUIConfigs>${nl}${xml.slice(root.index)}`;
  }
  return null;
}

// ------------------------------------------------------------------ the entries as Notepad++ items

export interface NppPlan {
  commands: NppCommand[];
  tabItems: NppTabItem[];
  warnings: string[];
  /** Entries left out because the command would be longer than Notepad++ accepts. */
  skipped: string[];
}

/** Separators fall between all | review pair | restore | profiles | each group | machines outside groups. */
const tabSection = (e: MenuEntry) => (e.group ? `group:${e.group}` : e.section);

export function nppPlan(entries: MenuEntry[], launcher: string, shortcuts: Record<string, string>, existingShortcutsXml: string | null): NppPlan {
  const warnings: string[] = [];
  const skipped: string[] = [];
  const byId = new Map<string, Shortcut>();
  const taken: { id: string; sc: Shortcut }[] = [];
  for (const [rawId, text] of Object.entries(shortcuts ?? {})) {
    const id = rawId.trim().toLowerCase();
    if (!String(text ?? '').trim()) continue;
    const entry = entries.find((e) => e.id.toLowerCase() === id);
    if (!entry) {
      warnings.push(t('Kısayol tanımı menüde olmayan bir girdiye bağlı: {id} (geçerli olanlar: {ids})', { id: rawId, ids: entries.map((e) => e.id).join(', ') }));
      continue;
    }
    let sc: Shortcut;
    try {
      sc = parseShortcut(String(text));
    } catch (e) {
      warnings.push((e as Error).message);
      continue;
    }
    const dup = taken.find((x) => sameShortcut(x.sc, sc));
    if (dup) {
      warnings.push(t('{text} iki girdiye atanmış ({a}, {b}); yalnızca ilki kullanıldı', { text: String(text), a: dup.id, b: entry.id }));
      continue;
    }
    taken.push({ id: entry.id, sc });
    byId.set(entry.id, sc);
    for (const other of existingShortcutsXml ? shortcutConflicts(existingShortcutsXml, sc) : []) {
      warnings.push(t('{text} Notepad++ içinde başka bir komutta da tanımlı: {other}', { text: String(text), other }));
    }
  }

  const commands: NppCommand[] = [];
  const tabItems: NppTabItem[] = [];
  let prev = '';
  for (const e of entries) {
    const text = entryCommand(launcher, e, PATH_TOKEN);
    if (text.length > NPP_COMMAND_LIMIT) {
      skipped.push(e.id);
      warnings.push(t('{label}: komut {n} karakter, Notepad++ en çok {max} kabul ediyor; girdi eklenmedi', { label: e.label, n: text.length, max: NPP_COMMAND_LIMIT }));
      continue;
    }
    const name = `${NPP_PREFIX}${e.id}`;
    commands.push({ name, text, shortcut: byId.get(e.id) });
    const section = tabSection(e);
    if (prev && prev !== section) tabItems.push({ separator: true });
    tabItems.push({ name, label: e.label });
    prev = section;
  }
  return { commands, tabItems, warnings, skipped };
}

// ------------------------------------------------------------------ finding Notepad++

export interface NppInstall {
  exe: string;
  version?: string;
  configDir: string;
  portable: boolean;
  running: boolean;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 4 << 20 }, (_err, stdout) => resolve(String(stdout ?? '')));
  });
}

const FIND_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$c = New-Object System.Collections.Generic.List[string]
$running = @(Get-Process notepad++ | ForEach-Object { $_.Path } | Where-Object { $_ })
$running | ForEach-Object { $c.Add($_) }
foreach ($p in @("$env:ProgramFiles\\Notepad++\\notepad++.exe", "\${env:ProgramFiles(x86)}\\Notepad++\\notepad++.exe", "$env:LOCALAPPDATA\\Programs\\Notepad++\\notepad++.exe")) { if (Test-Path -LiteralPath $p) { $c.Add($p) } }
foreach ($k in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\notepad++.exe', 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\notepad++.exe', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\notepad++.exe')) {
  $v = (Get-ItemProperty -LiteralPath $k).'(default)'; if ($v) { $c.Add($v.Trim('"')) }
}
@($c | ForEach-Object { $i = Get-Item -LiteralPath $_; if ($i) { [pscustomobject]@{ exe = $i.FullName; version = $i.VersionInfo.FileVersion; running = [bool]($running | Where-Object { $_ -eq $i.FullName }) } } }) | ConvertTo-Json -Compress
`;

export async function findNotepadPlusPlus(): Promise<NppInstall[]> {
  if (process.platform !== 'win32') return [];
  const out = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', FIND_SCRIPT])).trim();
  let list: { exe: string; version?: string; running?: boolean }[] = [];
  try {
    const j = JSON.parse(out || '[]');
    list = Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
  const seen = new Map<string, NppInstall>();
  for (const x of list) {
    if (!x?.exe) continue;
    const dir = path.dirname(x.exe);
    const portable = await exists(path.join(dir, 'doLocalConf.xml'));
    const configDir = portable ? dir : path.join(process.env.APPDATA || '', 'Notepad++');
    const k = configDir.toLowerCase();
    const prev = seen.get(k);
    if (prev) prev.running ||= !!x.running;
    else seen.set(k, { exe: x.exe, version: x.version?.replace(/[,\s]+/g, '.') || undefined, configDir, portable, running: !!x.running });
  }
  return [...seen.values()];
}

export async function notepadPlusPlusRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  return /notepad\+\+\.exe/i.test(await run('tasklist.exe', ['/FI', 'IMAGENAME eq notepad++.exe', '/NH']));
}

export async function machineGuid(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const out = await run('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
  return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out)?.[1] ?? null;
}

export function versionTooOld(version: string | undefined): boolean {
  if (!version) return false;
  const v = version.split(/[.,\s]+/).map((x) => Number(x) || 0);
  for (let i = 0; i < MIN_VERSION.length; i++) {
    if ((v[i] ?? 0) !== MIN_VERSION[i]) return (v[i] ?? 0) < MIN_VERSION[i];
  }
  return false;
}

// ------------------------------------------------------------------ applying

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function readText(p: string): Promise<{ text: string; bom: boolean } | null> {
  try {
    const b = await fs.readFile(p);
    const bom = b.subarray(0, 3).equals(BOM);
    return { text: (bom ? b.subarray(3) : b).toString('utf8'), bom };
  } catch {
    return null;
  }
}

async function writeAtomic(p: string, bytes: Buffer): Promise<void> {
  const tmp = `${p}.samsync-tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, p);
}

const encode = (text: string, bom: boolean) => (bom ? Buffer.concat([BOM, Buffer.from(text, 'utf8')]) : Buffer.from(text, 'utf8'));

export interface NppResult {
  install: NppInstall;
  /** The managed commands are in shortcuts.xml now. */
  installed: boolean;
  changed: boolean;
  warnings: string[];
  skipped: string[];
}

/** Writes (plan) or removes (plan = null) our entries in one Notepad++ configuration folder. */
export async function applyNotepadPlusPlus(install: NppInstall, folder: string, plan: Pick<NppPlan, 'commands' | 'tabItems'> | null, guid: string | null): Promise<NppResult> {
  const res: NppResult = { install, installed: false, changed: false, warnings: [], skipped: [] };
  if (plan && versionTooOld(install.version)) {
    res.warnings.push(t('Notepad++ {version} çok eski; en az 8.4.8 gerekiyor', { version: install.version ?? '?' }));
    plan = null;
  }
  const dir = install.configDir;
  if (!plan && !(await exists(dir))) return res;
  await fs.mkdir(dir, { recursive: true });

  const shortcutsPath = path.join(dir, 'shortcuts.xml');
  const sc = await readText(shortcutsPath);
  const commands = plan?.commands ?? [];
  // the bytes on disk after this call, which the signature has to match
  let signedBytes: Buffer | null = null;
  if (sc || commands.length) {
    const next = updateShortcutsXml(sc?.text ?? null, commands);
    signedBytes = encode(next, sc?.bom ?? false);
    if (next !== sc?.text) {
      await writeAtomic(shortcutsPath, signedBytes);
      res.changed = true;
    }
  }

  const tabPath = path.join(dir, 'tabContextMenu.xml');
  const items = plan?.tabItems ?? [];
  let tab = await readText(tabPath);
  // a new tab menu starts from Notepad++'s own example so its usual items stay
  if (!tab && items.length) tab = (await readText(path.join(dir, 'tabContextMenu_example.xml'))) ?? (await readText(path.join(path.dirname(install.exe), 'tabContextMenu_example.xml'))) ?? { text: '', bom: false };
  if (tab) {
    const base = tab.text.includes('</NotepadPlus>') ? tab.text : DEFAULT_TAB_MENU_XML;
    const next = updateTabMenuXml(base, folder, items);
    if (next !== tab.text) {
      await writeAtomic(tabPath, encode(next, tab.bom));
      res.changed = true;
    }
  }

  if (signedBytes) {
    const configPath = path.join(dir, 'config.xml');
    const cfg = await readText(configPath);
    const signed = guid && cfg ? signConfigXml(cfg.text, shortcutsHmac(guid, signedBytes)) : null;
    if (!guid || !cfg || signed === null) {
      res.warnings.push(t('shortcuts.xml imzalanamadı; Notepad++ içinde Çalıştır > Validate shortcuts.xml komutunu bir kez kullanın'));
    } else if (signed !== cfg.text) {
      await writeAtomic(configPath, encode(signed, cfg.bom));
      res.changed = true;
    }
  }
  res.installed = !!plan?.commands.length;
  return res;
}

/** Whether our entries are in this configuration folder now. */
export async function nppInstalled(install: NppInstall): Promise<boolean> {
  const sc = await readText(path.join(install.configDir, 'shortcuts.xml'));
  return !!sc && sc.text.includes(`name="${NPP_PREFIX}`);
}
