import { STARTER_DECK } from "../data/starter";
import {
  sortDigestSessionSummaries,
  summarizeDigestSession,
  type ChatThread,
  type DigestSession,
  type DigestSessionAsset,
  type DigestSessionSummary,
  type PersistedChatMessage,
} from "../chat/session";
import type { ParsedDocument } from "../parser";
import { flattenTree } from "../parser";
import type { Deck, DocumentSummary, StudySession } from "../types";

const DATABASE_NAME = "recall-studio";
const DATABASE_VERSION = 5;
const DECK_STORE = "decks";
const SESSION_STORE = "sessions";
const META_STORE = "meta";
const DOCUMENT_STORE = "documents";
const DOCUMENT_FILE_STORE = "documentFiles";
const CHAT_SESSION_STORE = "chatSessions";
const CHAT_STORE = "chats";
const DIGEST_FILE_STORE = "digestFiles";
const STARTER_SEEDED_KEY = "starter-seeded";

/**
 * Documents awaiting their cascade delete. An in-flight snapshot persist from
 * an unmounting digest tab must not resurrect a session the user just deleted,
 * so `putDigestSession` skips any document marked here until the delete lands.
 */
const deletedDocumentIds = new Set<string>();

/** Marks a document so pending session persists will skip it. */
export function markDocumentDeleted(documentId: string): void {
  deletedDocumentIds.add(documentId);
}

function legacyDigestSession(document: ParsedDocument): DigestSession {
  const at = document.parsedAt;
  const messages: PersistedChatMessage[] = [
    { id: `legacy-welcome-${document.id}`, at, role: "assistant", kind: "welcome" },
    { id: `legacy-attachment-${document.id}`, at, role: "user", kind: "attachment", fileName: document.fileName },
    {
      id: `legacy-summary-${document.id}`,
      at,
      role: "assistant",
      kind: "parse-summary",
      fileName: document.fileName,
      pageCount: document.metrics.pageCount,
      nodeCount: flattenTree(document.root).length,
      ms: document.metrics.processingTimeMs,
      pdfType: document.metrics.pdfType,
    },
  ];

  return {
    id: `digest-${document.id}`,
    title: document.fileName,
    documentId: document.id,
    createdAt: at,
    updatedAt: at,
    messages,
  };
}

function chatThreadFromDigestSession(session: DigestSession): ChatThread | undefined {
  if (!session.documentId) return undefined;
  return {
    threadId: session.id,
    documentId: session.documentId,
    messages: session.messages,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

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

export type StoredDigestFile = DigestSessionAsset;

export interface DigestSessionData {
  session: DigestSession;
  source?: DocumentWithSource;
  digestFiles: StoredDigestFile[];
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }

  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const hadDocumentStore = database.objectStoreNames.contains(DOCUMENT_STORE);
      const hadChatSessionStore = database.objectStoreNames.contains(CHAT_SESSION_STORE);
      const hadChatStore = database.objectStoreNames.contains(CHAT_STORE);
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
      if (!database.objectStoreNames.contains(CHAT_SESSION_STORE)) {
        const chatSessions = database.createObjectStore(CHAT_SESSION_STORE, { keyPath: "id" });
        chatSessions.createIndex("updatedAt", "updatedAt", { unique: false });
        chatSessions.createIndex("documentId", "documentId", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHAT_STORE)) {
        const chats = database.createObjectStore(CHAT_STORE, { keyPath: "threadId" });
        chats.createIndex("updatedAt", "updatedAt", { unique: false });
        chats.createIndex("documentId", "documentId", { unique: false });
      }
      if (!database.objectStoreNames.contains(DIGEST_FILE_STORE)) {
        const digestFiles = database.createObjectStore(DIGEST_FILE_STORE, { keyPath: "id" });
        digestFiles.createIndex("sessionId", "sessionId", { unique: false });
      }

      // Documents created by v3 were already session-shaped in the UI. Give
      // them a durable transcript shell instead of leaving them orphaned.
      if (!hadChatSessionStore && hadDocumentStore) {
        const upgradeTransaction = request.transaction;
        if (upgradeTransaction) {
          const documents = upgradeTransaction.objectStore(DOCUMENT_STORE);
          const chatSessions = upgradeTransaction.objectStore(CHAT_SESSION_STORE);
          const cursorRequest = documents.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            // SAFETY: the documents store contains ParsedDocument records written by this module.
            const document = cursor.value as ParsedDocument;
            const session = legacyDigestSession(document);
            chatSessions.put(session);
            if (!hadChatStore) {
              const thread = chatThreadFromDigestSession(session);
              if (thread) upgradeTransaction.objectStore(CHAT_STORE).put(thread);
            }
            cursor.continue();
          };
        }
      }
      if (!hadChatStore && hadChatSessionStore) {
        const upgradeTransaction = request.transaction;
        if (upgradeTransaction) {
          const chatSessions = upgradeTransaction.objectStore(CHAT_SESSION_STORE);
          const chats = upgradeTransaction.objectStore(CHAT_STORE);
          const cursorRequest = chatSessions.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            // SAFETY: chatSessions is only written with the DigestSession shape by this module.
            const session = cursor.value as DigestSession;
            if (session.documentId) {
              const thread = chatThreadFromDigestSession(session);
              if (thread) chats.put(thread);
            }
            cursor.continue();
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

/** Read a namespaced value from the local metadata store. */
export async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  const record = await requestValue<{ key: string; value: T } | undefined>(
    database.transaction(META_STORE, "readonly").objectStore(META_STORE).get(key),
  );
  return record?.value;
}

/** Write a namespaced value to the local metadata store. */
export async function putMetaValue<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, META_STORE, "readwrite", (store) => store.put({ key, value }));
}

