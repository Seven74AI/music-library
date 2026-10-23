import {
  OFFLINE_COVERS_STORE,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_TRACKS_STORE,
} from "./types.ts";

/**
 * Single shared opener for the offline IndexedDB database.
 *
 * Both the metadata store and the cover cache need the same database with the
 * same `tracks` + `covers` stores and indexes. Any schema/index change belongs
 * here exactly once — keeping the two callers from drifting (a past drift had
 * cover-cache hardcode the `tracks` store name instead of using the constant).
 */
export function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_TRACKS_STORE)) {
        const store = db.createObjectStore(OFFLINE_TRACKS_STORE, {
          keyPath: "trackId",
        });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
        store.createIndex("isPinned", "isPinned", { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_COVERS_STORE)) {
        db.createObjectStore(OFFLINE_COVERS_STORE, { keyPath: "objectKey" });
      }
    };
  });
}
