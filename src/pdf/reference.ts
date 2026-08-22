import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import * as pdfjs from "pdfjs-dist";
import type { DocumentNode } from "../parser";

export interface ReferenceBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface IndexedTextItem {
  str: string;
  /** Start/end offsets of this item inside the normalized page text. */
  start: number;
  end: number;
  box: ReferenceBox;
}

export interface PageTextIndex {
  pageNumber: number;
  text: string;
  items: IndexedTextItem[];
}

/** Lowercases and collapses all whitespace so markdown/PDF spacing mismatches vanish. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Indexes a page's text items with their scale-1 viewport bounding boxes
 * (PDF points, y-down) so snippets from the parsed tree can be located.
 */
export async function indexPageText(page: PDFPageProxy): Promise<PageTextIndex> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: IndexedTextItem[] = [];
  let normalized = "";

  for (const item of content.items) {
    if (!("str" in item)) continue;
    if (!item.str) continue;

    // Standard pdf.js transform math: map the item's baseline into viewport space.
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const box: ReferenceBox = {
      left: tx[4],
      top: tx[5] - fontHeight,
      width: item.width,
      height: fontHeight,
    };

    const piece = normalize(item.str);
    if (!piece) continue;
    items.push({ str: piece, start: normalized.length, end: normalized.length + piece.length, box });
    normalized = `${normalized}${normalized ? " " : ""}${piece}`;
  }

  return { pageNumber: page.pageNumber, text: normalized, items };
}

/** Union of boxes covering the given character range. */
function unionBox(items: IndexedTextItem[], start: number, end: number): ReferenceBox | null {
  let box: ReferenceBox | null = null;
  for (const item of items) {
    if (item.end <= start || item.start >= end) continue;
    box = box
      ? {
          left: Math.min(box.left, item.box.left),
          top: Math.min(box.top, item.box.top),
          width: Math.max(box.left + box.width, item.box.left + item.box.width) - Math.min(box.left, item.box.left),
          height: Math.max(box.top + box.height, item.box.top + item.box.height) - Math.min(box.top, item.box.top),
        }
      : { ...item.box };
  }
  return box;
}

/**
 * Finds where a tree node's content lives on its page.
 *
 * Falls back from the full snippet to progressively shorter prefixes so
 * truncated labels still land on their source region.
 */
export function locateReference(index: PageTextIndex, node: DocumentNode): { pageNumber: number; box: ReferenceBox } | null {
  const raw = (node.text ?? node.label ?? "").trim();
  if (!raw) return null;

  const query = normalize(raw);
  for (const length of [Math.min(query.length, 140), 60, 32]) {
    const candidate = query.slice(0, length);
    if (candidate.length < 8) break;
    const at = index.text.indexOf(candidate);
    if (at >= 0) {
      const box = unionBox(index.items, at, at + candidate.length);
      if (box) return { pageNumber: index.pageNumber, box };
    }
  }

  // Last resort: match a rare-word subset of the snippet.
  const words = query.split(" ").filter((word) => word.length > 4).slice(0, 6);
  if (words.length >= 2) {
    const at = index.text.indexOf(words.join(" "));
    if (at >= 0) {
      const box = unionBox(index.items, at, at + words.join(" ").length);
      if (box) return { pageNumber: index.pageNumber, box };
    }
  }

  return null;
}

/** Convenience wrapper: fetch a page and index its text layout in one step. */
export async function indexDocumentPage(doc: PDFDocumentProxy, pageNumber: number): Promise<PageTextIndex | null> {
  const clamped = Math.min(Math.max(pageNumber, 1), doc.numPages);
  if (pageNumber < 1 || pageNumber > doc.numPages) return null;
  return indexPageText(await doc.getPage(clamped));
}
