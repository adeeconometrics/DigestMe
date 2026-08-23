import { parseCaseDigestJson } from "../lib/caseDigestDocx";
import type { CaseDigest } from "../lib/caseDigestDocx";
import type { DocumentNode, DocumentNodeKind } from "../parser";

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

  const reference = value as Record<string, unknown>;
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

  const result = value as Record<string, unknown>;
  const elapsedMs = result.elapsed_ms;
  if (typeof elapsedMs !== "number" || !Number.isInteger(elapsedMs) || elapsedMs < 0) {
    throw new Error("Agent returned an invalid execution time.");
  }
  return { model: requiredString(result.model, "model"), elapsedMs };
}

function parseReferences(value: unknown): AgentReference[] {
  if (!Array.isArray(value)) throw new Error("Agent returned invalid document references.");
  return value.map(parseReference);
}

export function parseChatAgentResult(value: unknown): ChatAgentResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent returned an invalid chat result.");
  }

  const result = value as Record<string, unknown>;
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

  const result = value as Record<string, unknown>;
  return {
    ...parseExecution(result),
    digest: parseCaseDigestJson(result.digest),
    references: parseReferences(result.references),
  };
}
