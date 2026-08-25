import { describe, expect, it } from "vitest";
import Graph from "graphology";
import { EDGE_TRACE, NODE_COLORS, pathToNode, pathsToNodes, treeToGraph } from "../src/graph/treeGraph";
import { buildBlock, buildDocumentNode, buildSection } from "./factories";

function sampleTree() {
  return buildDocumentNode({
    children: [
      buildSection("s1", "Facts", [
        buildBlock("b1", "Fact one", { section: "Facts" }),
        buildBlock("b2", "Fact two", { section: "Facts" }),
      ]),
      buildSection("s2", "Ruling", [buildBlock("b3", "Ruled", { section: "Ruling" })]),
    ],
  });
}

describe("treeToGraph", () => {
  it("creates one node per tree node and one edge per parent-child pair", () => {
    const graph = treeToGraph(sampleTree());

    expect(graph.order).toBe(6);
    expect(graph.size).toBe(5);
  });

  it("seeds nodes with deterministic ring positions", () => {
    const graph = treeToGraph(sampleTree());

    const root = graph.getNodeAttributes("n0");
    expect(root.x).toBe(0);
    expect(root.y).toBe(0);

    const firstSection = graph.getNodeAttributes("s1");
    const angle = (1 * 137.5 * Math.PI) / 180;
    const radius = 8.5;
    expect(firstSection.x).toBeCloseTo(radius * Math.cos(angle), 10);
    expect(firstSection.y).toBeCloseTo(radius * Math.sin(angle), 10);
  });

  it("styles nodes and edges by kind", () => {
    const graph = treeToGraph(sampleTree());

    expect(graph.getNodeAttributes("n0")).toMatchObject({
      kind: "document",
      size: 14,
      color: NODE_COLORS.document,
    });
    expect(graph.getNodeAttributes("s1")).toMatchObject({
      kind: "section",
      size: 8,
      color: NODE_COLORS.section,
    });
    expect(graph.getNodeAttributes("b1")).toMatchObject({
      kind: "block",
      size: 4,
      color: NODE_COLORS.block,
      section: "Facts",
      page: null,
    });
    expect(graph.getEdgeAttributes(graph.edges("n0", "s1")[0]).color).toBe("#1d3432");
  });

  it("produces identical layouts for the same tree", () => {
    const first = treeToGraph(sampleTree());
    const second = treeToGraph(sampleTree());

    for (const node of first.nodes()) {
      expect(second.getNodeAttributes(node)).toEqual(first.getNodeAttributes(node));
    }
  });

  it("returns a graphology graph", () => {
    expect(treeToGraph(sampleTree())).toBeInstanceOf(Graph);
  });
});

describe("pathToNode", () => {
  it("returns the ancestor chain from the root to the node", () => {
    const root = sampleTree();

    expect(pathToNode(root, "b1")).toEqual(["n0", "s1", "b1"]);
    expect(pathToNode(root, "s2")).toEqual(["n0", "s2"]);
    expect(pathToNode(root, "n0")).toEqual(["n0"]);
  });

  it("returns null for ids outside the tree", () => {
    expect(pathToNode(sampleTree(), "missing")).toBeNull();
  });
});

describe("pathsToNodes", () => {
  it("unions the root-to-node chains of every requested id", () => {
    const root = sampleTree();

    expect(pathsToNodes(root, ["b1", "b3"])).toEqual(new Set(["n0", "s1", "b1", "s2", "b3"]));
  });

  it("deduplicates overlapping chains", () => {
    const root = sampleTree();

    expect(pathsToNodes(root, ["b1", "b2"])).toEqual(new Set(["n0", "s1", "b1", "b2"]));
  });

  it("keeps only the document root when the root itself is requested", () => {
    expect(pathsToNodes(sampleTree(), ["n0"])).toEqual(new Set(["n0"]));
  });

  it("skips ids outside the tree", () => {
    const root = sampleTree();

    expect(pathsToNodes(root, ["b1", "missing"])).toEqual(new Set(["n0", "s1", "b1"]));
  });

  it("returns an empty set for no ids or no valid ids", () => {
    const root = sampleTree();

    expect(pathsToNodes(root, [])).toEqual(new Set());
    expect(pathsToNodes(root, ["missing"])).toEqual(new Set());
  });
});

describe("EDGE_TRACE", () => {
  it("declares the directional arrow program for traced edges", () => {
    expect(EDGE_TRACE.type).toBe("arrow");
  });
});
