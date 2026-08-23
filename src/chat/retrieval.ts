import { flattenTree } from "../parser";
import type { DocumentNode, DocumentNodeKind } from "../parser";

export interface RetrievalHit {
  nodeId: string;
  kind: DocumentNodeKind;
  label: string;
  section: string;
  page: number | null;
  /** Short excerpt shown in the chat reference card. */
  snippet: string;
  score: number;
}

const MIN_TOKEN_LENGTH = 3;

function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= MIN_TOKEN_LENGTH),
    ),
  );
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * Scores every tree node against the question with plain term overlap —
 * no network, no model, fully local. Longer matches weigh more, exact
 * phrases get a boost, and section paths contribute half weight so
 * headings can be found by name.
 */
export function retrieveNodes(root: DocumentNode, query: string, limit = 3): RetrievalHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const phrase = tokens.join(" ");
  const hits: RetrievalHit[] = [];

  for (const node of flattenTree(root)) {
    if (node.kind === "document") continue;

    const body = `${node.text ?? node.label}`.toLowerCase();
    const path = node.section.toLowerCase();

    let score = 0;
    for (const token of tokens) {
      const inBody = countOccurrences(body, token);
      if (inBody > 0) score += inBody * token.length;
      else if (path.includes(token)) score += Math.round(token.length / 2);
    }

    // Exact phrase or near-phrase presence is the strongest signal.
    if (body.includes(phrase)) score += phrase.length + 8;
    else if (tokens.length > 1 && tokens.every((token) => body.includes(token))) score += 6;

    if (score <= 0) continue;

    const source = (node.text ?? node.label).trim();
    hits.push({
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
      section: node.section,
      page: node.page,
      snippet: source.length > 140 ? `${source.slice(0, 139)}…` : source,
      score,
    });
  }

  return hits.sort((left, right) => right.score - left.score).slice(0, limit);
}
