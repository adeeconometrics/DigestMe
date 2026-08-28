import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Packer, type Document } from "docx";
import {
  commentaryDigestJsonToDocx,
  createCommentaryDigestDocument,
  parseCommentaryDigestJson,
  renderCommentaryDigestDocx,
} from "../src/lib/commentaryDigestDocx";
import type { WireValue } from "../src/types";
import { buildCommentaryDigest } from "./factories";
import rawMockJson from "./fixtures/commentary-digest.mock.json";

// The fixture JSON is the single source of the typed mock; parsing it here
// type-checks it and fails the suite loudly if the fixture ever goes stale.
const COMMENTARY_DIGEST_MOCK = parseCommentaryDigestJson(rawMockJson);

/** Serialize a typed digest to the untyped wire shape the parser consumes. */
function wire<T>(value: T): WireValue {
  return JSON.parse(JSON.stringify(value));
}

// Section headings render uppercase (headingParagraph calls toUpperCase()).
const SECTION_HEADINGS = [
  "DETAILS",
  "SUMMARY",
  "RULE",
  "ELEMENTS",
  "EXCEPTIONS",
  "DEFINITIONS",
  "CASE",
  "CITATION",
  "DOCTRINE",
  "IMPLEMENTING RULES",
  "RELATED PROVISIONS",
  "LEGISLATIVE HISTORY",
  "DEBATES",
  "PRACTICE POINTERS",
  "ILLUSTRATIONS",
  "STUDY NOTES",
];

/** Unzips a generated document and returns its key XML parts as strings. */
async function unzipDocument(document: Document) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  const read = (name: string): Promise<string> =>
    zip.file(name)?.async("string") ?? Promise.resolve("");
  return {
    document: await read("word/document.xml"),
    core: await read("docProps/core.xml"),
    header: await read("word/header1.xml"),
    footer: await read("word/footer1.xml"),
  };
}

describe("parseCommentaryDigestJson", () => {
  it("accepts a valid digest object and preserves every field", () => {
    const digest = buildCommentaryDigest();
    expect(parseCommentaryDigestJson(wire(digest))).toEqual(digest);
  });

  it("accepts the same digest as a JSON string", () => {
    const digest = buildCommentaryDigest();
    expect(parseCommentaryDigestJson(JSON.stringify(digest))).toEqual(digest);
  });

  it("parses the fixture into the complete invented digest", () => {
    const digest = parseCommentaryDigestJson(rawMockJson);

    expect(digest.source_title).toBe("Philippine Corporate Law, Villanueva, 2019 ed.");
    expect(digest.chapter_title).toBe("Board of Directors");
    expect(digest.elements).toHaveLength(3);
    expect(digest.cases).toHaveLength(2);
    expect(digest.cases[0].citation).toBe("G.R. No. 123456, January 15, 2001");
    expect(digest.study_notes).toHaveLength(2);
  });

  it("normalizes null fields emitted by Pydantic", () => {
    const digest = JSON.parse(
      JSON.stringify({
        ...buildCommentaryDigest(),
        elements: null,
        cases: [{ case_name: "A v. B", citation: null, doctrine: "Doctrine." }],
      }),
    );

    const parsed = parseCommentaryDigestJson(digest);
    expect(parsed.elements).toEqual([]);
    expect(parsed.cases).toEqual([{ case_name: "A v. B", citation: "", doctrine: "Doctrine." }]);
  });

  it("normalizes a digest with unsupported elements missing", () => {
    const digest: Record<string, WireValue> = JSON.parse(JSON.stringify(buildCommentaryDigest()));
    delete digest.summary;
    digest.elements = null;
    digest.cases = null;

    const parsed = parseCommentaryDigestJson(digest);
    expect(parsed.summary).toBe("");
    expect(parsed.elements).toEqual([]);
    expect(parsed.cases).toEqual([]);
  });

  it("drops unknown keys instead of persisting them", () => {
    const digest = wire({ ...buildCommentaryDigest(), volume: "not a model key" });
    expect(parseCommentaryDigestJson(digest)).toEqual(buildCommentaryDigest());
  });

  it("throws when the input is not an object", () => {
    expect(() => parseCommentaryDigestJson(null)).toThrow(
      "Expected commentary-digest JSON to be an object.",
    );
  });

  it("throws on invalid JSON strings", () => {
    expect(() => parseCommentaryDigestJson("{not json")).toThrow(SyntaxError);
  });

  it("normalizes a completely empty digest", () => {
    expect(parseCommentaryDigestJson({})).toEqual({
      source_title: "",
      chapter_title: "",
      sections_covered: "",
      subject: "",
      summary: "",
      rule: "",
      elements: [],
      exceptions: [],
      definitions: [],
      cases: [],
      implementing_rules: [],
      related_provisions: [],
      legislative_history: "",
      debates: [],
      practice_pointers: [],
      illustrations: [],
      study_notes: [],
    });
  });

  it("throws when a required field has the wrong type", () => {
    const digest = wire({ ...buildCommentaryDigest(), rule: 42 });
    expect(() => parseCommentaryDigestJson(digest)).toThrow("Expected rule to be a string.");
  });

  it("throws when cases is not an array", () => {
    expect(() => parseCommentaryDigestJson(wire({ ...buildCommentaryDigest(), cases: {} }))).toThrow(
      "Expected cases to be an array.",
    );
  });

  it("throws when a case is not an object", () => {
    const digest = wire(buildCommentaryDigest({ cases: [JSON.parse(JSON.stringify(["not an object"]))] }));
    expect(() => parseCommentaryDigestJson(digest)).toThrow("Expected cases[0] to be an object.");
  });

  it("throws when a case field has the wrong type", () => {
    const badCase = JSON.parse(JSON.stringify({ case_name: "A v. B", citation: 42, doctrine: "Doctrine." }));
    expect(() => parseCommentaryDigestJson(wire(buildCommentaryDigest({ cases: [badCase] })))).toThrow(
      "Expected cases[0].citation to be a string.",
    );
  });
});

