import { describe, expect, it } from "vitest";
import { buildContextTree, flattenTree } from "../src/parser/contextTree";
import { buildBlock, buildDocumentNode, buildSection } from "./factories";

function digestOf(markdown: string, title = "Document") {
  return buildContextTree(markdown, title);
}

describe("buildContextTree", () => {
  it("nests markdown headings into a typed tree", () => {
    const markdown = [
      "# Title",
      "Some body text.",
      "## Section A",
      "Text in A.",
      "### Subsection",
      "Deeper text.",
    ].join("\n");

    expect(digestOf(markdown)).toEqual(
      buildDocumentNode({
        children: [
          buildSection("n1", "Title", [
            buildBlock("n2", "Some body text.", { section: "Title" }),
            buildSection(
              "n3",
              "Section A",
              [
                buildBlock("n4", "Text in A.", { section: "Title › Section A" }),
                buildSection("n5", "Subsection", [
                  buildBlock("n6", "Deeper text.", { section: "Title › Section A › Subsection" }),
                ], { section: "Title › Section A › Subsection" }),
              ],
              { section: "Title › Section A" },
            ),
          ]),
        ],
      }),
    );
  });

  it("tracks the page a section starts on from page markers", () => {
    const markdown = ["# Intro", "intro line", "<!-- Page 3 -->", "## Facts", "fact line"].join("\n");

    const root = digestOf(markdown);
    expect(root.page).toBeNull();

    const intro = root.children[0];
    expect(intro).toMatchObject({ label: "Intro", page: null });
    expect(intro.children[0]).toMatchObject({ label: "intro line", page: null });

    const facts = intro.children[1];
    expect(facts).toMatchObject({ label: "Facts", page: 3 });
    expect(facts.children[0]).toMatchObject({ label: "fact line", page: 3 });
  });

  it("ignores blank lines, horizontal rules, and table dividers", () => {
    const markdown = ["# A", "", "---", "***", "___", "| --- | --- |", "body"].join("\n");

    const root = digestOf(markdown);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children.map((node) => node.label)).toEqual(["body"]);
  });

  it("collapses table rows into single blocks with dot separators", () => {
    const markdown = ["## Parties", "| Plaintiff | Defendant |", "| A | B |"].join("\n");

    const facts = digestOf(markdown).children[0];
    expect(facts.children.map((node) => node.label)).toEqual([
      "· Plaintiff · Defendant ·",
      "· A · B ·",
    ]);
  });

  it("merges wrapped body lines into one leaf block", () => {
    const root = digestOf(["## Facts", "Line one", "Line two"].join("\n"));

    const block = root.children[0].children[0];
    expect(root.children[0].children).toHaveLength(1);
    expect(block.text).toBe("Line one Line two");
  });

  it("keeps table rows as separate blocks instead of merging them", () => {
    const root = digestOf(["## Facts", "Line one", "| A | B |"].join("\n"));

    expect(root.children[0].children.map((node) => node.label)).toEqual(["Line one", "· A · B ·"]);
  });

  it("caps merged text length and truncates long labels", () => {
    const markdown = ["## Facts", "x".repeat(1200), "y".repeat(1600)].join("\n");

    const block = digestOf(markdown).children[0].children[0];
    expect(block.text).toHaveLength(2000);
    expect(block.label.length).toBeLessThanOrEqual(72);
    expect(block.label.endsWith("…")).toBe(true);
  });

  it("strips markdown links, images, emphasis, and stray tags from labels", () => {
    const markdown = [
      "## Read [the brief](https://x.io) *carefully*",
      "![logo](logo.png) <u>underlined</u>",
    ].join("\n");

    const section = digestOf(markdown).children[0];
    expect(section.label).toBe("Read the brief carefully");
    expect(section.children[0].label).toBe("logo underlined");
  });

  it("makes same-depth headings siblings under the root", () => {
    const root = digestOf(["# A", "# C"].join("\n"));

    expect(root.children.map((node) => node.label)).toEqual(["A", "C"]);
  });

  it("reattaches a shallower heading to the correct ancestor", () => {
    const root = digestOf(["# A", "## B", "# C"].join("\n"));

    expect(root.children.map((node) => node.label)).toEqual(["A", "C"]);
    expect(root.children[0].children.map((node) => node.label)).toEqual(["B"]);
  });

  it("uses the supplied root title for the root label and section", () => {
    const root = digestOf("body only", "My Case");

    expect(root.label).toBe("My Case");
    expect(root.section).toBe("My Case");
    expect(root.children[0].section).toBe("My Case");
  });

  it("returns a bare root for empty markdown", () => {
    expect(digestOf("")).toEqual(buildDocumentNode());
    expect(digestOf("   \n\n  ")).toEqual(buildDocumentNode());
  });

  it("produces deterministic ids for the same input", () => {
    const markdown = ["# A", "body", "## B", "more"].join("\n");

    expect(digestOf(markdown)).toEqual(digestOf(markdown));
  });
});

describe("flattenTree", () => {
  it("returns nodes depth-first starting at the root", () => {
    const root = digestOf(["# A", "body", "## B", "more"].join("\n"));

    const ids = flattenTree(root).map((node) => node.id);
    expect(ids).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    expect(flattenTree(root)[0].kind).toBe("document");
  });

  it("counts every node in the tree", () => {
    const root = digestOf(["# A", "body", "## B", "more"].join("\n"));

    expect(flattenTree(root)).toHaveLength(5);
  });
});
