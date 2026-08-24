interface StoragePersistenceAdapter {
  persisted: () => Promise<boolean>;
  persist: () => Promise<boolean>;
}

interface GestureTarget {
  addEventListener: (type: "pointerdown" | "keydown", listener: () => void, options?: AddEventListenerOptions) => void;
  removeEventListener: (type: "pointerdown" | "keydown", listener: () => void) => void;
}

export function requestPersistentStorageOnGesture(
  storage: StoragePersistenceAdapter | undefined = typeof navigator === "undefined" ? undefined : navigator.storage,
  target: GestureTarget | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!storage || !target) return () => undefined;

  let requested = false;
  let alreadyPersistent = false;
  let persistenceKnown = false;

  const removeListeners = (): void => {
    target.removeEventListener("pointerdown", requestPersistence);
    target.removeEventListener("keydown", requestPersistence);
  };

  const requestPersistence = (): void => {
    if (requested || alreadyPersistent) return;
    requested = true;
    removeListeners();
    if (persistenceKnown && alreadyPersistent) return;
    void storage.persist().catch(() => undefined);
  };

  target.addEventListener("pointerdown", requestPersistence, { once: true });
  target.addEventListener("keydown", requestPersistence, { once: true });
  void storage.persisted()
    .then((persistent) => {
      alreadyPersistent = persistent;
      persistenceKnown = true;
      if (persistent) removeListeners();
    })
    .catch(() => {
      persistenceKnown = true;
    });

  return removeListeners;
}
