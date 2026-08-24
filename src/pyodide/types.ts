import { parseCaseDigestJson } from "../lib/caseDigestDocx";
import type { CaseDigest } from "../lib/caseDigestDocx";
import type { DocumentNode, DocumentNodeKind } from "../parser";
import type { WireValue } from "../types";

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
      args?: unknown;
    }
  | {
      type: "part-delta";
      index: number;
      kind: ChatPartKind;
      contentDelta?: string;
      argsDelta?: unknown;
      toolNameDelta?: string;
      toolCallId?: string;
    }
  | {
      type: "part-end";
      index: number;
      kind: ChatPartKind;
      args?: unknown;
    }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; content: string; isError: boolean };

export interface EngineStatus {
  state: "idle" | "loading" | "ready" | "failed";
  message?: string;
}

export function isDocumentNodeKind(value: unknown): value is DocumentNodeKind {
  return value === "document" || value === "section" || value === "block";
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`Agent returned an invalid ${name}.`);
  return value;
}

function parseReference(value: unknown): AgentReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent returned an invalid document reference.");
  }

  const reference = value as Record<string, WireValue>;
  const page = reference.page;
  if (page !== null && (typeof page !== "number" || !Number.isInteger(page))) {
    throw new Error("Agent returned an invalid reference page.");
  }

  const kind = reference.kind;
  if (!isDocumentNodeKind(kind)) throw new Error("Agent returned an invalid reference kind.");

  return {
    nodeId: requiredString(reference.node_id, "reference node id"),
    kind,
    label: requiredString(reference.label, "reference label"),
    section: requiredString(reference.section, "reference section"),
    page,
    snippet: requiredString(reference.snippet, "reference snippet"),
  };
}

function parseExecution(value: unknown): AgentExecution {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent returned an invalid execution result.");
  }

  const result = value as Record<string, WireValue>;
  const elapsedMs = result.elapsed_ms;
  if (typeof elapsedMs !== "number" || !Number.isInteger(elapsedMs) || elapsedMs < 0) {
    throw new Error("Agent returned an invalid execution time.");
  }
  const startedAt = optionalTimestamp(result.started_at, "start time");
  const endedAt = optionalTimestamp(result.ended_at, "end time");
  return {
    model: requiredString(result.model, "model"),
    elapsedMs,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}

function optionalTimestamp(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Agent returned an invalid execution ${name}.`);
  }
  return value;
}

function parseReferences(value: unknown): AgentReference[] {
  if (!Array.isArray(value)) throw new Error("Agent returned invalid document references.");
  return value.map(parseReference);
}

export function parseChatAgentResult(value: unknown): ChatAgentResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent returned an invalid chat result.");
  }

  const result = value as Record<string, WireValue>;
  return {
    ...parseExecution(result),
    markdown: requiredString(result.markdown, "markdown answer"),
    references: parseReferences(result.references),
  };
}

export function parseCaseDigestAgentResult(value: unknown): CaseDigestAgentResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent returned an invalid digest result.");
  }

  const result = value as Record<string, WireValue>;
  return {
    ...parseExecution(result),
    digest: parseCaseDigestJson(result.digest),
    references: parseReferences(result.references),
  };
}

function streamRecord(value: unknown): Record<string, WireValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent returned an invalid chat stream event.");
  }
  return value as Record<string, WireValue>;
}

function streamIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Agent returned an invalid chat stream part index.");
  }
  return value;
}

function streamKind(value: unknown): ChatPartKind {
  if (value === "text" || value === "thinking" || value === "tool-call") return value;
  throw new Error("Agent returned an invalid chat stream part kind.");
}

function optionalStreamString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, name);
}

export function parseChatStreamEvent(value: unknown): ChatStreamEvent {
  const event = streamRecord(value);
  const type = requiredString(event.type, "chat stream event type");

  if (type === "start") {
    const startedAt = event.started_at;
    if (typeof startedAt !== "number" || !Number.isInteger(startedAt) || startedAt < 0) {
      throw new Error("Agent returned an invalid chat stream start time.");
    }
    return { type, model: requiredString(event.model, "chat stream model"), startedAt };
  }

  if (type === "part-start") {
    const kind = streamKind(event.kind);
    const base = { type, index: streamIndex(event.index), kind } as const;
    if (kind === "tool-call") {
      return {
        ...base,
        toolCallId: requiredString(event.tool_call_id, "tool call id"),
        toolName: requiredString(event.tool_name, "tool name"),
        ...(event.args === undefined ? {} : { args: event.args }),
      };
    }
    return {
      ...base,
      ...(event.content === undefined ? {} : { content: requiredString(event.content, "part content") }),
    };
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
    return {
      type,
      index: streamIndex(event.index),
      kind,
      ...(contentDelta === undefined ? {} : { contentDelta }),
      ...(argsDelta === undefined ? {} : { argsDelta }),
      ...(toolNameDelta === undefined ? {} : { toolNameDelta }),
      ...(toolCallId === undefined ? {} : { toolCallId }),
    };
  }

  if (type === "part-end") {
    const args = event.args;
    return {
      type,
      index: streamIndex(event.index),
      kind: streamKind(event.kind),
      ...(args === undefined ? {} : { args }),
    };
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
    if (typeof event.is_error !== "boolean") throw new Error("Agent returned an invalid tool result status.");
    return {
      type,
      toolCallId: requiredString(event.tool_call_id, "tool call id"),
      content: requiredString(event.content, "tool result"),
      isError: event.is_error,
    };
  }

  throw new Error(`Agent returned an unknown chat stream event: ${type}`);
}
