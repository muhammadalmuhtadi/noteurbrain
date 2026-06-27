import * as Comlink from "comlink";
import type { DbApi } from "./types";

let proxy: Comlink.Remote<DbApi> | null = null;
let initPromise: Promise<Comlink.Remote<DbApi>> | null = null;

const MUTATING = new Set<keyof DbApi>([
  "createNotebook",
  "renameNotebook",
  "colorNotebook",
  "deleteNotebook",
  "createSection",
  "renameSection",
  "colorSection",
  "deleteSection",
  "createNote",
  "updateNote",
  "deleteNote",
  "seedDemo",
  "importDatabase",
]);

function scheduleAutoSync() {
  // Lazy import to avoid pulling File System Access logic before first mutation.
  void import("@/lib/db-file-link")
    .then((m) => m.scheduleFlush())
    .catch(() => {
      /* feature optional */
    });
}

function wrapWithAutoSync(remote: Comlink.Remote<DbApi>): Comlink.Remote<DbApi> {
  return new Proxy(remote, {
    get(target, prop, receiver) {
      const value = Reflect.get(target as object, prop, receiver);
      if (typeof prop === "string" && MUTATING.has(prop as keyof DbApi) && typeof value === "function") {
        return (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = (value as any).apply(target, args);
          Promise.resolve(result).then(scheduleAutoSync).catch(() => {
            /* ignore — mutation failures handled by caller */
          });
          return result;
        };
      }
      return value;
    },
  }) as Comlink.Remote<DbApi>;
}

export function getDb(): Promise<Comlink.Remote<DbApi>> {
  if (typeof window === "undefined") {
    throw new Error("DB client is browser-only");
  }
  if (proxy) return Promise.resolve(proxy);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const remote = Comlink.wrap<DbApi>(worker);
    await remote.init();
    proxy = wrapWithAutoSync(remote);
    return proxy;
  })();

  return initPromise;
}
