import init, { processPdf, version } from "@firecrawl/pdf-inspector-wasm";
import { buildContextTree } from "./contextTree";
import { PdfParseError, type ParsedDocument } from "./types";

let initPromise: Promise<string> | undefined;

/**
 * Loads the pdf-inspector WebAssembly runtime once per page load.
 * Everything runs client-side: PDF bytes never leave the browser.
 */
export async function ensureParserReady(): Promise<string> {
  if (!initPromise) {
    initPromise = init().then(() => version());
  }
  try {
    return await initPromise;
  } catch (error) {
    initPromise = undefined;
    throw new PdfParseError(`The PDF parser failed to start: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
}

/**
 * Ingests a PDF entirely in the browser and maps it onto a typed context tree.
 *
 * 1. Reads the file into bytes and hands them to Firecrawl's pdf-inspector
 *    (Rust compiled to WASM) for classification + markdown extraction.
 * 2. `buildContextTree` maps that markdown onto a hierarchical JSON tree,
 *    tracking `(section, page)` references from `<!-- Page N -->` markers.
 *
 * Returns a plain JSON object safe to store in IndexedDB or feed to sigma.js.
 */
export async function parsePdf(
  file: File,
  options: { title?: string; profile?: "fidelity" | "compact" } = {},
): Promise<ParsedDocument> {
  const parserVersion = await ensureParserReady();

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new PdfParseError("The browser could not read this file. Try selecting it again.");
  }

  let result: ReturnType<typeof processPdf>;
  try {
    result = processPdf(bytes, {
      includePageMarkers: true,
      profile: options.profile ?? "fidelity",
    });
  } catch (error) {
    throw new PdfParseError(error instanceof Error ? error.message : "This PDF could not be parsed.");
  }

  const encryptedLike = !result.markdown && result.pdfType === "ImageBased";
  if (!result.markdown || encryptedLike || !result.pageCount) {
    throw new PdfParseError(
      result.pdfType === "ImageBased"
        ? "This looks like a scanned image-only PDF. OCR is required before it can be digested."
        : "No text could be extracted from this PDF.",
    );
  }

  const root = buildContextTree(result.markdown, options.title ?? result.title ?? file.name);

  return {
    id: makeDocumentId(),
    fileName: file.name,
    fileSizeBytes: file.size,
    parsedAt: new Date().toISOString(),
    parserVersion,
    metrics: {
      pageCount: result.pageCount,
      pdfType: result.pdfType,
      confidence: result.confidence,
      processingTimeMs: result.processingTimeMs,
      hasEncodingIssues: result.hasEncodingIssues,
    },
    root,
  };
}

function makeDocumentId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `doc-${randomId ?? Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
