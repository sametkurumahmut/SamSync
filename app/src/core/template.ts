// Machine variables in text files (Settings › Copy › files with machine variables): {{machine.id}}, {{machine.name}},
// {{machine.title}} (the name without its address part), {{machine.address}} and {{machine.group}} are filled in for
// each machine while the file is sent, so one file serves every machine. A file without any of them, or one that is
// not UTF-8 text, is sent as it is.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { NodeConfig, PlainSrc, SrcRef } from '../shared/types';
import { machineLabel } from '../shared/machine';
import { openPackEntry } from './pack';
import { blobStream } from './git';

/** Bigger files are never treated as templates (a config file is small; a big one is data). */
export const TEMPLATE_MAX = 4 * 1024 * 1024;
const VAR = /\{\{\s*machine\.(id|name|title|address|group)\s*\}\}/g;

export type MachineVars = Record<'id' | 'name' | 'title' | 'address' | 'group', string>;

export function machineVars(node: NodeConfig): MachineVars {
  return { id: node.id, name: node.name, title: machineLabel(node.name, node.address).title, address: node.address, group: node.group ?? '' };
}

/** The text of a file that holds machine variables, or null: none in it, or not UTF-8 (filling it in would spoil it). */
export function templateText(buf: Buffer): string | null {
  if (buf.length > TEMPLATE_MAX || (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return null;
  const text = buf.toString('utf8');
  VAR.lastIndex = 0;
  if (!VAR.test(text) || !Buffer.from(text, 'utf8').equals(buf)) return null;
  return text;
}

export function fillMachineVars(text: string, vars: MachineVars): Buffer {
  return Buffer.from(text.replace(VAR, (_m, k: keyof MachineVars) => vars[k]), 'utf8');
}

/** A source that needs no transport, as a stream. */
export function openPlain(src: PlainSrc, highWaterMark = 1024 * 1024): Readable {
  if (src.kind === 'fs') return fs.createReadStream(src.abs, { highWaterMark });
  if (src.kind === 'git') return blobStream(src.repo, src.rev, src.path);
  return openPackEntry(src.file, src) as Readable;
}

export async function readPlain(src: PlainSrc): Promise<Buffer> {
  if (src.kind === 'fs') return fsp.readFile(src.abs);
  const chunks: Buffer[] = [];
  for await (const c of openPlain(src)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** A file with machine variables, filled in for its machine (the raw file when it no longer holds any). */
export function openVars(src: Extract<SrcRef, { kind: 'vars' }>): Readable {
  return Readable.from(
    (async function* () {
      const buf = await readPlain(src.from);
      const text = templateText(buf);
      yield text == null ? buf : fillMachineVars(text, src.vars);
    })(),
  );
}
