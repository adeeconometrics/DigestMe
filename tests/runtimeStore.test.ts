import { beforeEach, describe, expect, it } from "vitest";
import {
  PYODIDE_RUNTIME_DB_NAME,
  PYODIDE_RUNTIME_MARKER_VALUE,
} from "../src/pyodide/artifactCache";
import {
  classifyRuntimeMarker,
  evictRuntimeStore,
  getRuntimeStoreStatus,
  normalizeSitePackagesPath,
} from "../src/pyodide/runtimeStore";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not delete test database."));
    request.onblocked = () => reject(new Error("Test database deletion was blocked."));
  });
}

function createDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("FILE_DATA")) request.result.createObjectStore("FILE_DATA");
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error ?? new Error("Could not create test database."));
  });
}

async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB.databases !== "function") return false;
  const databases = await indexedDB.databases();
  return databases.some((database) => database.name === name);
}

describe("runtime marker", () => {
  it("classifies missing, stale, and current markers", () => {
    expect(classifyRuntimeMarker(undefined)).toBe("missing");
    expect(classifyRuntimeMarker("old-runtime")).toBe("mismatch");
    expect(classifyRuntimeMarker(` ${PYODIDE_RUNTIME_MARKER_VALUE}\n`)).toBe("current");
  });

  it("normalizes Pyodide site-packages paths", () => {
    expect(normalizeSitePackagesPath("//lib/python3.14/site-packages/")).toBe("/lib/python3.14/site-packages");
    expect(() => normalizeSitePackagesPath(" / ")).toThrow("site-packages path");
  });
});

describe("runtime store", () => {
  beforeEach(async () => {
    await deleteDatabase(PYODIDE_RUNTIME_DB_NAME);
    await deleteDatabase("digest-me-unrelated-test-store");
  });

  it("evicts only the IDBFS runtime database", async () => {
    await createDatabase(PYODIDE_RUNTIME_DB_NAME);
    await createDatabase("digest-me-unrelated-test-store");

    expect(await getRuntimeStoreStatus()).toBe("cached");
    await evictRuntimeStore();

    if (typeof indexedDB.databases === "function") {
      expect(await databaseExists(PYODIDE_RUNTIME_DB_NAME)).toBe(false);
      expect(await databaseExists("digest-me-unrelated-test-store")).toBe(true);
    }
  });
});
