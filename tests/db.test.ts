import { beforeEach, describe, expect, it } from "vitest";
import {
  getDecks,
  getDecksWithStarter,
  getDigestSession,
  getDigestSessionAssets,
  getDigestSessionSummaries,
  getDocument,
  getDocumentFile,
  getDocumentSummaries,
  getDocumentWithSource,
  getDocuments,
  getSessions,
  putDeck,
  putDigestSession,
  putDocumentWithFile,
  putSession,
  removeDeck,
  removeDigestSession,
  removeDocument,
  removeSessionsForDeck,
} from "../src/lib/db";
import { STARTER_DECK } from "../src/data/starter";
import {
  buildBlock,
  buildDeck,
  buildDocumentNode,
  buildDigestSession,
  buildParsedDocument,
  buildSection,
  buildSession,
} from "./factories";

/**
 * fake-indexeddb (test/setup.ts) backs window.indexedDB, so the real db.ts runs
 * unmodified. One database per file: state is managed through the exported API.
 */
async function removeAllDecks(): Promise<void> {
  for (const deck of await getDecks()) {
    await removeDeck(deck.id);
  }
}

async function removeAllSessions(): Promise<void> {
  for (const session of await getSessions()) {
    await removeSessionsForDeck(session.deckId);
  }
}

async function removeAllDocuments(): Promise<void> {
  for (const document of await getDocuments()) {
    await removeDocument(document.id);
  }
}

async function removeAllDigestSessions(): Promise<void> {
  for (const session of await getDigestSessionSummaries()) {
    await removeDigestSession(session.id);
  }
}

describe("starter deck seeding", () => {
  it("seeds the starter deck once on an empty database", async () => {
    expect(await getDecks()).toEqual([]);

    const first = await getDecksWithStarter();
    expect(first).toEqual([STARTER_DECK]);
    expect(await getDecks()).toEqual([STARTER_DECK]);

    const second = await getDecksWithStarter();
    expect(second).toEqual([STARTER_DECK]);
    expect(await getDecks()).toEqual([STARTER_DECK]);
  });

  it("returns existing decks without seeding again", async () => {
    const custom = buildDeck({ id: "deck-custom", name: "Custom deck" });
    await putDeck(custom);

    const result = await getDecksWithStarter();
    expect(result).toEqual(expect.arrayContaining([custom]));
    expect(result).toHaveLength((await getDecks()).length);
  });

  it("never reseeds once the starter deck has been deleted", async () => {
    await removeAllDecks();
    expect(await getDecks()).toEqual([]);
    expect(await getDecksWithStarter()).toEqual([]);
  });
});

describe("deck CRUD", () => {
  beforeEach(async () => {
    await removeAllDecks();
  });

  it("persists a deck and updates it in place", async () => {
    const deck = buildDeck({ id: "deck-crud", name: "Before" });
    await putDeck(deck);
    await putDeck({ ...deck, name: "After" });

    const decks = await getDecks();
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ id: "deck-crud", name: "After" });
  });

  it("removes a deck by id", async () => {
    await putDeck(buildDeck({ id: "deck-to-remove" }));
    await removeDeck("deck-to-remove");
    expect(await getDecks()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "deck-to-remove" })]));
  });
});

describe("study sessions", () => {
  beforeEach(async () => {
    await removeAllSessions();
  });

  it("persists sessions and lists them newest-first", async () => {
    const older = buildSession({ id: "session-old", updatedAt: "2026-08-01T10:00:00.000Z" });
    const newer = buildSession({ id: "session-new", updatedAt: "2026-08-02T10:00:00.000Z" });
    await putSession(older);
    await putSession(newer);

    const sessions = await getSessions();
    expect(sessions.map((session) => session.id)).toEqual(["session-new", "session-old"]);
  });

  it("removes every session for a deck", async () => {
    await putSession(buildSession({ id: "s-a-1", deckId: "deck-a" }));
    await putSession(buildSession({ id: "s-a-2", deckId: "deck-a" }));
    await putSession(buildSession({ id: "s-b-1", deckId: "deck-b" }));

    await removeSessionsForDeck("deck-a");

    const remaining = await getSessions();
    expect(remaining.map((session) => session.id)).toEqual(["s-b-1"]);
  });
});

