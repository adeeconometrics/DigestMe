import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Packer, type Document } from "docx";
import {
  caseDigestJsonToDocx,
  createCaseDigestDocument,
  parseCaseDigestJson,
  renderCaseDigestDocx,
} from "../src/lib/caseDigestDocx";
import type { CaseDigestIssueInput } from "../src/lib/caseDigestDocx";
import type { WireValue } from "../src/types";
import { buildCaseDigest, buildFacts, buildIssue, buildIssuePair } from "./factories";
import rawMockJson from "./fixtures/case-digest.mock.json";

// The fixture JSON is the single source of the typed mock; parsing it here
// type-checks it and fails the suite loudly if the fixture ever goes stale.
const CASE_DIGEST_MOCK = parseCaseDigestJson(rawMockJson);

// Section headings render uppercase (headingParagraph calls toUpperCase()).
const SECTION_HEADINGS = [
  "DETAILS",
  "SUMMARY",
  "DOCTRINE",
  "PROVISION/S",
  "FACTS",
  "PETITIONER",
  "RESPONDENT",
  "PROCEDURAL POSTURE",
  "ISSUE/S",
  "SUPREME COURT RULING",
  "CLASS NOTES",
];

/** Unzips a generated document and returns its key XML parts as strings. */
async function unzipDocument(document: Document) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  const read = (name: string): Promise<string> =>
    zip.file(name)?.async("string") ?? Promise.resolve("");
  return {
    document: await read("word/document.xml"),
    core: await read("docProps/core.xml"),
    rels: await read("word/_rels/document.xml.rels"),
    header: await read("word/header1.xml"),
    footer: await read("word/footer1.xml"),
  };
}

describe("parseCaseDigestJson", () => {
  it("accepts a valid digest object and preserves every field", () => {
    const digest = buildCaseDigest();
    expect(parseCaseDigestJson(digest)).toEqual(digest);
  });

  it("accepts the same digest as a JSON string", () => {
    const digest = buildCaseDigest();
    expect(parseCaseDigestJson(JSON.stringify(digest))).toEqual(digest);
  });

  it("parses the fixture into the complete invented digest", () => {
    const digest = parseCaseDigestJson(rawMockJson);

    expect(digest.case_title).toBe("Villanueva v. Bayside Port Workers Cooperative");
    expect(digest.petitioner).toBe("Ramon Villanueva, Jr.");
    expect(digest.facts.petition).toHaveLength(4);
    expect(digest.issues).toHaveLength(4);
    expect(digest.class_notes).toHaveLength(2);
  });

  it("accepts issues in the short [ruling, ratio] pair form", () => {
    const digest = buildCaseDigest({ issues: [buildIssuePair(), buildIssuePair("NO", "No basis.")] });
    expect(parseCaseDigestJson(digest).issues).toEqual([
      ["YES", "Because of the doctrine."],
      ["NO", "No basis."],
    ]);
  });

  it("preserves the optional issue statement on object-form issues", () => {
    const digest = buildCaseDigest({ issues: [buildIssue({ issue: "WON procedure was followed." })] });
    expect(parseCaseDigestJson(digest).issues).toEqual([
      { issue: "WON procedure was followed.", ruling: "YES", ratio: "Because of the doctrine." },
    ]);
  });

  it("preserves optional petitioner and respondent fact versions", () => {
    const digest = buildCaseDigest({
      facts: buildFacts({ respondent_version: ["Their version."] }),
    });
    expect(parseCaseDigestJson(digest).facts.respondent_version).toEqual(["Their version."]);
  });

  it("accepts null optional fields emitted by Pydantic", () => {
    const digest = JSON.parse(
      JSON.stringify({
        ...buildCaseDigest(),
        facts: { petition: ["Petition fact."], petitioner_version: null, respondent_version: null },
        issues: [{ issue: null, ruling: "YES", ratio: "Because." }],
      }),
    );

    const parsed = parseCaseDigestJson(digest);
    expect(parsed.facts).toEqual({ petition: ["Petition fact."] });
    expect(parsed.issues).toEqual([{ ruling: "YES", ratio: "Because." }]);
  });

  it("throws when the input is not an object", () => {
    expect(() => parseCaseDigestJson(null)).toThrow("Expected case-digest JSON to be an object.");
  });

  it("throws on invalid JSON strings", () => {
    expect(() => parseCaseDigestJson("{not json")).toThrow(SyntaxError);
  });

  it.each(["case_title", "petitioner", "respondent", "subject", "ponente", "gr_no_date"])(
    "throws with a field path when %s is missing",
    (field) => {
      const digest: Record<string, WireValue> = JSON.parse(JSON.stringify(buildCaseDigest()));
      delete digest[field];
      expect(() => parseCaseDigestJson(digest)).toThrow(`Expected ${field} to be a string.`);
    },
  );

  it("throws when a required field has the wrong type", () => {
    const digest = { ...buildCaseDigest(), petitioner: 42 };
    expect(() => parseCaseDigestJson(digest)).toThrow("Expected petitioner to be a string.");
  });

  it("throws when facts is not an object", () => {
    expect(() => parseCaseDigestJson({ ...buildCaseDigest(), facts: [] })).toThrow(
      "Expected facts to be an object.",
    );
  });

  it("throws when facts.petition is not an array of strings", () => {
    const digest = buildCaseDigest({
      facts: buildFacts({ petition: JSON.parse(JSON.stringify(["ok", 7])) }),
    });
    expect(() => parseCaseDigestJson(digest)).toThrow(
      "Expected facts.petition to be an array of strings.",
    );
  });

  it("throws when an issue pair has the wrong arity", () => {
    const digest = buildCaseDigest({ issues: [JSON.parse(JSON.stringify(["YES"]))] });
    expect(() => parseCaseDigestJson(digest)).toThrow(
      "Expected issues[0] to be a [ruling, ratio] string pair.",
    );
  });

  it("throws when an issue object is missing its ruling", () => {
    const issueWithoutRuling: CaseDigestIssueInput = JSON.parse(JSON.stringify({ ratio: "Because." }));
    expect(() => parseCaseDigestJson(buildCaseDigest({ issues: [issueWithoutRuling] }))).toThrow(
      "Expected issues[0].ruling to be a string.",
    );
  });
});

