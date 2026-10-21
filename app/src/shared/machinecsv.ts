// The machine list as a CSV file, to set many machines up in a spreadsheet and bring them back: one row per machine,
// lists (local roots, tags) joined with "|". Semicolons separate the columns (what spreadsheets in most locales
// expect); a file with commas is read too.
import type { NodeConfig, TransportKind } from './types';

export const MACHINE_CSV_COLUMNS = ['id', 'name', 'group', 'address', 'transport', 'networkRoot', 'path', 'localRoots', 'tags', 'mac', 'relay', 'enabled'] as const;

const esc = (v: string) => (/[;,"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function machinesToCsv(nodes: NodeConfig[]): string {
  const rows = [MACHINE_CSV_COLUMNS.join(';')];
  for (const n of nodes) {
    const cells: Record<(typeof MACHINE_CSV_COLUMNS)[number], string> = {
      id: n.id,
      name: n.name,
      group: n.group ?? '',
      address: n.address,
      transport: n.transport ?? 'smb',
      networkRoot: n.networkRoot,
      path: n.path ?? '',
      localRoots: n.localRoots.join('|'),
      tags: (n.tags ?? []).join('|'),
      mac: n.mac ?? '',
      relay: n.relay ? 'yes' : '',
      enabled: n.enabled ? 'yes' : 'no',
    };
    rows.push(MACHINE_CSV_COLUMNS.map((c) => esc(cells[c])).join(';'));
  }
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

/** Splits CSV text into rows of cells (quotes, doubled quotes and line breaks inside quotes understood). */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const yes = (v: string) => /^(yes|true|1|evet|e|x)$/i.test(v.trim());
const list = (v: string) =>
  v
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);

/** The machines of a CSV file (by the header's column names, in any order); rows without an id are reported. */
export function machinesFromCsv(text: string): { nodes: NodeConfig[]; errors: string[] } {
  const clean = text.replace(/^\uFEFF/, '');
  const first = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.split(';').length >= first.split(',').length ? ';' : ',';
  const rows = parseCsv(clean, sep);
  const errors: string[] = [];
  if (!rows.length) return { nodes: [], errors: ['empty'] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  if (col('id') < 0) return { nodes: [], errors: ['no id column'] };
  const nodes: NodeConfig[] = [];
  rows.slice(1).forEach((r, i) => {
    const get = (name: string) => {
      const k = col(name);
      return k >= 0 ? (r[k] ?? '').trim() : '';
    };
    const id = get('id');
    if (!id) {
      errors.push(`row ${i + 2}: no id`);
      return;
    }
    const transport = (['smb', 'path', 'sftp'].includes(get('transport')) ? get('transport') : 'smb') as TransportKind;
    const n: NodeConfig = {
      id,
      name: get('name') || id,
      address: get('address'),
      localRoots: list(get('localRoots')),
      networkRoot: get('networkRoot'),
      enabled: col('enabled') < 0 || !get('enabled') ? true : yes(get('enabled')),
      transport,
    };
    if (get('group')) n.group = get('group');
    if (get('path')) n.path = get('path');
    if (list(get('tags')).length) n.tags = list(get('tags'));
    if (get('mac')) n.mac = get('mac');
    if (yes(get('relay'))) n.relay = true;
    nodes.push(n);
  });
  return { nodes, errors };
}

/** What an import would do to the machine list: the new machines, the changed ones (by id), and the list after it. */
export function mergeMachines(current: NodeConfig[], incoming: NodeConfig[]): { added: NodeConfig[]; changed: NodeConfig[]; same: number; nodes: NodeConfig[] } {
  const byId = new Map(current.map((n) => [n.id.toLowerCase(), n]));
  const added: NodeConfig[] = [];
  const changed: NodeConfig[] = [];
  let same = 0;
  const updated = new Map<string, NodeConfig>();
  for (const n of incoming) {
    const old = byId.get(n.id.toLowerCase());
    if (!old) {
      added.push(n);
      continue;
    }
    // what the file says wins; what it cannot say (SFTP, colours, notes, local names) stays
    const merged: NodeConfig = { ...old, ...n, id: old.id, sftp: old.sftp, color: old.color, notes: old.notes, localNames: old.localNames };
    for (const k of ['group', 'path', 'tags', 'mac', 'relay'] as const) if (n[k] === undefined) delete merged[k];
    const key = (x: NodeConfig) => JSON.stringify([x.name, x.group ?? '', x.address, x.transport ?? 'smb', x.networkRoot, x.path ?? '', x.localRoots, x.tags ?? [], x.mac ?? '', !!x.relay, x.enabled]);
    if (key(merged) === key(old)) same++;
    else {
      changed.push(merged);
      updated.set(old.id, merged);
    }
  }
  return { added, changed, same, nodes: [...current.map((n) => updated.get(n.id) ?? n), ...added] };
}
