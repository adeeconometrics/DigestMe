import {
  PYODIDE_RUNTIME_DB_NAME,
  PYODIDE_RUNTIME_MARKER_VALUE,
} from "./artifactCache";

export type RuntimeMarkerStatus = "current" | "missing" | "mismatch";
export type RuntimeStoreStatus = "checking" | "cached" | "not-cached" | "unavailable" | "error";

export function classifyRuntimeMarker(value: string | undefined): RuntimeMarkerStatus {
  if (value === undefined) return "missing";
  return value.trim() === PYODIDE_RUNTIME_MARKER_VALUE ? "current" : "mismatch";
}

export function normalizeSitePackagesPath(path: string): string {
  const normalized = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) throw new Error("Pyodide did not provide a site-packages path.");
  return `/${normalized}`;
}

function indexedDb(): IDBFactory | undefined {
  if (!("indexedDB" in globalThis)) return undefined;
  return globalThis.indexedDB;
}

export async function getRuntimeStoreStatus(): Promise<Exclude<RuntimeStoreStatus, "checking">> {
  const database = indexedDb();
  if (!database) return "unavailable";
  if (typeof database.databases !== "function") return "not-cached";

  try {
    const databases = await database.databases();
    return databases.some((candidate) => candidate.name === PYODIDE_RUNTIME_DB_NAME) ? "cached" : "not-cached";
  } catch {
    return "error";
  }
}

export function evictRuntimeStore(): Promise<void> {
  const database = indexedDb();
  if (!database) return Promise.reject(new Error("IndexedDB is not available in this browser."));

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = database.deleteDatabase(PYODIDE_RUNTIME_DB_NAME);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("The runtime store could not be evicted."));
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("The runtime store could not be evicted."));
    request.onblocked = () => reject(new Error("The runtime store is still in use. Close other Digest Me tabs and try again."));
  });
}