describe("createCaseDigestDocument", () => {
  it("renders every section of the digest template", async () => {
    const { document } = await unzipDocument(createCaseDigestDocument(CASE_DIGEST_MOCK));
    for (const heading of SECTION_HEADINGS) {
      expect(document).toContain(heading);
    }
  });

  it("renders one table per section, separated by spacer paragraphs", async () => {
    const { document } = await unzipDocument(createCaseDigestDocument(CASE_DIGEST_MOCK));
    const tableCount = document.split("</w:tbl>").length - 1;
    expect(tableCount).toBe(9);
    expect(document.split("</w:tbl><w:p/>").length - 1).toBe(8);
  });

  it("writes the case title and default creator into the core properties", async () => {
    const { core } = await unzipDocument(createCaseDigestDocument(CASE_DIGEST_MOCK));
    expect(core).toContain(CASE_DIGEST_MOCK.case_title);
    expect(core).toContain("Digest Me");
  });

  it("applies custom creator, header, and footer options", async () => {
    const { core, header, footer } = await unzipDocument(
      createCaseDigestDocument(CASE_DIGEST_MOCK, {
        creator: "Audit Team",
        headerText: "Internal draft",
        footerText: "Page footer",
      }),
    );
    expect(core).toContain("Audit Team");
    expect(header).toContain("Internal draft");
    expect(footer).toContain("Page footer");
  });

  it("renders a URL full_text as a live hyperlink", async () => {
    const digest = buildCaseDigest({ full_text: "https://example.com/full.pdf" });
    const { document, rels } = await unzipDocument(createCaseDigestDocument(digest));
    expect(document).toContain("w:hyperlink");
    expect(rels).toContain("https://example.com/full.pdf");
  });

  it("renders plain full_text as paragraphs instead of a hyperlink", async () => {
    const { document, rels } = await unzipDocument(
      createCaseDigestDocument(buildCaseDigest({ full_text: "Plain text." })),
    );
    expect(document).not.toContain("w:hyperlink");
    expect(rels).not.toContain("https://");
  });
});

describe("docx packing", () => {
  it("renderCaseDigestDocx returns a non-empty docx blob", async () => {
    const blob = await renderCaseDigestDocx(CASE_DIGEST_MOCK);
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toContain("wordprocessingml");
  });

  it("caseDigestJsonToDocx parses raw JSON and packs it in one step", async () => {
    const blob = await caseDigestJsonToDocx(JSON.stringify(CASE_DIGEST_MOCK));
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("caseDigestJsonToDocx rejects invalid JSON before packing", () => {
    expect(() => caseDigestJsonToDocx(null)).toThrow(
      "Expected case-digest JSON to be an object.",
    );
  });
});
