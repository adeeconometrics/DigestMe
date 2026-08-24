import { parseCaseDigestJson } from "../lib/caseDigestDocx";
import type { CaseDigest } from "../lib/caseDigestDocx";
import type { DocumentNode, DocumentNodeKind } from "../parser";
import { isWireBoolean, isWireNonNegativeInteger, isWireRecord, isWireString, type WireValue } from "../types";

export interface AgentCredentials {
  modelId: string;
  apiKey: string;
}

export interface AgentReference {
  nodeId: string;
  kind: DocumentNodeKind;
  label: string;
  section: string;
  page: number | null;
  snippet: string;
}

export interface AgentExecution {
  model: string;
  elapsedMs: number;
  startedAt?: number;
  endedAt?: number;
}

export interface ChatAgentResult extends AgentExecution {
  markdown: string;
  references: AgentReference[];
}

export interface CaseDigestAgentResult extends AgentExecution {
  digest: CaseDigest;
  references: AgentReference[];
}

export type AgentCommand = "chat" | "digest";

export interface AgentRequest {
  command: AgentCommand;
  root: DocumentNode;
  credentials: AgentCredentials;
  question?: string;
}

type ChatPartKind = "text" | "thinking" | "tool-call";

export type ChatStreamEvent =
  | { type: "start"; model: string; startedAt: number }
  | {
      type: "part-start";
      index: number;
      kind: ChatPartKind;
      content?: string;
      toolCallId?: string;
      toolName?: string;
      args?: WireValue;
    }
  | {
      type: "part-delta";
      index: number;
      kind: ChatPartKind;
      contentDelta?: string;
      argsDelta?: WireValue;
      toolNameDelta?: string;
      toolCallId?: string;
    }
  | {
      type: "part-end";
      index: number;
      kind: ChatPartKind;
      args?: WireValue;
    }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: WireValue }
  | { type: "tool-result"; toolCallId: string; content: string; isError: boolean };

export interface EngineStatus {
  state: "idle" | "loading" | "ready" | "failed";
  message?: string;
}

export function isDocumentNodeKind(value: WireValue): value is DocumentNodeKind {
  return value === "document" || value === "section" || value === "block";
}

function requiredString(value: WireValue, name: string): string {
  if (!isWireString(value)) throw new Error(`Agent returned an invalid ${name}.`);
  return value;
}

function parseReference(value: WireValue): AgentReference {
  if (!isWireRecord(value)) {
    throw new Error("Agent returned an invalid document reference.");
  }

  const page = value.page;
  if (page !== null && !isWireNonNegativeInteger(page)) {
    throw new Error("Agent returned an invalid reference page.");
  }

  const kind = value.kind;
  if (!isDocumentNodeKind(kind)) throw new Error("Agent returned an invalid reference kind.");

  return {
    nodeId: requiredString(value.node_id, "reference node id"),
    kind,
    label: requiredString(value.label, "reference label"),
    section: requiredString(value.section, "reference section"),
    page,
    snippet: requiredString(value.snippet, "reference snippet"),
  };
}

function parseExecution(value: WireValue): AgentExecution {
  if (!isWireRecord(value)) {
    throw new Error("Agent returned an invalid execution result.");
  }

  const elapsedMs = value.elapsed_ms;
  if (!isWireNonNegativeInteger(elapsedMs)) {
    throw new Error("Agent returned an invalid execution time.");
  }
  const startedAt = optionalTimestamp(value.started_at, "start time");
  const endedAt = optionalTimestamp(value.ended_at, "end time");
  const execution: AgentExecution = {
    model: requiredString(value.model, "model"),
    elapsedMs,
  };
  if (startedAt !== undefined) execution.startedAt = startedAt;
  if (endedAt !== undefined) execution.endedAt = endedAt;
  return execution;
}

function optionalTimestamp(value: WireValue, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isWireNonNegativeInteger(value)) {
    throw new Error(`Agent returned an invalid execution ${name}.`);
  }
  return value;
}

function parseReferences(value: WireValue): AgentReference[] {
  if (!Array.isArray(value)) throw new Error("Agent returned invalid document references.");
  return value.map(parseReference);
}

