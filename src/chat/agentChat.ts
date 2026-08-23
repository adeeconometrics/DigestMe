import { flattenTree } from "../parser";
import type { DocumentNode } from "../parser";
import type { AgentExecution, AgentReference } from "../pyodide/types";
import { retrieveNodes } from "./retrieval";
import type { RetrievalHit } from "./retrieval";

const MAX_AGENT_REFERENCES = 6;

/** Convert a Python reference into metadata from the current tree by node id. */
export function mapAgentReferences(
  root: DocumentNode,
  references: AgentReference[],
  limit = MAX_AGENT_REFERENCES,
): RetrievalHit[] {
  const nodes = new Map(flattenTree(root).map((node) => [node.id, node]));
  const seen = new Set<string>();
  const hits: RetrievalHit[] = [];

  for (const reference of references) {
    if (hits.length >= limit || seen.has(reference.nodeId)) continue;
    const node = nodes.get(reference.nodeId);
    if (!node || node.kind === "document") continue;
    seen.add(node.id);
    const source = (node.text ?? node.label).trim();
    hits.push({
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
      section: node.section,
      page: node.page,
      snippet: source.length > 140 ? `${source.slice(0, 139)}…` : source,
      score: 0,
    });
  }

  return hits;
}

/** Keep agent citations grounded and use local retrieval only when no node was cited. */
export function referencesForAnswer(
  root: DocumentNode,
  references: AgentReference[],
  fallbackQuery: string,
  limit = MAX_AGENT_REFERENCES,
): RetrievalHit[] {
  const mapped = mapAgentReferences(root, references, limit);
  return mapped.length ? mapped : retrieveNodes(root, fallbackQuery, Math.min(limit, 3));
}

/** Human-readable duration used by the execution metadata hover. */
export function formatExecutionTime(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs} ms`;
  if (elapsedMs < 60_000) {
    const seconds = Math.round(elapsedMs / 100) / 10;
    return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
  }

  const totalSeconds = Math.round(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatExecutionTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
}

export function executionDescription(execution: AgentExecution): string {
  const start = execution.startedAt === undefined ? "" : ` Started: ${formatExecutionTimestamp(execution.startedAt)}.`;
  const end = execution.endedAt === undefined ? "" : ` Ended: ${formatExecutionTimestamp(execution.endedAt)}.`;
  return `Model: ${execution.model}. Execution time: ${formatExecutionTime(execution.elapsedMs)}.${start}${end}`;
}
