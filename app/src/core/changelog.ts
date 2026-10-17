// The "what's new" card after an update: the section of CHANGELOG.md for the running version. The file
// travels with the app (resources/ in the packaged build, the project folder in development).
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
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    if (/^\s*[-*]\s+/.test(l)) items.push(l.replace(/^\s*[-*]\s+/, '').trim());
    else if (l.trim() && items.length) items[items.length - 1] += ' ' + l.trim();
  }
  return { version, date, items };
}

export async function readChangelogSection(file: string, version: string): Promise<ChangelogSection | null> {
  try {
    return changelogSection(await fsp.readFile(file, 'utf8'), version);
  } catch {
    return null;
  }
}
