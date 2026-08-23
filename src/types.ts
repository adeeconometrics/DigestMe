export interface Flashcard {
  id: string;
  question: string;
  answer: string;
}

export interface Deck {
  id: string;
  name: string;
  sourceFile: string;
  createdAt: string;
  cards: Flashcard[];
}

export interface StudySession {
  id: string;
  deckId: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  reviewed: number;
  known: number;
  hard: number;
  again: number;
}

export interface CsvIssue {
  line: number;
  message: string;
}

export interface CsvCardDraft {
  question: string;
  answer: string;
  line: number;
}

export interface CsvValidationResult {
  headers: string[];
  cards: CsvCardDraft[];
  issues: CsvIssue[];
  headerValid: boolean;
  valid: boolean;
}

export type Rating = "again" | "hard" | "known";
export type AppView = "study" | "library" | "digest" | "settings";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

/** Lightweight listing entry derived from a stored ParsedDocument. */
export interface DocumentSummary {
  id: string;
  fileName: string;
  parsedAt: string;
  pageCount: number;
  pdfType: string;
  nodeCount: number;
}
