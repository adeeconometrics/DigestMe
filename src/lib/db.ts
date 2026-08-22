import { STARTER_DECK } from "../data/starter";
import type { ParsedDocument } from "../parser";
import { flattenTree } from "../parser";
import type { Deck, DocumentSummary, StudySession } from "../types";

const DATABASE_NAME = "recall-studio";
const DATABASE_VERSION = 3;
const DECK_STORE = "decks";
const SESSION_STORE = "sessions";
const META_STORE = "meta";
const DOCUMENT_STORE = "documents";
const DOCUMENT_FILE_STORE = "documentFiles";
const STARTER_SEEDED_KEY = "starter-seeded";

/** The PDF source bytes that must accompany every stored document tree. */
export interface StoredDocumentFile {
  id: string;
  mimeType: string;
  fileName: string;
  blob: Blob;
}

/** A parsed tree together with the PDF bytes it was derived from. */
export interface DocumentWithSource {
  document: ParsedDocument;
  file: StoredDocumentFile;
}

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
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(DOCUMENT_FILE_STORE)) {
        database.createObjectStore(DOCUMENT_FILE_STORE, { keyPath: "id" });
        // Enforce the invariant "no document tree without its PDF source":
        // trees stored before blobs were tracked cannot be referenced anymore.
        const upgradeTransaction = request.transaction;
        if (upgradeTransaction) {
          const files = upgradeTransaction.objectStore(DOCUMENT_FILE_STORE);
          const documents = upgradeTransaction.objectStore(DOCUMENT_STORE);
          const cursorRequest = documents.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const hasFile = files.count(cursor.primaryKey);
            hasFile.onsuccess = () => {
              if (hasFile.result === 0) cursor.delete();
              cursor.continue();
            };
          };
        }
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

/**
 * Persists a parsed tree and its PDF source bytes in a single transaction,
 * guaranteeing the invariant: there is never a document tree without its blob.
 */
export async function putDocumentWithFile(document: ParsedDocument, file: File): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DOCUMENT_STORE, DOCUMENT_FILE_STORE], "readwrite");
    const record: StoredDocumentFile = {
      id: document.id,
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      blob: file,
    };
    transaction.objectStore(DOCUMENT_STORE).put(document);
    transaction.objectStore(DOCUMENT_FILE_STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

export async function getDocument(documentId: string): Promise<ParsedDocument | undefined> {
  const database = await openDatabase();
  return requestValue<ParsedDocument | undefined>(
    database.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).get(documentId),
  );
}

/** Loads the tree together with the PDF bytes it references. */
export async function getDocumentWithSource(documentId: string): Promise<DocumentWithSource | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction([DOCUMENT_STORE, DOCUMENT_FILE_STORE], "readonly");
  const [document, file] = await Promise.all([
    requestValue<ParsedDocument | undefined>(transaction.objectStore(DOCUMENT_STORE).get(documentId)),
    requestValue<StoredDocumentFile | undefined>(transaction.objectStore(DOCUMENT_FILE_STORE).get(documentId)),
  ]);
  return document && file ? { document, file } : undefined;
}

export async function getDocumentFile(documentId: string): Promise<StoredDocumentFile | undefined> {
  const database = await openDatabase();
  return requestValue<StoredDocumentFile | undefined>(
    database.transaction(DOCUMENT_FILE_STORE, "readonly").objectStore(DOCUMENT_FILE_STORE).get(documentId),
  );
}

/** Removes the tree and its PDF source atomically. */
export async function removeDocument(documentId: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DOCUMENT_STORE, DOCUMENT_FILE_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete(documentId);
    transaction.objectStore(DOCUMENT_FILE_STORE).delete(documentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

/** Returns parsed documents newest-first. */
export async function getDocuments(): Promise<ParsedDocument[]> {
  const database = await openDatabase();
  const documents = await requestValue<ParsedDocument[]>(database.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).getAll());
  return documents.sort((left, right) => right.parsedAt.localeCompare(left.parsedAt));
}

/** Listing entries without shipping every tree to the UI at once. */
export async function getDocumentSummaries(): Promise<DocumentSummary[]> {
  const documents = await getDocuments();
  return documents.map((document) => ({
    id: document.id,
    fileName: document.fileName,
    parsedAt: document.parsedAt,
    pageCount: document.metrics.pageCount,
    pdfType: document.metrics.pdfType,
    nodeCount: flattenTree(document.root).length,
  }));
}
