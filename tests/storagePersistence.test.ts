import { describe, expect, it, vi } from "vitest";
import { requestPersistentStorageOnGesture } from "../src/lib/storagePersistence";

interface FakeTarget {
  listeners: Map<string, () => void>;
  addEventListener: (type: "pointerdown" | "keydown", listener: () => void) => void;
  removeEventListener: (type: "pointerdown" | "keydown", listener: () => void) => void;
}

function fakeTarget(): FakeTarget {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
}

describe("persistent storage request", () => {
  it("requests persistence once from the first user gesture", async () => {
    const target = fakeTarget();
    const storage = { persisted: vi.fn(async () => false), persist: vi.fn(async () => true) };
    const cleanup = requestPersistentStorageOnGesture(storage, target);
    await Promise.resolve();
    target.listeners.get("pointerdown")?.();
    target.listeners.get("keydown")?.();

    expect(storage.persist).toHaveBeenCalledOnce();
    cleanup();
  });

  it("does not request persistence when storage is already persistent", async () => {
    const target = fakeTarget();
    const storage = { persisted: vi.fn(async () => true), persist: vi.fn(async () => true) };
    requestPersistentStorageOnGesture(storage, target);
    await Promise.resolve();
    target.listeners.get("pointerdown")?.();

    expect(storage.persist).not.toHaveBeenCalled();
  });
});
