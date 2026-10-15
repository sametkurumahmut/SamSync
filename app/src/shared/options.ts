// Send options shared by the core and the renderer: the defaults, and the per target exceptions (mode and backup).
import type { CopySettings, SendOptions, TargetOptions } from './types';

export const DEFAULT_SEND_OPTIONS: SendOptions = {
  mode: 'overwrite',
  compare: 'timeSize',
  backup: false,
  dryRun: false,
  verify: false,
  excludeFiles: [],
  excludeDirs: [],
  parallelTargets: 4,
  propagateDeletes: true,
  runPostCommand: true,
  notify: true,
};

/** Send options before the user changes anything: config defaults plus the defaults from Settings. */
export function baseSendOptions(copy: CopySettings, defaults?: Partial<SendOptions>): SendOptions {
  return {
    ...DEFAULT_SEND_OPTIONS,
    excludeFiles: copy.excludeFiles,
    excludeDirs: copy.excludeDirs,
    parallelTargets: copy.parallelTargets,
    verify: copy.verify,
    ...(defaults ?? {}),
    dryRun: false,
  };
}

type PerTarget = Record<string, TargetOptions>;

/** The exceptions saved for one target; node ids are compared without case, like everywhere else. */
export function overrideFor(perTarget: PerTarget | undefined, id: string): TargetOptions | undefined {
  if (!perTarget) return undefined;
  if (perTarget[id]) return perTarget[id];
  const key = Object.keys(perTarget).find((k) => k.toLowerCase() === id.toLowerCase());
  return key ? perTarget[key] : undefined;
}

/** The options in effect on one target. */
export function targetOptions(o: SendOptions, id: string): SendOptions {
  const ov = overrideFor(o.perTarget, id);
  if (!ov) return o;
  return { ...o, mode: ov.mode ?? o.mode, backup: ov.backup ?? o.backup };
}

/**
 * Sets (or with null clears) one target's exceptions. A value equal to the general option is not an exception, so
 * it is dropped, and so is a target left without any; returns a new map.
 */
export function setOverride(o: Pick<SendOptions, 'mode' | 'backup' | 'perTarget'>, id: string, patch: TargetOptions | null): PerTarget {
  const next: PerTarget = {};
  for (const [k, v] of Object.entries(o.perTarget ?? {})) if (k.toLowerCase() !== id.toLowerCase()) next[k] = v;
  if (!patch) return next;
  const merged = { ...overrideFor(o.perTarget, id), ...patch };
  const clean: TargetOptions = {};
  if (merged.mode && merged.mode !== o.mode) clean.mode = merged.mode;
  if (merged.backup != null && merged.backup !== o.backup) clean.backup = merged.backup;
  if (clean.mode || clean.backup != null) next[id] = clean;
  return next;
}

/** Only the exceptions of these targets (a profile keeps the ones of its own targets). */
export function pickOverrides(perTarget: PerTarget | undefined, ids: readonly string[]): PerTarget {
  const keep = new Set(ids.map((x) => x.toLowerCase()));
  return Object.fromEntries(Object.entries(perTarget ?? {}).filter(([k]) => keep.has(k.toLowerCase())));
}

/** Watches never mirror: a per target mirror falls back to the general mode. */
export function withoutMirror(perTarget: PerTarget | undefined): PerTarget {
  const out: PerTarget = {};
  for (const [k, v] of Object.entries(perTarget ?? {})) {
    const { mode, ...rest } = v;
    const keep: TargetOptions = mode && mode !== 'mirror' ? { ...rest, mode } : rest;
    if (keep.mode || keep.backup != null) out[k] = keep;
  }
  return out;
}