/** Remove a namespaced value from the local metadata store. */
export async function removeMetaValue(key: string): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, META_STORE, "readwrite", (store) => store.delete(key));
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

export async function getDigestSessionSummaries(): Promise<DigestSessionSummary[]> {
  const database = await openDatabase();
  const sessions = await requestValue<DigestSession[]>(
    database.transaction(CHAT_SESSION_STORE, "readonly").objectStore(CHAT_SESSION_STORE).getAll(),
  );
  return sortDigestSessionSummaries(sessions.map(summarizeDigestSession));
}

/** Load a transcript together with the PDF and DOCX assets it owns. */
export async function getDigestSession(sessionId: string): Promise<DigestSessionData | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [CHAT_SESSION_STORE, DOCUMENT_STORE, DOCUMENT_FILE_STORE, DIGEST_FILE_STORE],
    "readonly",
  );
  const [session, documents, documentFiles, digestFiles] = await Promise.all([
    requestValue<DigestSession | undefined>(transaction.objectStore(CHAT_SESSION_STORE).get(sessionId)),
    requestValue<ParsedDocument[]>(transaction.objectStore(DOCUMENT_STORE).getAll()),
    requestValue<StoredDocumentFile[]>(transaction.objectStore(DOCUMENT_FILE_STORE).getAll()),
    requestValue<StoredDigestFile[]>(
      transaction.objectStore(DIGEST_FILE_STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId)),
    ),
  ]);
  if (!session) return undefined;

  if (!session.documentId) return { session, digestFiles };
  const document = documents.find((candidate) => candidate.id === session.documentId);
  const file = documentFiles.find((candidate) => candidate.id === session.documentId);
  return {
    session,
    digestFiles,
    ...(document && file ? { source: { document, file } } : {}),
  };
}

export async function getDigestSessionAssets(sessionId: string): Promise<StoredDigestFile[]> {
  const database = await openDatabase();
  return requestValue<StoredDigestFile[]>(
    database.transaction(DIGEST_FILE_STORE, "readonly").objectStore(DIGEST_FILE_STORE).index("sessionId").getAll(IDBKeyRange.only(sessionId)),
  );
}

export async function getChatThread(threadId: string): Promise<ChatThread | undefined> {
  const database = await openDatabase();
  return requestValue<ChatThread | undefined>(
    database.transaction(CHAT_STORE, "readonly").objectStore(CHAT_STORE).get(threadId),
  );
}

export async function getChatThreadForDocument(documentId: string): Promise<ChatThread | undefined> {
  const database = await openDatabase();
  const threads = await requestValue<ChatThread[]>(
    database.transaction(CHAT_STORE, "readonly").objectStore(CHAT_STORE).index("documentId").getAll(IDBKeyRange.only(documentId)),
  );
  return threads.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export async function getChatThreads(): Promise<ChatThread[]> {
  const database = await openDatabase();
  const threads = await requestValue<ChatThread[]>(database.transaction(CHAT_STORE, "readonly").objectStore(CHAT_STORE).getAll());
  return threads.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function putChatThread(thread: ChatThread): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, CHAT_STORE, "readwrite", (store) => store.put(thread));
}

export async function removeChatThread(threadId: string): Promise<void> {
  const database = await openDatabase();
  await completeTransaction(database, CHAT_STORE, "readwrite", (store) => store.delete(threadId));
}

