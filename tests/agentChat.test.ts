import { describe, expect, it } from "vitest";
import { formatExecutionTime, formatExecutionTimestamp, mapAgentReferences, referencesForAnswer, executionDescription } from "../src/chat/agentChat";
import type { AgentReference } from "../src/pyodide/types";
import { buildBlock, buildDocumentNode, buildSection } from "./factories";

function sampleTree() {
  return buildDocumentNode({
    children: [
      buildSection("s1", "Facts", [
        buildBlock("b1", "The notice preceded the hearing.", { section: "Facts" }),
      ]),
    ],
  });
}

describe("agentChat helpers", () => {
  it("maps only cited ids that still exist in the current tree", () => {
    const references: AgentReference[] = [
      { nodeId: "b1", kind: "block", label: "stale label", section: "stale", page: 9, snippet: "stale" },
      { nodeId: "n0", kind: "document", label: "root", section: "root", page: null, snippet: "root" },
      { nodeId: "missing", kind: "block", label: "missing", section: "missing", page: null, snippet: "missing" },
    ];

    expect(mapAgentReferences(sampleTree(), references)).toEqual([
      expect.objectContaining({
        nodeId: "b1",
        kind: "block",
        label: "The notice preceded the hearing.",
        section: "Facts",
        page: null,
        score: 0,
      }),
    ]);
  });

  it("falls back to local retrieval when the agent cites no valid nodes", () => {
    const hits = referencesForAnswer(sampleTree(), [], "notice hearing");

    expect(hits[0]).toMatchObject({ nodeId: "b1", kind: "block" });
  });

  it("formats short and long execution durations for metadata", () => {
    expect(formatExecutionTime(42)).toBe("42 ms");
    expect(formatExecutionTime(1_250)).toBe("1.3 s");
    expect(formatExecutionTime(388_000)).toBe("6m 28s");
    expect(executionDescription({ model: "deepseek/deepseek-v3", elapsedMs: 1_250 })).toBe(
      "Model: deepseek/deepseek-v3. Execution time: 1.3 s.",
    );
    expect(formatExecutionTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02 03:04:05 UTC");
    expect(executionDescription({
      model: "deepseek/deepseek-v3",
      elapsedMs: 1_250,
      startedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      endedAt: Date.UTC(2026, 0, 2, 3, 4, 6),
    })).toContain("Started: 2026-01-02 03:04:05 UTC. Ended: 2026-01-02 03:04:06 UTC.");
  });
});
