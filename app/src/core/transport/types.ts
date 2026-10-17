import type { Readable } from 'node:stream';

export interface Entry {
  rel: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export interface WriteOptions {
  mtimeMs?: number;
  size?: number;
  onProgress?: (bytes: number) => void;
  /** Aborting it stops the write where it is (the partial file stays for a resume). */
  signal?: AbortSignal;
}

/** A byte range of a file: start inclusive, end inclusive (as fs.createReadStream takes them). */
export interface ReadRange {
  start: number;
  end?: number;
}

/**
 * A place files can be read from and written to. Every path is a POSIX rel path below the root;
 * '' is the root itself. Implementations: local disk / UNC / mounted share (fs) and SFTP.
 */
export interface Transport {
  readonly kind: 'fs' | 'sftp';
  /** Human readable root (\\10.10.1.11\Share\Release, sftp://user@host/srv/x). */
  readonly root: string;
  readonly caseInsensitive: boolean;
  stat(rel: string): Promise<Entry | null>;
  /** Direct children of a folder. */
  list(rel: string): Promise<Entry[]>;
  readStream(rel: string, range?: ReadRange): Promise<Readable>;
  /** Writes a whole file from a stream (no atomicity, see writeAtomic). */
  writeStream(rel: string, data: Readable, opts?: WriteOptions): Promise<number>;
  /** Appends to an existing file (a resumed copy); resolves to the file's size afterwards, onProgress counts from the old size. */
  appendStream?(rel: string, data: Readable, opts?: WriteOptions): Promise<number>;
  /** Copies a file inside this transport (backups, restores). */
  copyWithin(fromRel: string, toRel: string): Promise<void>;
  mkdirp(rel: string): Promise<void>;
  /** Removes a file, or a folder recursively. Missing paths are not an error. */
  remove(rel: string, isDir: boolean): Promise<void>;
  /** Renames, replacing an existing destination file. */
  rename(fromRel: string, toRel: string): Promise<void>;
  setMtime(rel: string, mtimeMs: number): Promise<void>;
  freeSpace(): Promise<number | undefined>;
  /** Fast path for local files: copy straight from an absolute local path. */
  copyFromLocal?(abs: string, rel: string, opts?: WriteOptions): Promise<number>;
  /** Absolute OS path of a rel path when the transport is backed by the file system. */
  localPath?(rel: string): string;
  /** Tells the transport a folder exists (the plan saw it), so writes below it do not ask again. */
  assumeDir?(rel: string): void;
  /** Throws when the file at rel cannot be replaced (a program holds it open); a missing file is fine. */
  checkReplaceable?(rel: string): Promise<void>;
  close(): Promise<void>;
}
