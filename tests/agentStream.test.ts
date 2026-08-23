import { describe, expect, it } from "vitest";
import {
  assistantText,
  assistantThinking,
  createChatStreamAccumulator,
} from "../src/chat/agentStream";
import type { ChatStreamEvent } from "../src/pyodide/types";

describe("assistant stream adapter", () => {
  it("accumulates markdown, reasoning, and tool results into assistant parts", async () => {
    const updates: string[] = [];
    const accumulator = createChatStreamAccumulator((message) => {
      updates.push(assistantText(message));
    });
    const events: ChatStreamEvent[] = [
      { type: "start", model: "test/chat", startedAt: 1 },
      { type: "part-start", index: 0, kind: "thinking", content: "Check the ruling." },
      { type: "part-end", index: 0, kind: "thinking" },
      { type: "part-start", index: 1, kind: "tool-call", toolCallId: "call-1", toolName: "navigate_document" },
      { type: "part-delta", index: 1, kind: "tool-call", argsDelta: '{"section_path":"II. Ruling"}' },
      { type: "part-end", index: 1, kind: "tool-call" },
      { type: "tool-call", toolCallId: "call-1", toolName: "navigate_document", args: { section_path: "II. Ruling" } },
      { type: "tool-result", toolCallId: "call-1", content: "The expulsion was void.", isError: false },
      { type: "part-start", index: 0, kind: "text", content: "## Holding\n\n" },
      { type: "part-delta", index: 0, kind: "text", contentDelta: "The expulsion was void." },
      { type: "part-end", index: 0, kind: "text" },
    ];

    for (const event of events) accumulator.push(event);
    const message = await accumulator.finish();

    expect(assistantThinking(message)).toBe("Check the ruling.");
    expect(assistantText(message)).toBe("## Holding\n\nThe expulsion was void.");
    expect(message.parts).toHaveLength(3);
    expect(message.parts.find((part) => part.type === "tool-call")).toMatchObject({
      toolCallId: "call-1",
      toolName: "navigate_document",
      result: "The expulsion was void.",
    });
    expect(updates.at(-1)).toBe("## Holding\n\nThe expulsion was void.");
  });
});
