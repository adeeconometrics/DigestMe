import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfProcessResult } from "@firecrawl/pdf-inspector-wasm";

const mocks = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  processPdf: vi.fn(),
  version: vi.fn(() => "1.0.0-test"),
}));

vi.mock("@firecrawl/pdf-inspector-wasm", () => ({
  default: mocks.init,
  processPdf: mocks.processPdf,
  version: mocks.version,
}));

// ensureParserReady caches its init promise at module scope, so each test gets
// a fresh module instance to observe startup behavior deterministically.
beforeEach(() => {
  vi.resetModules();
  mocks.processPdf.mockReset();
  mocks.init.mockClear();
});

async function loadParser() {
  return import("../src/parser/pdfParser");
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
    mocks.init.mockRejectedValueOnce(new Error("wasm boom"));
    const { ensureParserReady } = await loadParser();
    const { PdfParseError } = await import("../src/parser/types");

    const firstAttempt = ensureParserReady();
    await expect(firstAttempt).rejects.toBeInstanceOf(PdfParseError);
    await expect(firstAttempt).rejects.toThrow("The PDF parser failed to start: wasm boom");
    await expect(ensureParserReady()).resolves.toBe("1.0.0-test");
  });

  it("loads the parser runtime once and reports its version", async () => {
    const { ensureParserReady } = await loadParser();

    await expect(ensureParserReady()).resolves.toBe("1.0.0-test");
    expect(mocks.init).toHaveBeenCalledOnce();
  });
});

describe("parsePdf", () => {
  it("turns extracted markdown into a typed document", async () => {
    mocks.processPdf.mockReturnValue(processResult());
    const { parsePdf } = await loadParser();

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
    expect(mocks.processPdf).toHaveBeenCalledWith(expect.any(Uint8Array), {
      includePageMarkers: true,
      profile: "fidelity",
    });
    expect(document.root.children[0]).toMatchObject({ kind: "section", label: "Title" });
  });

  it("falls back to the file name when extraction has no title", async () => {
    mocks.processPdf.mockReturnValue(processResult({ title: undefined }));
    const { parsePdf } = await loadParser();

    const document = await parsePdf(pdfFile());
    expect(document.root.label).toBe("case.pdf");
  });

  it("rejects scanned image-only PDFs with an OCR hint", async () => {
    mocks.processPdf.mockReturnValue(
      processResult({ markdown: "", pdfType: "ImageBased", pageCount: 0 }),
    );
    const { parsePdf } = await loadParser();

    await expect(parsePdf(pdfFile())).rejects.toThrow(
      "This looks like a scanned image-only PDF. OCR is required before it can be digested.",
    );
  });

  it("rejects PDFs with no extractable text", async () => {
    mocks.processPdf.mockReturnValue(
      processResult({ markdown: "", pdfType: "TextBased", pageCount: 5 }),
    );
    const { parsePdf } = await loadParser();

    await expect(parsePdf(pdfFile())).rejects.toThrow("No text could be extracted from this PDF.");
  });

  it("wraps extraction failures in a PdfParseError", async () => {
    mocks.processPdf.mockImplementation(() => {
      throw new Error("extraction exploded");
    });
    const { parsePdf } = await loadParser();

    await expect(parsePdf(pdfFile())).rejects.toThrow("extraction exploded");
    await expect(parsePdf(pdfFile())).rejects.toBeInstanceOf(
      (await import("../src/parser/types")).PdfParseError,
    );
  });

  it("honors the compact profile option", async () => {
    mocks.processPdf.mockReturnValue(processResult());
    const { parsePdf } = await loadParser();

    await parsePdf(pdfFile(), { profile: "compact" });
    expect(mocks.processPdf).toHaveBeenCalledWith(expect.any(Uint8Array), {
      includePageMarkers: true,
      profile: "compact",
    });
  });
});

describe("isPdfFile", () => {
  it("accepts files by name or mime type", async () => {
    const { isPdfFile } = await loadParser();

    expect(isPdfFile(new File([], "brief.pdf"))).toBe(true);
    expect(isPdfFile(new File([], "BRIEF.PDF"))).toBe(true);
    expect(isPdfFile(new File([], "memo", { type: "application/pdf" }))).toBe(true);
  });

  it("rejects non-pdf files", async () => {
    const { isPdfFile } = await loadParser();

    expect(isPdfFile(new File([], "brief.txt"))).toBe(false);
    expect(isPdfFile(new File([], "brief.pdf.txt"))).toBe(false);
    expect(isPdfFile(new File([], "memo", { type: "text/plain" }))).toBe(false);
  });
});
