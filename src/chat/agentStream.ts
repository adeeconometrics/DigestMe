import {
  AssistantMessageAccumulator,
  unstable_createInitialMessage,
} from "assistant-stream";
import type { AssistantMessage, AssistantStreamChunk } from "assistant-stream";
import type { ChatStreamEvent } from "../pyodide/types";

export interface ChatStreamAccumulator {
  /** Enqueue one validated bridge event without blocking the worker message handler. */
  push: (event: ChatStreamEvent) => void;
  /** Close the assistant stream and return its final accumulated message. */
  finish: () => Promise<AssistantMessage>;
  /** Abort a stream whose worker request failed or was cancelled. */
  abort: () => Promise<void>;
}

export function createInitialAssistantMessage(): AssistantMessage {
  return unstable_createInitialMessage();
}

interface PartPath {
  path: number;
  kind: "text" | "thinking" | "tool-call";
}

function jsonText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : serialized;
}

function partPath(kind: "text" | "thinking" | "tool-call", path: number): PartPath {
  return { kind, path };
}

function makePartStart(event: Extract<ChatStreamEvent, { type: "part-start" }>, path: number): AssistantStreamChunk {
  if (event.kind === "text" || event.kind === "thinking") {
    return {
      path: [path],
      type: "part-start",
      part: { type: event.kind === "thinking" ? "reasoning" : "text" },
    };
  }

  return {
    path: [path],
    type: "part-start",
    part: {
      type: "tool-call",
      toolCallId: event.toolCallId ?? `tool-${path}`,
      toolName: event.toolName ?? "tool",
    },
  };
}

function makeTextDelta(path: number, textDelta: string): AssistantStreamChunk {
  return { path: [path], type: "text-delta", textDelta };
}

function chunksForEvent(
  event: ChatStreamEvent,
  pathsByIndex: Map<number, PartPath>,
  pathsByToolCallId: Map<string, number>,
  nextPath: { value: number },
  finishedToolPaths: Set<number>,
): AssistantStreamChunk[] {
  if (event.type === "start") return [];

  if (event.type === "part-start") {
    const path = nextPath.value++;
    pathsByIndex.set(event.index, partPath(event.kind, path));
    if (event.kind === "tool-call" && event.toolCallId) pathsByToolCallId.set(event.toolCallId, path);

    const chunks: AssistantStreamChunk[] = [makePartStart(event, path)];
    const initialText = event.kind === "tool-call" ? jsonText(event.args) : event.content;
    if (initialText) chunks.push(makeTextDelta(path, initialText));
    return chunks;
  }

  if (event.type === "part-delta") {
    const current = pathsByIndex.get(event.index);
    if (!current) return [];
    const delta = event.kind === "tool-call" ? jsonText(event.argsDelta) : event.contentDelta;
    return delta ? [makeTextDelta(current.path, delta)] : [];
  }

  if (event.type === "part-end") {
    const current = pathsByIndex.get(event.index);
    if (!current) return [];
    const chunks: AssistantStreamChunk[] = [];
    if (current.kind === "tool-call" && !finishedToolPaths.has(current.path)) {
      chunks.push({ path: [current.path], type: "tool-call-args-text-finish" });
      finishedToolPaths.add(current.path);
    }
    chunks.push({ path: [current.path], type: "part-finish" });
    return chunks;
  }

  if (event.type === "tool-call") {
    const existingPath = pathsByToolCallId.get(event.toolCallId);
    if (existingPath === undefined) {
      const path = nextPath.value++;
      pathsByToolCallId.set(event.toolCallId, path);
      const chunks: AssistantStreamChunk[] = [
        {
          path: [path],
          type: "part-start",
          part: { type: "tool-call", toolCallId: event.toolCallId, toolName: event.toolName },
        },
      ];
      const args = jsonText(event.args);
      if (args) chunks.push(makeTextDelta(path, args));
      chunks.push({ path: [path], type: "tool-call-args-text-finish" });
      finishedToolPaths.add(path);
      return chunks;
    }
    if (finishedToolPaths.has(existingPath)) return [];
    finishedToolPaths.add(existingPath);
    return [{ path: [existingPath], type: "tool-call-args-text-finish" }];
  }

  const path = pathsByToolCallId.get(event.toolCallId);
  if (path === undefined) return [];
  return [
    {
      path: [path],
      type: "result",
      result: event.content,
      isError: event.isError,
    },
  ];
}

/** Adapt the Python agent event protocol to assistant-stream's typed message accumulator. */
export function createChatStreamAccumulator(onUpdate: (message: AssistantMessage) => void): ChatStreamAccumulator {
  const accumulator = new AssistantMessageAccumulator({ throttle: true });
  const writer = accumulator.writable.getWriter();
  const reader = accumulator.readable.getReader();
  const pathsByIndex = new Map<number, PartPath>();
  const pathsByToolCallId = new Map<string, number>();
  const finishedToolPaths = new Set<number>();
  const nextPath = { value: 0 };
  let latest = unstable_createInitialMessage();
  let writeChain = Promise.resolve();

  const readChain = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      latest = next.value;
      onUpdate(latest);
    }
  })();

  return {
    push(event) {
      for (const chunk of chunksForEvent(event, pathsByIndex, pathsByToolCallId, nextPath, finishedToolPaths)) {
        writeChain = writeChain.then(() => writer.write(chunk));
      }
    },
    async finish() {
      await writeChain;
      await writer.close();
      await readChain;
      return latest;
    },
    async abort() {
      await writeChain.catch(() => undefined);
      await writer.abort().catch(() => undefined);
      await readChain.catch(() => undefined);
    },
  };
}

export function assistantText(message: AssistantMessage): string {
  return message.parts
    .filter((part): part is Extract<AssistantMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function assistantThinking(message: AssistantMessage): string {
  return message.parts
    .filter((part): part is Extract<AssistantMessage["parts"][number], { type: "reasoning" }> => part.type === "reasoning")
    .map((part) => part.text)
    .join("");
}
