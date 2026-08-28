/**
 * Typed JSON contract for the parsed document context tree.
 *
 * The tree is produced by `src/parser` from pdf-inspector markdown output and
 * consumed by the sigma.js graph visualization and IndexedDB persistence.
 */

export type DocumentNodeKind = "document" | "section" | "block";

/** A single node in the document context tree. Serializable to plain JSON. */
export interface DocumentNode {
  /** Stable id (unique within a ParsedDocument), used as the sigma node key. */
  id: string;
  kind: DocumentNodeKind;
  /** Short display label, e.g. heading text or a snippet of body content. */
  label: string;
  /**
   * Full untruncated heading text for document/section nodes, kept for exact
   * search and navigation even when the display label is shortened.
   */
  heading?: string;
  /**
   * Nearest enclosing section reference, e.g. "II. Facts › A. Background".
   * Shown on hover as `(section, p#)`.
   */
  section: string;
  /** 1-indexed page this node's content starts on, when known. */
  page: number | null;
  /** Full text for leaf blocks; sections summarize their children. */
  text?: string;
  children: DocumentNode[];
}

export type PdfType = "TextBased" | "Scanned" | "ImageBased" | "Mixed";

export interface ParseMetrics {
  pageCount: number;
  pdfType: PdfType;
  confidence: number;
  processingTimeMs: number;
  hasEncodingIssues: boolean;
}

/** Full result of parsing one PDF, safe to persist in IndexedDB as JSON. */
export interface ParsedDocument {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  parsedAt: string;
  parserVersion: string;
  metrics: ParseMetrics;
  root: DocumentNode;
}

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfParseError";
  }
}
