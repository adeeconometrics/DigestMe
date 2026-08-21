import { STARTER_DECK } from "../data/starter";
import type { Deck, StudySession } from "../types";

const DATABASE_NAME = "recall-studio";
const DATABASE_VERSION = 1;
const DECK_STORE = "decks";
const SESSION_STORE = "sessions";
const META_STORE = "meta";
const STARTER_SEEDED_KEY = "starter-seeded";

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }

  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DECK_STORE)) {
        database.createObjectStore(DECK_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        sessions.createIndex("deckId", "deckId", { unique: false });
        sessions.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error ?? new Error("Could not open IndexedDB."));
    };
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another open connection."));
  });

  return databasePromise;
}

function completeTransaction(database: IDBDatabase, storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export async function getDecks(): Promise<Deck[]> {
  const database = await openDatabase();
  const transaction = database.transaction(DECK_STORE, "readonly");
  return requestValue(transaction.objectStore(DECK_STORE).getAll());
}

/** Seed once so a new install has a useful study surface without reappearing after deletion. */
export async function getDecksWithStarter(): Promise<Deck[]> {
  const database = await openDatabase();
  const decks = await requestValue<Deck[]>(database.transaction(DECK_STORE, "readonly").objectStore(DECK_STORE).getAll());
  if (decks.length) return decks;

  const meta = await requestValue<{ key: string; value: boolean } | undefined>(database.transaction(META_STORE, "readonly").objectStore(META_STORE).get(STARTER_SEEDED_KEY));
  if (meta?.value) return [];

  await completeTransaction(database, DECK_STORE, "readwrite", (store) => store.put(STARTER_DECK));
  await completeTransaction(database, META_STORE, "readwrite", (store) => store.put({ key: STARTER_SEEDED_KEY, value: true }));
  return [STARTER_DECK];
}

export async function putDeck(deck: Deck): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, DECK_STORE, "readwrite", (store) => store.put(deck));
}

export async function removeDeck(deckId: string): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, DECK_STORE, "readwrite", (store) => store.delete(deckId));
}

export async function getSessions(): Promise<StudySession[]> {
  const database = await openDatabase();
  const sessions = await requestValue<StudySession[]>(database.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE).getAll());
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function putSession(session: StudySession): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, SESSION_STORE, "readwrite", (store) => store.put(session));
}

export async function removeSessionsForDeck(deckId: string): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, SESSION_STORE, "readwrite", (store) => {
    const request = store.index("deckId").openCursor(IDBKeyRange.only(deckId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  });
}
