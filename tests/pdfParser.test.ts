import { describe, expect, it, vi } from "vitest";
import type { PdfProcessResult } from "@firecrawl/pdf-inspector-wasm";
import { createPdfParser, type PdfInspectorRuntime } from "../src/parser/pdfParser";
import { PdfParseError } from "../src/parser/types";

/** Builds a faithful in-memory pdf-inspector runtime; each test owns a fresh parser bound to it. */
function testRuntime(overrides: Partial<PdfInspectorRuntime> = {}) {
  const init = vi.fn().mockResolvedValue(undefined);
  const processPdf = vi.fn();
  const version = vi.fn(() => "1.0.0-test");
  const runtime: PdfInspectorRuntime = { init, processPdf, version, ...overrides };
  return { runtime, init, processPdf, version };
}

function pdfFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "case.pdf", { type: "application/pdf" });
}

function processResult(overrides: Partial<PdfProcessResult> = {}) {
  return {
    markdown: "# Title\nSome body text.",
    title: "Extracted title",
    pdfType: "TextBased",
    pageCount: 2,
    confidence: 0.99,
    processingTimeMs: 5,
    hasEncodingIssues: false,
    ...overrides,
  };
}

describe("ensureParserReady", () => {
  it("wraps parser startup failures in a PdfParseError and recovers on retry", async () => {
    const { runtime, init } = testRuntime();
    init.mockRejectedValueOnce(new Error("wasm boom"));
    const { ensureParserReady } = createPdfParser(runtime);

    const firstAttempt = ensureParserReady();
    await expect(firstAttempt).rejects.toBeInstanceOf(PdfParseError);
    await expect(firstAttempt).rejects.toThrow("The PDF parser failed to start: wasm boom");
    await expect(ensureParserReady()).resolves.toBe("1.0.0-test");
  });

  it("loads the parser runtime once and reports its version", async () => {
    const { runtime, init } = testRuntime();
    const { ensureParserReady } = createPdfParser(runtime);

    await expect(ensureParserReady()).resolves.toBe("1.0.0-test");
    expect(init).toHaveBeenCalledOnce();
  });
});

describe("parsePdf", () => {
  it("turns extracted markdown into a typed document", async () => {
    const { runtime, processPdf } = testRuntime();
    processPdf.mockReturnValue(processResult());
    const { parsePdf } = createPdfParser(runtime);

    const document = await parsePdf(pdfFile());

    expect(document).toMatchObject({
      id: expect.stringMatching(/^doc-/),
      fileName: "case.pdf",
      fileSizeBytes: 3,
      parserVersion: "1.0.0-test",
      metrics: {
        pageCount: 2,
        pdfType: "TextBased",
        confidence: 0.99,
        processingTimeMs: 5,
        hasEncodingIssues: false,
      },
    });
    expect(processPdf).toHaveBeenCalledWith(expect.any(Uint8Array), {
      includePageMarkers: true,
      profile: "fidelity",
    });
    expect(document.root.children[0]).toMatchObject({ kind: "section", label: "Title" });
  });

  it("falls back to the file name when extraction has no title", async () => {
    const { runtime, processPdf } = testRuntime();
    processPdf.mockReturnValue(processResult({ title: undefined }));
    const { parsePdf } = createPdfParser(runtime);

    const document = await parsePdf(pdfFile());
    expect(document.root.label).toBe("case.pdf");
  });

  it("rejects scanned image-only PDFs with an OCR hint", async () => {
    const { runtime, processPdf } = testRuntime();
    processPdf.mockReturnValue(
      processResult({ markdown: "", pdfType: "ImageBased", pageCount: 0 }),
    );
    const { parsePdf } = createPdfParser(runtime);

    await expect(parsePdf(pdfFile())).rejects.toThrow(
      "This looks like a scanned image-only PDF. OCR is required before it can be digested.",
    );
  });

  it("rejects PDFs with no extractable text", async () => {
    const { runtime, processPdf } = testRuntime();
    processPdf.mockReturnValue(
      processResult({ markdown: "", pdfType: "TextBased", pageCount: 5 }),
    );
    const { parsePdf } = createPdfParser(runtime);

    await expect(parsePdf(pdfFile())).rejects.toThrow("No text could be extracted from this PDF.");
  });

  it("wraps extraction failures in a PdfParseError", async () => {
    const { runtime, processPdf } = testRuntime();
    processPdf.mockImplementation(() => {
      throw new Error("extraction exploded");
    });
    const { parsePdf } = createPdfParser(runtime);

    await expect(parsePdf(pdfFile())).rejects.toThrow("extraction exploded");
    await expect(parsePdf(pdfFile())).rejects.toBeInstanceOf(PdfParseError);
  });

  it("honors the compact profile option", async () => {
    const { runtime, processPdf } = testRuntime();
    processPdf.mockReturnValue(processResult());
    const { parsePdf } = createPdfParser(runtime);

    await parsePdf(pdfFile(), { profile: "compact" });
    expect(processPdf).toHaveBeenCalledWith(expect.any(Uint8Array), {
      includePageMarkers: true,
      profile: "compact",
    });
  });
});

describe("isPdfFile", () => {
  it("accepts files by name or mime type", () => {
    const { runtime } = testRuntime();
    const { isPdfFile } = createPdfParser(runtime);

    expect(isPdfFile(new File([], "brief.pdf"))).toBe(true);
    expect(isPdfFile(new File([], "BRIEF.PDF"))).toBe(true);
    expect(isPdfFile(new File([], "memo", { type: "application/pdf" }))).toBe(true);
  });

  it("rejects non-pdf files", () => {
    const { runtime } = testRuntime();
    const { isPdfFile } = createPdfParser(runtime);

    expect(isPdfFile(new File([], "brief.txt"))).toBe(false);
    expect(isPdfFile(new File([], "brief.pdf.txt"))).toBe(false);
    expect(isPdfFile(new File([], "memo", { type: "text/plain" }))).toBe(false);
  });
});
