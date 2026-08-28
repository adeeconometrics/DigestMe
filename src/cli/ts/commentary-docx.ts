/**
 * tsx-commentary-docx stage of headless mode.
 *
 * Reads a commentary-digest JSON artifact, normalizes it through the shared
 * commentary DOCX renderer, and writes the packed document to disk. Reuses
 * the exact renderer the browser would download, so headless output matches
 * the UI byte for byte.
 *
 * Usage: tsx commentary-docx.ts <digest.json> <output.docx>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { commentaryDigestJsonToDocx } from "../../lib/commentaryDigestDocx";
import type { WireValue } from "../../types";

function fail(message: string, exitCode = 1): never {
  console.error(`tsx-commentary-docx: ${message}`);
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const [inputJsonPath, outputDocxPath] = process.argv.slice(2);
  if (!inputJsonPath || !outputDocxPath) {
    fail("usage: commentary-docx.ts <digest.json> <output.docx>", 2);
  }

  let wire: WireValue;
  try {
    wire = JSON.parse(readFileSync(inputJsonPath, "utf8")) as WireValue;
  } catch (error) {
    fail(`could not read digest JSON ${inputJsonPath}: ${error instanceof Error ? error.message : "unknown error"}`, 2);
  }

  const blob = await commentaryDigestJsonToDocx(wire);
  const buffer = Buffer.from(await blob.arrayBuffer());
  writeFileSync(outputDocxPath, buffer);
  console.log(JSON.stringify({ bytes: buffer.length }));
}

void main();
