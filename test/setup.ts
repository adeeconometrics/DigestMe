import "fake-indexeddb/auto";

// src/lib/db.ts guards on window.indexedDB; node has no window, so point it at
// the fake so the real IndexedDB wrapper can be exercised unmodified.
if (typeof globalThis.window === "undefined") {
  (globalThis as { window?: unknown }).window = globalThis;
}
