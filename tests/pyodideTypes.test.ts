import { describe, expect, it } from "vitest";
import { parseCaseDigestAgentResult, parseChatAgentResult } from "../src/pyodide/types";
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

  it("rejects malformed execution metadata", () => {
    expect(() => parseChatAgentResult({ markdown: "answer", references: [], model: "model", elapsed_ms: -1 })).toThrow(
      "Agent returned an invalid execution time.",
    );
  });
});
