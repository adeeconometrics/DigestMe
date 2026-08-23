import { describe, expect, it } from "vitest";
import { retrieveNodes } from "../src/chat/retrieval";
import { buildBlock, buildDocumentNode, buildSection } from "./factories";

function sampleTree() {
  return buildDocumentNode({
    children: [
      buildSection("s1", "Facts", [
        buildBlock("b1", "The suspect stole the painting at midnight.", { section: "Facts" }),
        buildBlock("b2", "The security camera caught the whole event.", { section: "Facts" }),
      ]),
      buildSection("s2", "Ruling", [
        buildBlock("b3", "The suspect was convicted of theft.", { section: "Ruling" }),
      ]),
    ],
  });
}

describe("retrieveNodes", () => {
  it("ranks the block containing the query terms first", () => {
    const hits = retrieveNodes(sampleTree(), "stole painting");

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      nodeId: "b1",
      score: 19,
      section: "Facts",
      page: null,
    });
    expect(hits[0].snippet).toBe("The suspect stole the painting at midnight.");
  });

  it("boosts exact adjacent phrases above token overlap", () => {
    const hits = retrieveNodes(sampleTree(), "suspect stole");

    expect(hits[0]).toMatchObject({ nodeId: "b1", score: 33 });
    expect(hits[1]).toMatchObject({ nodeId: "b3", score: 7 });
  });

  it("finds sections by name through the section path at half weight", () => {
    const hits = retrieveNodes(sampleTree(), "Facts");

    expect(hits[0]).toMatchObject({ nodeId: "s1", score: 18 });
    expect(hits.slice(1).map((hit) => hit.nodeId)).toEqual(["b1", "b2"]);
    expect(hits.slice(1).every((hit) => hit.score === 3)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const hits = retrieveNodes(sampleTree(), "STOLE");

    expect(hits[0].nodeId).toBe("b1");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("deduplicates repeated query terms", () => {
    const hits = retrieveNodes(sampleTree(), "stole stole painting");

    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBe(19);
  });

  it("respects the limit", () => {
    expect(retrieveNodes(sampleTree(), "the suspect", 1)).toHaveLength(1);
  });

  it("returns an empty list for queries with no meaningful tokens", () => {
    expect(retrieveNodes(sampleTree(), "")).toEqual([]);
    expect(retrieveNodes(sampleTree(), "ab")).toEqual([]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(retrieveNodes(sampleTree(), "zebra unicorn")).toEqual([]);
  });

  it("never surfaces the document root node", () => {
    const hits = retrieveNodes(sampleTree(), "document");

    expect(hits.map((hit) => hit.nodeId)).not.toContain("n0");
  });

  it("truncates long snippets to 140 characters", () => {
    const longText = "word ".repeat(30).trim();
    const root = buildDocumentNode({
      children: [
        buildSection("s1", "Section", [buildBlock("b1", longText, { section: "Section" })]),
      ],
    });

    const [hit] = retrieveNodes(root, "word");
    expect(hit.snippet.length).toBe(140);
    expect(hit.snippet.endsWith("…")).toBe(true);
  });

  it("returns hits sorted by descending score", () => {
    const root = buildDocumentNode({
      children: [
        buildSection("s1", "Section", [
          buildBlock("b1", "fizzbuzz alpha beta", { section: "Section" }),
          buildBlock("b2", "alpha", { section: "Section" }),
          buildBlock("b3", "fizzbuzz", { section: "Section" }),
        ]),
      ],
    });

    const hits = retrieveNodes(root, "fizzbuzz alpha");
    const scores = hits.map((hit) => hit.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(hits[0].nodeId).toBe("b1");
  });
});
