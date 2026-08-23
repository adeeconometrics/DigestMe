import type {
  CaseDigest,
  CaseDigestFacts,
  CaseDigestIssue,
  CaseDigestIssueInput,
} from "../lib/caseDigestDocx";
import type { DocumentNode, ParseMetrics, ParsedDocument } from "../parser";
import type { Deck, Flashcard, StudySession } from "../types";

/**
 * Shared test builders. Prefer `buildX({ field: value })` over full literals
 * so cases stay readable and extend in one place.
 */

// --- Case digest (src/lib/caseDigestDocx.ts) ---

export function buildCaseDigest(overrides: Partial<CaseDigest> = {}): CaseDigest {
  return {
    case_title: "Test Case v. Respondent",
    petitioner: "Petitioner",
    respondent: "Respondent",
    topic_subtopic: "Topic › Subtopic",
    subject: "Subject",
    ponente: "Ponente, J.",
    gr_no_date: "G.R. No. 12345 | Jan 1, 2020",
    full_text: "Full text of the case.",
    summary: "Summary of the case.",
    doctrine: "Doctrine of the case.",
    provisions: "Art. 1",
    facts: buildFacts(),
    petitioners_arguments: ["Petitioner argument."],
    respondents_arguments: ["Respondent argument."],
    procedural_posture: ["LA RULING: For petitioner."],
    issues: [buildIssue()],
    supreme_court_ruling: "Petition granted.",
    class_notes: ["Class note."],
    ...overrides,
  };
}

export function buildFacts(overrides: Partial<CaseDigestFacts> = {}): CaseDigestFacts {
  return {
    petition: ["Fact one.", "Fact two."],
    ...overrides,
  };
}

export function buildIssue(overrides: Partial<CaseDigestIssue> = {}): CaseDigestIssue {
  return {
    issue: "WON the case wins.",
    ruling: "YES",
    ratio: "Because of the doctrine.",
    ...overrides,
  };
}

export function buildIssuePair(ruling = "YES", ratio = "Because of the doctrine."): CaseDigestIssueInput {
  return [ruling, ratio];
}

// --- Document tree (src/parser, src/graph, src/pdf, src/chat) ---

export function buildDocumentNode(overrides: Partial<DocumentNode> = {}): DocumentNode {
  return {
    id: "n0",
    kind: "document",
    label: "Document",
    section: "Document",
    page: null,
    children: [],
    ...overrides,
  };
}

export function buildBlock(
  id: string,
  label: string,
  overrides: Partial<DocumentNode> = {},
): DocumentNode {
  return buildDocumentNode({ id, kind: "block", label, section: label, ...overrides });
}

export function buildSection(
  id: string,
  label: string,
  children: DocumentNode[] = [],
  overrides: Partial<DocumentNode> = {},
): DocumentNode {
  return buildDocumentNode({ id, kind: "section", label, section: label, children, ...overrides });
}

// --- Persistence (src/lib/db.ts, src/types.ts) ---

export function buildFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "card-1",
    question: "Question?",
    answer: "Answer.",
    ...overrides,
  };
}

export function buildDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: "deck-1",
    name: "Test deck",
    sourceFile: "test.csv",
    createdAt: "2026-08-01T00:00:00.000Z",
    cards: [buildFlashcard()],
    ...overrides,
  };
}

export function buildSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session-1",
    deckId: "deck-1",
    startedAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    reviewed: 1,
    known: 1,
    hard: 0,
    again: 0,
    ...overrides,
  };
}

export function buildParseMetrics(overrides: Partial<ParseMetrics> = {}): ParseMetrics {
  return {
    pageCount: 3,
    pdfType: "TextBased",
    confidence: 0.99,
    processingTimeMs: 120,
    hasEncodingIssues: false,
    ...overrides,
  };
}

export function buildParsedDocument(overrides: Partial<ParsedDocument> = {}): ParsedDocument {
  const { metrics, ...rest } = overrides;
  return {
    id: "doc-1",
    fileName: "case.pdf",
    fileSizeBytes: 1024,
    parsedAt: "2026-08-01T09:00:00.000Z",
    parserVersion: "1.0.0",
    metrics: buildParseMetrics(metrics),
    root: buildDocumentNode(),
    ...rest,
  };
}