export function parseChatAgentResult(value: WireValue): ChatAgentResult {
  if (!isWireRecord(value)) {
    throw new Error("Agent returned an invalid chat result.");
  }

  return {
    ...parseExecution(value),
    markdown: requiredString(value.markdown, "markdown answer"),
    references: parseReferences(value.references),
  };
}

export function parseCaseDigestAgentResult(value: WireValue): CaseDigestAgentResult {
  if (!isWireRecord(value)) {
    throw new Error("Agent returned an invalid digest result.");
  }

  return {
    ...parseExecution(value),
    digest: parseCaseDigestJson(value.digest),
    references: parseReferences(value.references),
  };
}

function streamRecord(value: WireValue): Record<string, WireValue> {
  if (!isWireRecord(value)) {
    throw new Error("Agent returned an invalid chat stream event.");
  }
  return value;
}

function streamIndex(value: WireValue): number {
  if (!isWireNonNegativeInteger(value)) {
    throw new Error("Agent returned an invalid chat stream part index.");
  }
  return value;
}

function streamKind(value: WireValue): ChatPartKind {
  if (value === "text" || value === "thinking" || value === "tool-call") return value;
  throw new Error("Agent returned an invalid chat stream part kind.");
}

function optionalStreamString(value: WireValue, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, name);
}

export function parseChatStreamEvent(value: WireValue): ChatStreamEvent {
  const event = streamRecord(value);
  const type = requiredString(event.type, "chat stream event type");

  if (type === "start") {
    const startedAt = event.started_at;
    if (!isWireNonNegativeInteger(startedAt)) {
      throw new Error("Agent returned an invalid chat stream start time.");
    }
    return { type, model: requiredString(event.model, "chat stream model"), startedAt };
  }

  if (type === "part-start") {
    const kind = streamKind(event.kind);
    const base = { type, index: streamIndex(event.index), kind } as const;
    if (kind === "tool-call") {
      const part: Extract<ChatStreamEvent, { type: "part-start" }> = {
        ...base,
        toolCallId: requiredString(event.tool_call_id, "tool call id"),
        toolName: requiredString(event.tool_name, "tool name"),
      };
      if (event.args !== undefined) part.args = event.args;
      return part;
    }
    const part: Extract<ChatStreamEvent, { type: "part-start" }> = { ...base };
    if (event.content !== undefined) {
      part.content = requiredString(event.content, "part content");
    }
    return part;
  }

  if (type === "part-delta") {
    const kind = streamKind(event.kind);
    const contentDelta = optionalStreamString(event.content_delta, "content delta");
    const argsDelta = event.args_delta;
    const toolNameDelta = optionalStreamString(event.tool_name_delta, "tool name delta");
    const toolCallId = optionalStreamString(event.tool_call_id, "tool call id");
    if (contentDelta === undefined && argsDelta === undefined && toolNameDelta === undefined && toolCallId === undefined) {
      throw new Error("Agent returned an empty chat stream delta.");
    }
    const delta: Extract<ChatStreamEvent, { type: "part-delta" }> = { type, index: streamIndex(event.index), kind };
    if (contentDelta !== undefined) delta.contentDelta = contentDelta;
    if (argsDelta !== undefined) delta.argsDelta = argsDelta;
    if (toolNameDelta !== undefined) delta.toolNameDelta = toolNameDelta;
    if (toolCallId !== undefined) delta.toolCallId = toolCallId;
    return delta;
  }

  if (type === "part-end") {
    const args = event.args;
    const part: Extract<ChatStreamEvent, { type: "part-end" }> = { type, index: streamIndex(event.index), kind: streamKind(event.kind) };
    if (args !== undefined) part.args = args;
    return part;
  }

  if (type === "tool-call") {
    return {
      type,
      toolCallId: requiredString(event.tool_call_id, "tool call id"),
      toolName: requiredString(event.tool_name, "tool name"),
      args: event.args,
    };
  }

  if (type === "tool-result") {
    if (!isWireBoolean(event.is_error)) throw new Error("Agent returned an invalid tool result status.");
    return {
      type,
      toolCallId: requiredString(event.tool_call_id, "tool call id"),
      content: requiredString(event.content, "tool result"),
      isError: event.is_error,
    };
  }

  throw new Error(`Agent returned an unknown chat stream event: ${type}`);
}