describe("createCommentaryDigestDocument", () => {
  it("renders every section of the commentary digest template", async () => {
    const { document } = await unzipDocument(createCommentaryDigestDocument(COMMENTARY_DIGEST_MOCK));
    for (const heading of SECTION_HEADINGS) {
      expect(document).toContain(heading);
    }
  });

  it("renders a minimal digest with missing elements without crashing", async () => {
    const { document } = await unzipDocument(createCommentaryDigestDocument(parseCommentaryDigestJson({})));
    for (const heading of SECTION_HEADINGS) {
      expect(document).toContain(heading);
    }
  });

  it("renders one table per section, separated by spacer paragraphs", async () => {
    const { document } = await unzipDocument(createCommentaryDigestDocument(COMMENTARY_DIGEST_MOCK));
    const tableCount = document.split("</w:tbl>").length - 1;
    expect(tableCount).toBe(12);
    expect(document.split("</w:tbl><w:p/>").length - 1).toBe(11);
  });

  it("renders one row per cited case in the jurisprudence table", async () => {
    const { document } = await unzipDocument(createCommentaryDigestDocument(COMMENTARY_DIGEST_MOCK));
    expect(document).toContain("Villanueva v. Bayside Port Workers Cooperative");
    expect(document).toContain("People v. Santos");
  });

  it("writes the chapter title and default creator into the core properties", async () => {
    const { core } = await unzipDocument(createCommentaryDigestDocument(COMMENTARY_DIGEST_MOCK));
    expect(core).toContain(COMMENTARY_DIGEST_MOCK.chapter_title);
    expect(core).toContain("Digest Me");
  });

  it("falls back to the source title when the chapter title is missing", async () => {
    const digest = buildCommentaryDigest({ chapter_title: "" });
    const { core } = await unzipDocument(createCommentaryDigestDocument(digest));
    expect(core).toContain(digest.source_title);
  });

  it("applies custom creator, header, and footer options", async () => {
    const { core, header, footer } = await unzipDocument(
      createCommentaryDigestDocument(COMMENTARY_DIGEST_MOCK, {
        creator: "Audit Team",
        headerText: "Internal draft",
        footerText: "Page footer",
      }),
    );
    expect(core).toContain("Audit Team");
    expect(header).toContain("Internal draft");
    expect(footer).toContain("Page footer");
  });
});

describe("docx packing", () => {
  it("renderCommentaryDigestDocx returns a non-empty docx blob", async () => {
    const blob = await renderCommentaryDigestDocx(COMMENTARY_DIGEST_MOCK);
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toContain("wordprocessingml");
  });

  it("commentaryDigestJsonToDocx parses raw JSON and packs it in one step", async () => {
    const blob = await commentaryDigestJsonToDocx(JSON.stringify(COMMENTARY_DIGEST_MOCK));
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("commentaryDigestJsonToDocx rejects invalid JSON before packing", () => {
    expect(() => commentaryDigestJsonToDocx(null)).toThrow(
      "Expected commentary-digest JSON to be an object.",
    );
  });
});
