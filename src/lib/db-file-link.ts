/**
 * Links the in-app SQLite database to a file on the user's disk via the
 * File System Access API. The handle is persisted in IndexedDB so the link
 * survives full page reloads. After every mutation we debounce-flush the
 * latest export bytes back to that file.
 *
 * Falls back gracefully when the browser lacks File System Access API
 * (Firefox/Safari) — OPFS still keeps everything locally, just no
 * external-file mirror.
 */

const META_DB = "brain-meta";
const STORE = "kv";
const KEY_HANDLE = "linked-db-handle";
const KEY_NAME = "linked-db-name";

export type LinkStatus =
  | "unlinked"
  | "needs-permission"
  | "scheduled"
  | "saving"
  | "saved"
  | "error";

export interface LinkState {
  status: LinkStatus;
  name: string | null;
  at: number; // last flushed timestamp
  error?: string;
}

let current: LinkState = { status: "unlinked", name: null, at: 0 };
const listeners = new Set<(s: LinkState) => void>();

function emit(patch: Partial<LinkState>) {
  current = { ...current, ...patch };
  for (const l of listeners) l(current);
}

export function subscribeLink(fn: (s: LinkState) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export function getLinkState(): LinkState {
  return current;
}

export function supportsFileLink(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

/* ---------- tiny IDB kv ---------- */
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(META_DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => res(req.result as T | undefined);
    req.onerror = () => rej(req.error);
  });
}
async function kvSet(key: string, val: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function kvDel(key: string): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/* ---------- handle persistence ---------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handle = any; // FileSystemFileHandle (types vary across TS lib versions)

export async function getStoredHandle(): Promise<Handle | null> {
  try {
    return (await kvGet<Handle>(KEY_HANDLE)) ?? null;
  } catch {
    return null;
  }
}
export async function getStoredName(): Promise<string | null> {
  try {
    return (await kvGet<string>(KEY_NAME)) ?? null;
  } catch {
    return null;
  }
}
async function storeHandle(h: Handle, name: string) {
  await kvSet(KEY_HANDLE, h);
  await kvSet(KEY_NAME, name);
}
export async function clearLink() {
  try {
    await kvDel(KEY_HANDLE);
    await kvDel(KEY_NAME);
  } catch {
    /* ignore */
  }
  emit({ status: "unlinked", name: null, at: 0, error: undefined });
}

async function queryPerm(h: Handle): Promise<PermissionState> {
  try {
    return await h.queryPermission({ mode: "readwrite" });
  } catch {
    return "prompt";
  }
}
async function requestPerm(h: Handle): Promise<PermissionState> {
  try {
    return await h.requestPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

/** Verify or request rw permission; pass userGesture=true only from a click handler. */
export async function ensurePermission(userGesture = false): Promise<boolean> {
  const h = await getStoredHandle();
  if (!h) return false;
  const q = await queryPerm(h);
  if (q === "granted") return true;
  if (!userGesture) {
    emit({ status: "needs-permission" });
    return false;
  }
  const r = await requestPerm(h);
  return r === "granted";
}

/* ---------- pick / link ---------- */

/**
 * Prompt the user to pick a .sqlite file. Returns the bytes + handle.
 * Caller is responsible for actually importing the bytes into the DB
 * and then calling completeLink() to persist the handle.
 */
export async function pickDatabaseFile(): Promise<{
  bytes: Uint8Array;
  handle: Handle;
  name: string;
} | null> {
  if (!supportsFileLink()) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  const [handle] = await w.showOpenFilePicker({
    types: [
      {
        description: "SQLite database",
        accept: { "application/x-sqlite3": [".sqlite", ".sqlite3", ".db"] },
      },
    ],
    multiple: false,
    excludeAcceptAllOption: false,
  });
  // Make sure we hold rw permission up-front (same user gesture).
  const ok = (await queryPerm(handle)) === "granted" || (await requestPerm(handle)) === "granted";
  if (!ok) throw new Error("Write permission denied — cannot keep file in sync.");
  const file: File = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, handle, name: file.name };
}

/** Save handle as the linked DB. Call this AFTER importing bytes succeeds. */
export async function completeLink(handle: Handle, name: string) {
  await storeHandle(handle, name);
  emit({ status: "saved", name, at: Date.now(), error: undefined });
}

/* ---------- autosave flush ---------- */
let flushTimer: number | null = null;
let flushing = false;
let pending = false;

export function scheduleFlush(delay = 1200) {
  if (current.status === "unlinked") return;
  if (flushTimer) window.clearTimeout(flushTimer);
  emit({ status: "scheduled" });
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, delay) as unknown as number;
}

export async function flushNow(): Promise<void> {
  if (flushing) {
    pending = true;
    return;
  }
  const h = await getStoredHandle();
  if (!h) {
    emit({ status: "unlinked", name: null });
    return;
  }
  const perm = await queryPerm(h);
  if (perm !== "granted") {
    emit({ status: "needs-permission" });
    return;
  }
  flushing = true;
  emit({ status: "saving" });
  try {
    const { getDb } = await import("@/db/client");
    const db = await getDb();
    const bytes = await db.exportDatabase();
    const writable = await h.createWritable();
    await writable.write(bytes);
    await writable.close();
    emit({ status: "saved", at: Date.now(), error: undefined });
  } catch (e) {
    emit({ status: "error", error: (e as Error).message });
  } finally {
    flushing = false;
    if (pending) {
      pending = false;
      scheduleFlush(400);
    }
  }
}

/** Reads the linked file and imports it into the local SQLite database. */
export async function syncFromLinkedFile(): Promise<boolean> {
  const h = await getStoredHandle();
  if (!h) return false;
  const perm = await queryPerm(h);
  if (perm !== "granted") return false;
  try {
    const file = await h.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { getDb } = await import("@/db/client");
    const db = await getDb();
    await db.importDatabase(bytes);
    emit({ status: "saved", name: file.name, at: Date.now(), error: undefined });
    return true;
  } catch (e) {
    emit({ status: "error", error: (e as Error).message });
    return false;
  }
}

/** Call once on app start to restore link state from IndexedDB. */
export async function restoreLink(): Promise<boolean> {
  const name = await getStoredName();
  const h = await getStoredHandle();
  if (!h || !name) {
    emit({ status: "unlinked", name: null, at: 0 });
    return false;
  }
  const perm = await queryPerm(h);
  if (perm === "granted") {
    // ponytail: import file content on startup if permission is already granted
    try {
      const file = await h.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { getDb } = await import("@/db/client");
      const db = await getDb();
      await db.importDatabase(bytes);
      emit({ status: "saved", name, at: Date.now(), error: undefined });
      return true;
    } catch (e) {
      emit({ status: "error", name, error: (e as Error).message, at: 0 });
      return false;
    }
  } else {
    emit({ status: "needs-permission", name, at: 0 });
    return false;
  }
}

/** Flush pending writes before the tab closes. */
export function installUnloadFlush() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", () => {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
      void flushNow();
    }
  });
}
