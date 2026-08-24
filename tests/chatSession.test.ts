import { describe, expect, it } from "vitest";
import { createInitialAssistantMessage } from "../src/chat/agentStream";
import {
  DEFAULT_VISIBLE_DIGEST_SESSIONS,
  hasOlderDigestSessions,
  serializeChatMessage,
  sortDigestSessionSummaries,
  visibleDigestSessions,
  type ChatMessage,
  type DigestSessionSummary,
} from "../src/chat/session";

function summary(id: string, updatedAt: string): DigestSessionSummary {
  return {
    id,
    title: `${id}.pdf`,
    documentId: id,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 1,
  };
}

describe("digest session list", () => {
  it("shows five recent sessions by default and all sessions when expanded", () => {
    const sessions = Array.from({ length: 7 }, (_, index) => summary(`session-${index}`, `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`));

    expect(DEFAULT_VISIBLE_DIGEST_SESSIONS).toBe(5);
    expect(visibleDigestSessions(sessions, false)).toHaveLength(5);
    expect(visibleDigestSessions(sessions, false)[0].id).toBe("session-6");
    expect(visibleDigestSessions(sessions, true)).toHaveLength(7);
    expect(hasOlderDigestSessions(sessions)).toBe(true);
    expect(hasOlderDigestSessions(sessions.slice(0, 5))).toBe(false);
  });

  it("sorts a caller-provided list without mutating it", () => {
    const sessions = [summary("older", "2026-08-01T00:00:00.000Z"), summary("newer", "2026-08-02T00:00:00.000Z")];

    expect(sortDigestSessionSummaries(sessions).map((session) => session.id)).toEqual(["newer", "older"]);
    expect(sessions.map((session) => session.id)).toEqual(["older", "newer"]);
  });
});

describe("chat message persistence", () => {
  it("keeps the completed assistant response while dropping runtime-only fields", () => {
    const message: ChatMessage = {
      id: "answer-1",
      at: "2026-08-01T00:00:00.000Z",
      role: "assistant",
      kind: "agent-answer",
      markdown: "A durable answer.",
      refs: [],
      execution: { model: "test-model", elapsedMs: 24 },
      assistant: createInitialAssistantMessage(),
    };

    expect(serializeChatMessage(message)).toEqual({
      id: "answer-1",
      at: "2026-08-01T00:00:00.000Z",
      role: "assistant",
      kind: "agent-answer",
      markdown: "A durable answer.",
      refs: [],
      execution: { model: "test-model", elapsedMs: 24 },
    });
  });
});
