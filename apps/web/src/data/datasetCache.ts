// IndexedDB cache of the *parsed* dataset: keyed by the deployed file's ETag, so a returning
// visit skips both the download and the JSON.parse — the two biggest startup costs.

const DB = 'exfa-cache';
const STORE = 'dataset';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB, 1); } catch { return res(null); }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });
}

/** ETag of the deployed dataset (HEAD only — a few hundred bytes, no-cache). null when unavailable. */
export async function datasetFingerprint(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    if (!r.ok) return null;
    return r.headers.get('etag') ?? r.headers.get('last-modified');
  } catch { return null; }
}

export async function cachedDataset(key: string): Promise<unknown | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((res) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror = () => res(null);
  });
}

export async function storeDataset(key: string, raw: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    // one dataset at a time: clear stale entries so repeat key changes don't grow the db
    tx.objectStore(STORE).clear();
    tx.objectStore(STORE).put(raw, key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
