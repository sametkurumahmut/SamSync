// The "what's new" card after an update: the section of CHANGELOG.md (English) or CHANGELOG.tr.md (Turkish) for
// the running version. The files travel with the app (resources/ in the packaged build, the project folder in
// development).
import fsp from 'node:fs/promises';
import type { ChangelogSection } from '../shared/types';

/** The section headed "## <version> — <date>" (the date is optional), or null when there is none. */
export function changelogSection(markdown: string, version: string): ChangelogSection | null {
  const lines = markdown.split(/\r?\n/);
  const head = new RegExp(`^##\\s+${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*[—–-]\\s*(\\S.*))?\\s*$`);
  let start = -1;
  let date: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (m) {
      start = i;
      date = m[1]?.trim() || undefined;
      break;
    }
  }
  if (start < 0) return null;
  const items: string[] = [];
  const sub: string[][] = [];
  // a wrapped line belongs to the bullet above it, an indented one under it
  let inSub = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(l);
    if (bullet && bullet[1].length > 0 && items.length) {
      (sub[items.length - 1] ??= []).push(bullet[2].trim());
      inSub = true;
    } else if (bullet) {
      items.push(bullet[2].trim());
      inSub = false;
    } else if (l.trim() && items.length) {
      const list = inSub ? sub[items.length - 1] : null;
      if (list) list[list.length - 1] += ' ' + l.trim();
      else items[items.length - 1] += ' ' + l.trim();
    }
  }
  return sub.length ? { version, date, items, sub: items.map((_, k) => sub[k] ?? []) } : { version, date, items };
}

export async function readChangelogSection(file: string, version: string): Promise<ChangelogSection | null> {
  try {
    return changelogSection(await fsp.readFile(file, 'utf8'), version);
  } catch {
    return null;
  }
}
