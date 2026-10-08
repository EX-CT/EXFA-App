// File-level library transfer: format toFiles/fromFiles (library.exfa.json index + one .exfa.json document per fit,
// folders mapped to directories) packed as a zip via fflate, or written to / read from a picked directory.
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { fromFiles, toFiles, type FormatFile } from '@exfa/format';
import type { FitDoc, Library } from '../fit/model';

export const LIBRARY_ZIP_NAME = 'exfa-library.zip';

/** Library -> format file set (index + documents under folder paths). */
export const libraryToFiles = (lib: Library): FormatFile[] => toFiles(lib);

/** Single document -> its `toFiles` entry (name used for downloads). */
export function docToFile(doc: FitDoc): FormatFile {
  const file = toFiles({ format: 'exfa/library@1', folders: [], fits: { [doc.id]: doc }, characters: {}, damage_patterns: {}, target_profiles: {}, scenarios: {}, fleets: {} })
    .find((f) => f.path !== 'library.exfa.json');
  if (!file) throw new Error('toFiles produced no document');
  return file;
}

/** Parse a `toFiles` set back into a library (folders come from the document paths). */
export const filesToLibrary = (files: FormatFile[]): Library => fromFiles(files);

/** Zip a whole library (stored, deterministic order from toFiles). */
export function zipLibrary(lib: Library): Uint8Array {
  const entries = Object.fromEntries(libraryToFiles(lib).map((f) => [f.path, strToU8(f.text)]));
  return zipSync(entries, { level: 0 });
}

/** Unzip into a `toFiles` set; the caller feeds it to filesToLibrary / mergeLibrary. */
export function unzipFiles(bytes: Uint8Array): FormatFile[] {
  return Object.entries(unzipSync(bytes))
    .filter(([path, data]) => !path.endsWith('/') && data.length)
    .map(([path, data]) => ({ path, text: strFromU8(data) }));
}

export const isZip = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;

// ---- File System Access API (Chromium): export to / import from a real folder. Hidden when unsupported. ----
export const dirPickerSupported = () => typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

interface DirHandle { kind: 'directory'; name: string; getDirectoryHandle: (name: string, o?: { create?: boolean }) => Promise<DirHandle>; getFileHandle: (name: string, o?: { create?: boolean }) => Promise<FileHandle>; values: () => AsyncIterable<DirHandle | FileHandle>; }
interface FileHandle { kind: 'file'; name: string; getFile: () => Promise<File>; createWritable: () => Promise<{ write: (d: unknown) => Promise<void>; close: () => Promise<void> }>; }

/** showDirectoryPicker, typed loosely (not yet in lib.dom). */
export const pickDir = (mode: 'read' | 'readwrite'): Promise<DirHandle> =>
  (window as unknown as { showDirectoryPicker: (o: { mode: string }) => Promise<DirHandle> }).showDirectoryPicker({ mode });

const dirAt = async (root: DirHandle, path: string, create: boolean): Promise<DirHandle> => {
  let dir = root;
  for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
};

/** Writes the toFiles set into a picked directory (folders become subdirectories). */
export async function writeLibraryToDir(lib: Library, dir: DirHandle): Promise<number> {
  let n = 0;
  for (const file of libraryToFiles(lib)) {
    const slash = file.path.lastIndexOf('/');
    const target = slash < 0 ? dir : await dirAt(dir, file.path.slice(0, slash), true);
    const handle = await target.getFileHandle(file.path.slice(slash + 1), { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.text);
    await writable.close();
    n++;
  }
  return n;
}

/** Reads every .exfa.json (+ the library index) in a picked directory tree into a toFiles set. */
export async function readLibraryFromDir(dir: DirHandle, prefix = ''): Promise<FormatFile[]> {
  const files: FormatFile[] = [];
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') files.push(...await readLibraryFromDir(entry as DirHandle, path));
    else if (entry.name.endsWith('.exfa.json')) files.push({ path, text: await (await (entry as FileHandle).getFile()).text() });
  }
  return files;
}

export type { DirHandle };