describe("documents", () => {
  beforeEach(async () => {
    await removeAllDocuments();
  });

  function pdfFile(): File {
    return new File([new Uint8Array([1, 2, 3])], "case.pdf", { type: "application/pdf" });
  }

  it("persists a document tree with its pdf file and reads both back", async () => {
    const doc = buildParsedDocument({ id: "doc-xyz" });
    await putDocumentWithFile(doc, pdfFile());

    expect(await getDocument("doc-xyz")).toEqual(doc);

    const { document, file } = (await getDocumentWithSource("doc-xyz"))!;
    expect(document).toEqual(doc);
    expect(file.fileName).toBe("case.pdf");
    expect(file.mimeType).toBe("application/pdf");
    expect(file.blob.size).toBe(3);

    const storedFile = await getDocumentFile("doc-xyz");
    expect(storedFile?.fileName).toBe("case.pdf");
    expect(await getDocuments()).toEqual([doc]);
  });

  it("returns undefined for a missing document", async () => {
    expect(await getDocument("doc-missing")).toBeUndefined();
    expect(await getDocumentWithSource("doc-missing")).toBeUndefined();
    expect(await getDocumentFile("doc-missing")).toBeUndefined();
  });

  it("removes the tree and its pdf file together", async () => {
    await putDocumentWithFile(buildParsedDocument({ id: "doc-gone" }), pdfFile());
    await removeDocument("doc-gone");

    expect(await getDocument("doc-gone")).toBeUndefined();
    expect(await getDocumentFile("doc-gone")).toBeUndefined();
  });

  it("lists documents newest-first by parsedAt", async () => {
    await putDocumentWithFile(
      buildParsedDocument({ id: "doc-old", parsedAt: "2026-08-01T09:00:00.000Z" }),
      pdfFile(),
    );
    await putDocumentWithFile(
      buildParsedDocument({ id: "doc-new", parsedAt: "2026-08-02T09:00:00.000Z" }),
      pdfFile(),
    );

    const documents = await getDocuments();
    expect(documents.map((document) => document.id)).toEqual(["doc-new", "doc-old"]);
  });

  it("summarizes documents with flattened node counts", async () => {
    const root = buildDocumentNode({
      children: [
        buildSection("s1", "Section One", [buildBlock("b1", "Block one")]),
        buildSection("s2", "Section Two", []),
      ],
    });
    await putDocumentWithFile(
      buildParsedDocument({ id: "doc-summary", fileName: "summary.pdf", root }),
      pdfFile(),
    );

    const summaries = await getDocumentSummaries();
    expect(summaries).toEqual([
      {
        id: "doc-summary",
        fileName: "summary.pdf",
        parsedAt: "2026-08-01T09:00:00.000Z",
        pageCount: 3,
        pdfType: "TextBased",
        nodeCount: 4,
      },
    ]);
  });
});

describe("digest chat sessions", () => {
  beforeEach(async () => {
    await removeAllDigestSessions();
  });

  function pdfFile(): File {
    return new File([new Uint8Array([1, 2, 3])], "case.pdf", { type: "application/pdf" });
  }

  it("persists the transcript, response, source PDF, and generated DOCX", async () => {
    const session = buildDigestSession({ documentId: "doc-chat" });
    const document = buildParsedDocument({ id: "doc-chat" });
    const digestFile = {
      id: "docx-chat-answer",
      sessionId: session.id,
      fileName: "case-digest.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      blob: new Blob([new Uint8Array([4, 5, 6])]),
    };

    await putDigestSession(
      session,
      {
        document,
        file: { id: document.id, fileName: "case.pdf", mimeType: "application/pdf", blob: pdfFile() },
      },
      [digestFile],
    );

    const restored = await getDigestSession(session.id);
    expect(restored?.session).toEqual(session);
    expect(restored?.session.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "agent-answer", markdown: "The answer was stored locally." }),
    ]));
    expect(restored?.source?.document).toEqual(document);
    expect(restored?.source?.file.blob.size).toBe(3);
    expect(restored?.digestFiles).toEqual([digestFile]);
  });

  it("orders session summaries by most recent activity", async () => {
    await putDigestSession(buildDigestSession({ id: "digest-old", updatedAt: "2026-08-01T10:00:00.000Z" }));
    await putDigestSession(buildDigestSession({ id: "digest-new", updatedAt: "2026-08-02T10:00:00.000Z" }));

    const summaries = await getDigestSessionSummaries();
    expect(summaries.map((summary) => summary.id)).toEqual(["digest-new", "digest-old"]);
    expect(summaries[0]).toMatchObject({ title: "case.pdf", messageCount: 3 });
  });

  it("cascades the source PDF and DOCX assets when a session is deleted", async () => {
    const session = buildDigestSession({ documentId: "doc-delete" });
    const document = buildParsedDocument({ id: "doc-delete" });
    const digestFile = {
      id: "docx-delete-answer",
      sessionId: session.id,
      fileName: "case-digest.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      blob: new Blob([new Uint8Array([7, 8])]),
    };
    await putDigestSession(
      session,
      { document, file: { id: document.id, fileName: "case.pdf", mimeType: "application/pdf", blob: pdfFile() } },
      [digestFile],
    );

    await removeDigestSession(session.id);

    expect(await getDigestSession(session.id)).toBeUndefined();
    expect(await getDigestSessionAssets(session.id)).toEqual([]);
    expect(await getDocument(document.id)).toBeUndefined();
    expect(await getDocumentFile(document.id)).toBeUndefined();
  });
});
