import { describe, expect, it } from "vitest";
import { caseDigestToMarkdown } from "../src/lib/caseDigestMarkdown";
import { parseCaseDigestJson } from "../src/lib/caseDigestDocx";
import rawMockJson from "./fixtures/case-digest.mock.json";

describe("caseDigestToMarkdown", () => {
  it("renders every digest section as readable markdown", () => {
    const markdown = caseDigestToMarkdown(parseCaseDigestJson(rawMockJson));

    expect(markdown).toContain("# Villanueva v. Bayside Port Workers Cooperative");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Issues");
    expect(markdown).toContain("### Issue 1");
    expect(markdown).toContain("## Class Notes");
    expect(markdown).not.toContain("undefined");
  });

  it("turns a source URL into a markdown link", () => {
    const digest = parseCaseDigestJson({ ...rawMockJson, full_text: "https://example.test/decision" });

    expect(caseDigestToMarkdown(digest)).toContain("[Open the complete decision](https://example.test/decision)");
  });

  it("renders fallbacks when the source does not support digest elements", () => {
    const markdown = caseDigestToMarkdown(parseCaseDigestJson({}));

    expect(markdown).toContain("_Not stated._");
    expect(markdown).toContain("_No separate issues were identified._");
    expect(markdown).not.toContain("undefined");
  });
});
