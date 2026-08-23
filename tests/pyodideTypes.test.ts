import { describe, expect, it } from "vitest";
import { parseCaseDigestAgentResult, parseChatAgentResult, parseStreamEvent } from "../src/pyodide/types";
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

  it("parses thinking and text stream deltas", () => {
    expect(parseStreamEvent({ type: "thinking", delta: "Reviewing the record." })).toEqual({
      type: "thinking",
      delta: "Reviewing the record.",
    });
    expect(parseStreamEvent({ type: "text", delta: "The holding is clear." })).toEqual({
      type: "text",
      delta: "The holding is clear.",
    });
  });

  it("parses the final stream event through the chat result contract", () => {
    expect(parseStreamEvent({
      type: "final",
      result: {
        markdown: "Final answer.",
        references: [],
        model: "deepseek/deepseek-v3",
        elapsed_ms: 1200,
      },
    })).toEqual({
      type: "final",
      result: {
        markdown: "Final answer.",
        references: [],
        model: "deepseek/deepseek-v3",
        elapsedMs: 1200,
      },
    });
  });

  it("rejects unknown stream event types", () => {
    expect(() => parseStreamEvent({ type: "tool", delta: "hidden" })).toThrow(
      "Agent returned an invalid stream event.",
    );
  });

  it("rejects malformed execution metadata", () => {
    expect(() => parseChatAgentResult({ markdown: "answer", references: [], model: "model", elapsed_ms: -1 })).toThrow(
      "Agent returned an invalid execution time.",
    );
  });
});
