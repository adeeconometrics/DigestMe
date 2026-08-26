/**
 * pdf-inspector stage of headless mode.
 *
 * Reads one case PDF, extracts structured markdown with the pdf-inspector WASM
 * runtime, maps it onto the context tree, and writes both artifacts to disk.
 * Mirrors the guards in src/parser/pdfParser.ts so scanned or empty PDFs fail
 * loudly instead of producing an empty digest.
 *
 * Usage: tsx pdf-inspector.ts <input.pdf> <output.md> <output.tree.json>
 */
import { initSync, processPdf, version } from "@firecrawl/pdf-inspector-wasm";
import type { PdfProcessResult } from "@firecrawl/pdf-inspector-wasm";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { buildContextTree, flattenTree } from "../../parser/contextTree";

function fail(message: string, exitCode = 1): never {
  console.error(`pdf-inspector: ${message}`);
  process.exit(exitCode);
}

function main(): void {
  const [inputPath, outputMdPath, outputTreePath] = process.argv.slice(2);
  if (!inputPath || !outputMdPath || !outputTreePath) {
    fail("usage: pdf-inspector.ts <input.pdf> <output.md> <output.tree.json>", 2);
  }

  // The browser build fetches the wasm bundle; node's fetch cannot read file:
  // URLs, so load the bytes directly with initSync.
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm");
  initSync({ module: new Uint8Array(readFileSync(wasmPath)) });

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(inputPath));
  } catch {
    fail(`could not read ${inputPath}`, 2);
    return;
  }

  let result: PdfProcessResult;
  try {
    result = processPdf(bytes, { includePageMarkers: true, profile: "fidelity" });
  } catch (error) {
    fail(error instanceof Error ? error.message : "this PDF could not be parsed");
    return;
  }

  const { markdown, pageCount, pdfType, title } = result;
  const encryptedLike = !markdown && pdfType === "ImageBased";
  if (!markdown || encryptedLike || !pageCount) {
    fail(
      pdfType === "ImageBased"
        ? "this looks like a scanned image-only PDF; OCR is required before it can be digested"
        : "no text could be extracted from this PDF",
    );
  }

  const root = buildContextTree(markdown, title ?? basename(inputPath));
  writeFileSync(outputMdPath, markdown);
  writeFileSync(outputTreePath, JSON.stringify(root, null, 2));

  console.log(
    JSON.stringify({
      parserVersion: version(),
      pdfType,
      pageCount,
      title: root.label,
      treeNodes: flattenTree(root).length,
    }),
  );
}

main();
