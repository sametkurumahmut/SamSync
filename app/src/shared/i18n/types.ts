export type Lang = 'tr' | 'en';
/** The setting: follow the computer's display language or a fixed one. */
export type LangPref = 'system' | Lang;
export type Params = Record<string, string | number>;
/** An English entry: plain text with {placeholders}, or a function of the params (plurals). */
export type Entry = string | ((p: Params) => string);
export type Dict = Record<string, Entry>;

/** English singular/plural chosen by a numeric param (default {n}). Turkish keys need no plural. */
export function pl(one: string, other: string, key = 'n'): (p: Params) => string {
  return (p) => (Number(String(p[key]).replace(/[^\d.-]/g, '')) === 1 ? one : other);
}
