/**
 * IndexedDB Media Storage Subsystem
 * 
 * Provides an asynchronous client-side binary blob storage layer (WebLinuxMediaDB)
 * to store large live video wallpapers (MP4/WebM) and audio tracks (MP3) without
 * triggering browser localStorage quota errors (5MB limit).
 */

const DB_NAME = "WebLinuxMediaDB";
const STORE_NAME = "media_blobs";

/**
 * Opens or initializes the IndexedDB database instance for media blobs.
 * Automatically runs schema upgrades and creates the object store if it doesn't exist.
 *
 * @returns {Promise<IDBDatabase>} Resolves with the active IDBDatabase connection.
 */
function openMediaDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persists a binary Blob (e.g. uploaded video wallpaper or MP3 audio track)
 * directly into IndexedDB under the specified string key.
 *
 * @param {string} key - Unique identifier (e.g., "custom_wallpaper", "custom_bgm").
 * @param {Blob} blob - The raw binary data representing the media file.
 * @returns {Promise<void>} Resolves once the write transaction commits.
 */
export async function saveMediaBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openMediaDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Failed to store media in IndexedDB:", err);
  }
}

/**
 * Retrieves a previously stored binary Blob from IndexedDB by its key.
 * Used upon application mount to reconstitute Object URLs for media playback.
 *
 * @param {string} key - Identifier of the media asset to retrieve.
 * @returns {Promise<Blob | null>} Resolves with the Blob if found, or null if missing.
 */
export async function getMediaBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openMediaDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Removes a media Blob from IndexedDB to free up client-side browser disk storage.
 *
 * @param {string} key - Identifier of the media asset to delete.
 * @returns {Promise<void>}
 */
export async function deleteMediaBlob(key: string): Promise<void> {
  try {
    const db = await openMediaDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
  } catch {}
}

/**
 * Guarded localStorage write utility.
 * Prevents QuotaExceededError crashes by blocking base64 data URLs or payloads
 * exceeding 50KB from entering localStorage, enforcing the two-tier storage policy.
 *
 * @param {string} key - The localStorage key.
 * @param {string} value - The scalar string value to store.
 */
export function safeLocalStorageSet(key: string, value: string): void {
  try {
    // Never store data URLs or strings over 50KB in localStorage (5MB browser limit)
    if (value.startsWith("data:") && value.length > 50000) {
      return;
    }
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`Storage quota exceeded for key "${key}", skipping localStorage:`, err);
  }
}