/** Persist a transcript and its owned source/assets in one IndexedDB transaction. */
export async function putDigestSession(
  session: DigestSession,
  source?: DocumentWithSource,
  digestFiles?: StoredDigestFile[],
): Promise<void> {
  if (session.documentId !== null && deletedDocumentIds.has(session.documentId)) return;
  if (source && source.document.id !== session.documentId) {
    throw new Error("A digest session source must match its document reference.");
  }
  if (digestFiles?.some((file) => file.sessionId !== session.id)) {
    throw new Error("A digest session can only store assets that belong to it.");
  }

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [CHAT_SESSION_STORE, CHAT_STORE, DOCUMENT_STORE, DOCUMENT_FILE_STORE, DIGEST_FILE_STORE],
      "readwrite",
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));

    transaction.objectStore(CHAT_SESSION_STORE).put(session);
    const thread = chatThreadFromDigestSession(session);
    if (thread) transaction.objectStore(CHAT_STORE).put(thread);
    else transaction.objectStore(CHAT_STORE).delete(session.id);
    if (source) {
      transaction.objectStore(DOCUMENT_STORE).put(source.document);
      transaction.objectStore(DOCUMENT_FILE_STORE).put(source.file);
    }
    if (digestFiles === undefined) return;

    const filesById = new Map(digestFiles.map((file) => [file.id, file]));
    const digestStore = transaction.objectStore(DIGEST_FILE_STORE);
    for (const file of digestFiles) digestStore.put(file);
    const cursorRequest = digestStore.index("sessionId").openCursor(IDBKeyRange.only(session.id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      if (!filesById.has(cursor.value.id)) cursor.delete();
      cursor.continue();
    };
  });
}

/** Delete a digest session and every PDF/DOCX object owned by that session. */
export async function removeDigestSession(sessionId: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [CHAT_SESSION_STORE, CHAT_STORE, DOCUMENT_STORE, DOCUMENT_FILE_STORE, DIGEST_FILE_STORE],
      "readwrite",
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));

    const sessionStore = transaction.objectStore(CHAT_SESSION_STORE);
    const sessionRequest = sessionStore.get(sessionId);
    sessionRequest.onsuccess = () => {
      // SAFETY: chatSessions is only written with the DigestSession shape by this module.
      const session = sessionRequest.result as DigestSession | undefined;
      sessionStore.delete(sessionId);
      transaction.objectStore(CHAT_STORE).delete(sessionId);
      if (session?.documentId) {
        transaction.objectStore(DOCUMENT_STORE).delete(session.documentId);
        transaction.objectStore(DOCUMENT_FILE_STORE).delete(session.documentId);
      }
    };

    const digestStore = transaction.objectStore(DIGEST_FILE_STORE);
    const cursorRequest = digestStore.index("sessionId").openCursor(IDBKeyRange.only(sessionId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  });
}

/**
 * Removes a document and everything that references it in one transaction:
 * its PDF source, chat threads, digest session, and the session's DOCX assets.
 * Clears the deletion mark once the cascade has landed.
 */
export async function removeDocumentWithSessions(documentId: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [CHAT_SESSION_STORE, CHAT_STORE, DOCUMENT_STORE, DOCUMENT_FILE_STORE, DIGEST_FILE_STORE],
      "readwrite",
    );
    transaction.oncomplete = () => {
      deletedDocumentIds.delete(documentId);
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));

    transaction.objectStore(DOCUMENT_STORE).delete(documentId);
    transaction.objectStore(DOCUMENT_FILE_STORE).delete(documentId);

    const chats = transaction.objectStore(CHAT_STORE);
    const chatRequest = chats.index("documentId").openCursor(IDBKeyRange.only(documentId));
    chatRequest.onsuccess = () => {
      const cursor = chatRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };

    const sessions = transaction.objectStore(CHAT_SESSION_STORE);
    const sessionRequest = sessions.index("documentId").openCursor(IDBKeyRange.only(documentId));
    sessionRequest.onsuccess = () => {
      const cursor = sessionRequest.result;
      if (!cursor) return;
      // SAFETY: chatSessions is only written with the DigestSession shape by this module.
      const session = cursor.value as DigestSession;
      sessions.delete(session.id);
      const digestStore = transaction.objectStore(DIGEST_FILE_STORE);
      const fileRequest = digestStore.index("sessionId").openCursor(IDBKeyRange.only(session.id));
      fileRequest.onsuccess = () => {
        const fileCursor = fileRequest.result;
        if (!fileCursor) return;
        fileCursor.delete();
        fileCursor.continue();
      };
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
    const transaction = database.transaction([DOCUMENT_STORE, DOCUMENT_FILE_STORE, CHAT_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete(documentId);
    transaction.objectStore(DOCUMENT_FILE_STORE).delete(documentId);
    const chats = transaction.objectStore(CHAT_STORE);
    const request = chats.index("documentId").openCursor(IDBKeyRange.only(documentId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
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
