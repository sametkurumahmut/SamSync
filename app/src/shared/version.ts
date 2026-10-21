/** Compares two versions like 2.4.10 and 2.5.0 by their numbers (a leading "v" and anything after a - or + is ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[-+]/)[0].split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[-+]/)[0].split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
