import { IDB_KEY_VAULT, IDB_NAME, IDB_STORE, IDB_VERSION } from './constants.js';

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
  });
}

/**
 * Persist the vault root DirectoryHandle (File System Access API).
 * @param {FileSystemDirectoryHandle} handle
 */
export async function saveVaultRootHandle(handle) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb write failed'));
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY_VAULT);
    });
  } finally {
    db.close();
  }
}

/** @returns {Promise<FileSystemDirectoryHandle|null>} */
export async function loadVaultRootHandle() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY_VAULT);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('idb read failed'));
    });
  } finally {
    db.close();
  }
}

export async function clearVaultRootHandle() {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb clear failed'));
      tx.objectStore(IDB_STORE).delete(IDB_KEY_VAULT);
    });
  } finally {
    db.close();
  }
}

/**
 * Ensure we still have readwrite permission (may require a user gesture).
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<boolean>}
 */
export async function ensureReadWritePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}
