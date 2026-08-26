/**
 * tsx-docx stage of headless mode.
 *
 * Reads a case-digest JSON artifact, normalizes it through the shared DOCX
 * renderer, and writes the packed document to disk. Reuses the exact renderer
 * the browser downloads, so headless output matches the UI byte for byte.
 *
 * Usage: tsx docx.ts <digest.json> <output.docx>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { caseDigestJsonToDocx } from "../../lib/caseDigestDocx";
import type { WireValue } from "../../types";

function fail(message: string, exitCode = 1): never {
  console.error(`tsx-docx: ${message}`);
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const [inputJsonPath, outputDocxPath] = process.argv.slice(2);
  if (!inputJsonPath || !outputDocxPath) {
    fail("usage: docx.ts <digest.json> <output.docx>", 2);
  }

  let wire: WireValue;
  try {
    wire = JSON.parse(readFileSync(inputJsonPath, "utf8")) as WireValue;
  } catch (error) {
    fail(`could not read digest JSON ${inputJsonPath}: ${error instanceof Error ? error.message : "unknown error"}`, 2);
  }
  // SAFETY: parseCaseDigestJson re-validates every field at runtime and
  // raises TypeError for malformed input, so the cast is a typed boundary.

  const blob = await caseDigestJsonToDocx(wire);
  const buffer = Buffer.from(await blob.arrayBuffer());
  writeFileSync(outputDocxPath, buffer);
  console.log(JSON.stringify({ bytes: buffer.length }));
}

void main();
