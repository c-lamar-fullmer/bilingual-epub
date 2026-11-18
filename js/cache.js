// Remembers every translated paragraph in the browser (IndexedDB), so if you
// cancel, refresh, or rebuild the book, finished paragraphs are never redone.
// If IndexedDB isn't available the app still works, just without the cache.

const DB_NAME = 'ao3-translation-cache';
const STORE = 'translations';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function request(mode, fn) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

const keyFor = (lang, text) => `${lang}\u0001${text}`;

export const getCached = (lang, text) => request('readonly', (s) => s.get(keyFor(lang, text)));
export const putCached = (lang, text, value) => request('readwrite', (s) => s.put(value, keyFor(lang, text)));

export const clearCache = () =>
  openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(true); // only true once the browser has finished
      tx.onerror = tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  }));