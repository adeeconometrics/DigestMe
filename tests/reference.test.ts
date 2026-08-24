import { describe, expect, it } from "vitest";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PageTextIndex, ReferenceBox } from "../src/pdf/reference";
import { indexDocumentPage, indexPageText, locateReference } from "../src/pdf/reference";
import { buildBlock } from "./factories";

function mockPage(
  items: Array<{ str: string; transform: number[]; width: number }>,
  pageNumber = 2,
): PDFPageProxy {
  return {
    pageNumber,
    getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0] }),
    getTextContent: async () => ({ items }),
  } as PDFPageProxy;
}

function indexWith(text: string, box: ReferenceBox, pageNumber = 4): PageTextIndex {
  return {
    pageNumber,
    text,
    items: [{ str: text, start: 0, end: text.length, box }],
  };
}

const BOX: ReferenceBox = { left: 10, top: 20, width: 400, height: 12 };

describe("indexPageText", () => {
  it("indexes text items with normalized text and aligned offsets", async () => {
    const index = await indexPageText(
      mockPage([
        { str: "Hello", transform: [1, 0, 0, 1, 10, 20], width: 30 },
        { str: "World", transform: [1, 0, 0, 1, 45, 20], width: 40 },
      ]),
    );

    expect(index.pageNumber).toBe(2);
    expect(index.text).toBe("hello world");
    expect(index.items.map((item) => [item.str, item.start, item.end])).toEqual([
      ["hello", 0, 5],
      ["world", 6, 11],
    ]);
    expect(index.items[0].box).toEqual({ left: 10, top: 19, width: 30, height: 1 });
  });

  it("skips items without text", async () => {
    const index = await indexPageText(
      mockPage([{ str: "Keep", transform: [1, 0, 0, 1, 0, 0], width: 20 }]),
    );

    expect(index.text).toBe("keep");
    expect(index.items).toHaveLength(1);
  });
});

describe("indexDocumentPage", () => {
  function mockDocument(): PDFDocumentProxy {
    return {
      numPages: 5,
      getPage: async (pageNumber: number) =>
        mockPage([{ str: "Hello", transform: [1, 0, 0, 1, 10, 20], width: 30 }], pageNumber),
    } as PDFDocumentProxy;
  }

  it("indexes a requested page", async () => {
    const index = await indexDocumentPage(mockDocument(), 5);

    expect(index?.pageNumber).toBe(5);
    expect(index?.text).toBe("hello");
  });

  it("returns null for out-of-range page numbers", async () => {
    expect(await indexDocumentPage(mockDocument(), 0)).toBeNull();
    expect(await indexDocumentPage(mockDocument(), 6)).toBeNull();
  });
});

describe("locateReference", () => {
  it("locates an exact snippet on its page", () => {
    const node = buildBlock("b1", "The quick brown fox jumps over the lazy dog");
    const result = locateReference(indexWith("the quick brown fox jumps over the lazy dog", BOX), node);

    expect(result).toEqual({ pageNumber: 4, box: BOX });
  });

  it("matches case-insensitively with normalized punctuation", () => {
    const node = buildBlock("b1", "It’s a — dash.");
    const result = locateReference(indexWith("it's a - dash.", BOX), node);

    expect(result).toEqual({ pageNumber: 4, box: BOX });
  });

  it("falls back to a shorter prefix when the full snippet is absent", () => {
    const node = buildBlock("b1", `${"b".repeat(60)}${"d".repeat(80)}tail`);
    const result = locateReference(indexWith(`${"b".repeat(60)}${"c".repeat(100)}`, BOX), node);

    expect(result?.box).toEqual(BOX);
  });

  it("falls back to a distinctive word subset as a last resort", () => {
    const node = buildBlock("b1", "alpha bravo charlie delta echo foxtrot golf");
    const result = locateReference(
      indexWith(`alpha bravo charlie delta echo foxtrot zebra ${"x ".repeat(20)}`, BOX),
      node,
    );

    expect(result?.box).toEqual(BOX);
  });

  it("unions boxes across multiple items for a matched range", () => {
    const index: PageTextIndex = {
      pageNumber: 7,
      text: "the quick brown fox",
      items: [
        { str: "the quick", start: 0, end: 9, box: { left: 10, top: 20, width: 80, height: 12 } },
        { str: "brown fox", start: 10, end: 19, box: { left: 100, top: 20, width: 90, height: 12 } },
      ],
    };
    const node = buildBlock("b1", "the quick brown fox");

    expect(locateReference(index, node)).toEqual({
      pageNumber: 7,
      box: { left: 10, top: 20, width: 180, height: 12 },
    });
  });

  it("returns null when the snippet cannot be found", () => {
    const node = buildBlock("b1", "completely missing text");
    expect(locateReference(indexWith("something else entirely", BOX), node)).toBeNull();
  });

  it("returns null for empty node content", () => {
    expect(locateReference(indexWith("text", BOX), buildBlock("b1", "   "))).toBeNull();
  });
});
