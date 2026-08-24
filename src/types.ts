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

/** A structured value crossing a runtime boundary (JSON body or worker message) before field-level validation. */
export type WireValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | WireValue[]
  | { [key: string]: WireValue };

/** Type guards for values arriving at a wire boundary; the only place raw typeof checks belong. */
export function isWireString(value: WireValue): value is string {
  return typeof value === "string";
}

export function isWireBoolean(value: WireValue): value is boolean {
  return typeof value === "boolean";
}

export function isWireNumber(value: WireValue): value is number {
  return typeof value === "number";
}

/** True for integers >= 0; durations, indexes, and timestamps arrive this way from the engine. */
export function isWireNonNegativeInteger(value: WireValue): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** True when the value is a non-null, non-array object record from the wire. */
export function isWireRecord(value: WireValue): value is Record<string, WireValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
