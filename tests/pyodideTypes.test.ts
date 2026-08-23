import { describe, expect, it } from "vitest";
import { parseCaseDigestAgentResult, parseChatAgentResult, parseChatStreamEvent } from "../src/pyodide/types";
import rawMockJson from "./fixtures/case-digest.mock.json";

const reference = {
  node_id: "n4",
  kind: "block",
  label: "The committee reviewed the incident.",
  section: "I. Facts",
  page: 2,
  snippet: "The committee reviewed the incident.",
};

describe("Pyodide result contracts", () => {
  it("normalizes chat results from the Python JSON boundary", () => {
    expect(parseChatAgentResult({
      markdown: "## Answer\n\nGrounded.",
      references: [reference],
      model: "deepseek/deepseek-v3",
      elapsed_ms: 1200,
      started_at: 1767323045000,
      ended_at: 1767323046200,
    })).toEqual({
      markdown: "## Answer\n\nGrounded.",
      references: [{
        nodeId: "n4",
        kind: "block",
        label: "The committee reviewed the incident.",
        section: "I. Facts",
        page: 2,
        snippet: "The committee reviewed the incident.",
      }],
      model: "deepseek/deepseek-v3",
      elapsedMs: 1200,
      startedAt: 1767323045000,
      endedAt: 1767323046200,
    });
  });

  it("validates the structured digest before exposing it to the UI", () => {
    const result = parseCaseDigestAgentResult({
      digest: rawMockJson,
      references: [],
      model: "deepseek/deepseek-v3",
      elapsed_ms: 388000,
    });

    expect(result.digest.case_title).toBe("Villanueva v. Bayside Port Workers Cooperative");
    expect(result.elapsedMs).toBe(388000);
  });

  it("rejects malformed execution metadata", () => {
    expect(() => parseChatAgentResult({ markdown: "answer", references: [], model: "model", elapsed_ms: -1 })).toThrow(
      "Agent returned an invalid execution time.",
    );
  });

  it("normalizes streamed part and tool events from the Python boundary", () => {
    expect(parseChatStreamEvent({
      type: "part-start",
      index: 0,
      kind: "text",
      content: "## Holding",
    })).toEqual({ type: "part-start", index: 0, kind: "text", content: "## Holding" });
    expect(parseChatStreamEvent({
      type: "tool-result",
      tool_call_id: "call-1",
      content: "section loaded",
      is_error: false,
    })).toEqual({
      type: "tool-result",
      toolCallId: "call-1",
      content: "section loaded",
      isError: false,
    });
  });

  it("rejects unknown streamed event types", () => {
    expect(() => parseChatStreamEvent({ type: "unknown" })).toThrow(
      "Agent returned an unknown chat stream event: unknown",
    );
  });
});
