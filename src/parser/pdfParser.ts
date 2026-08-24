import init, { processPdf, version } from "@firecrawl/pdf-inspector-wasm";
import type { InitOutput, PdfProcessResult, ProcessOptions } from "@firecrawl/pdf-inspector-wasm";
import { buildContextTree } from "./contextTree";
import { PdfParseError, type ParsedDocument } from "./types";

/** The pdf-inspector surface parsePdf depends on; injectable so tests can drive it without module mocks. */
export interface PdfInspectorRuntime {
  init(): Promise<InitOutput>;
  processPdf(data: Uint8Array, options?: ProcessOptions): PdfProcessResult;
  version(): string;
}

/** The production runtime backed by the pdf-inspector WASM build. */
const wasmRuntime: PdfInspectorRuntime = {
  init: () => init(),
  processPdf,
  version,
};

/**
 * Builds a PDF parser bound to the given runtime.
 *
 * `ensureParserReady` caches its init promise per parser instance, so tests
 * create a fresh parser (and runtime) instead of resetting module state.
 */
export function createPdfParser(runtime: PdfInspectorRuntime = wasmRuntime) {
  let initPromise: Promise<string> | undefined;

  /**
   * Loads the pdf-inspector WebAssembly runtime once per parser instance.
   * Everything runs client-side: PDF bytes never leave the browser.
   */
  async function ensureParserReady(): Promise<string> {
    if (!initPromise) {
      initPromise = runtime.init().then(() => runtime.version());
    }
    try {
      return await initPromise;
    } catch (error) {
      initPromise = undefined;
      throw new PdfParseError(`The PDF parser failed to start: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  function isPdfFile(file: File): boolean {
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
  async function parsePdf(
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

    let result: PdfProcessResult;
    try {
      result = runtime.processPdf(bytes, {
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

  return { ensureParserReady, isPdfFile, parsePdf };
}

const parser = createPdfParser();
export const ensureParserReady = parser.ensureParserReady;
export const isPdfFile = parser.isPdfFile;
export const parsePdf = parser.parsePdf;

function makeDocumentId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `doc-${randomId ?? Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
