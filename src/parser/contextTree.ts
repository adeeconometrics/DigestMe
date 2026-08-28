import type { DocumentNode } from "./types";

const MAX_LABEL_LENGTH = 72;
const MAX_SNIPPET_LENGTH = 400;
const MAX_MERGED_TEXT_LENGTH = 2000;

interface HeadingLine {
  type: "heading";
  depth: number;
  text: string;
}

interface PageMarkerLine {
  type: "page-marker";
  page: number;
}

type MarkdownLine =
  | HeadingLine
  | PageMarkerLine
  | { type: "block"; text: string; isTableRow: boolean }
  | { type: "skip" };

/** `<!-- Page 12 -->` markers are emitted when parsing with includePageMarkers. */
function matchPageMarker(line: string): PageMarkerLine | null {
  const marker = /^<!--\s*Page\s+(\d+)\s*-->\s*$/.exec(line);
  return marker ? { type: "page-marker", page: Number(marker[1]) } : null;
}

function matchHeading(line: string): HeadingLine | null {
  const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!heading) return null;
  return { type: "heading", depth: heading[1].length, text: cleanInline(heading[2]) };
}

function isSkippable(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) return true; // horizontal rule
  if (/^\|?[\s|:-]+\|[\s|:-]*$/.test(trimmed)) return true; // table divider
  return false;
}

function cleanInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "") // stray inline markup such as <u>
    .replace(/[*_`]+([^*_`]*)[*_`]+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(rawLine: string): MarkdownLine {
  const marker = matchPageMarker(rawLine);
  if (marker) return marker;

  const heading = matchHeading(rawLine);
  if (heading) return heading;

  if (isSkippable(rawLine)) return { type: "skip" };

  // Table rows collapse to single-line blocks so they stay attached to their section.
  const isTableRow = rawLine.includes("|");
  const text = cleanInline(rawLine.trim().replace(/\s*\|\s*/g, " · ").replace(/^·\s*|\s*·$/g, ""));
  return text ? { type: "block", text, isTableRow } : { type: "skip" };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Maps pdf-inspector markdown output onto a hierarchical context tree.
 *
 * - Markdown headings (#..######) nest into section nodes.
 * - Body lines attach as block leaves under the nearest open section.
 * - `<!-- Page N -->` markers record which page each node's content starts on,
 *   powering the `(section, p#)` hover labels in the graph view.
 *
 * Pure function over strings: no DOM or WASM dependencies, deterministic ids.
 */
export function buildContextTree(markdown: string, rootTitle = "Document"): DocumentNode {
  const root: DocumentNode = {
    id: "n0",
    kind: "document",
    label: truncate(rootTitle || "Document", MAX_LABEL_LENGTH),
    heading: rootTitle || "Document",
    section: rootTitle,
    page: null,
    children: [],
  };

  interface Frame {
    depth: number;
    node: DocumentNode;
  }

  const stack: Frame[] = [];
  let nextId = 1;
  let currentPage: number | null = null;
  let lastLeaf: DocumentNode | null = null;
  let lastLeafWasTableRow = false;

  function openSection(depth: number, title: string): void {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();

    const parent = stack.length ? stack[stack.length - 1].node : root;
    const ancestorPath = stack.map((frame) => frame.node.label).join(" › ");
    const node: DocumentNode = {
      id: `n${nextId++}`,
      kind: "section",
      label: truncate(title || `Untitled section`, MAX_LABEL_LENGTH),
      heading: title || `Untitled section`,
      section: [ancestorPath, truncate(title, MAX_LABEL_LENGTH)].filter(Boolean).join(" › "),
      page: currentPage,
      children: [],
    };
    parent.children.push(node);
    stack.push({ depth, node });
    lastLeaf = null;
  }

  function appendBlock(text: string, isTableRow: boolean): void {
    const parent = stack.length ? stack[stack.length - 1].node : root;

    // Merge wrapped lines of the same paragraph into one leaf block;
    // table rows stay separate so each row keeps its own reference.
    const tail = parent.children[parent.children.length - 1];
    if (
      lastLeaf && lastLeaf === tail && lastLeaf.page === currentPage &&
      lastLeaf.text !== undefined && !lastLeafWasTableRow && !isTableRow
    ) {
      lastLeaf.text = `${lastLeaf.text} ${text}`.slice(0, MAX_MERGED_TEXT_LENGTH);
      lastLeaf.label = truncate(lastLeaf.text, MAX_LABEL_LENGTH);
      return;
    }

    const node: DocumentNode = {
      id: `n${nextId++}`,
      kind: "block",
      label: truncate(text, MAX_LABEL_LENGTH),
      section: stack.map((frame) => frame.node.label).join(" › ") || parent.label,
      page: currentPage,
      text: text.slice(0, MAX_SNIPPET_LENGTH),
      children: [],
    };
    parent.children.push(node);
    lastLeaf = node;
    lastLeafWasTableRow = isTableRow;
  }

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = classify(rawLine);

    if (line.type === "page-marker") {
      currentPage = line.page;
    } else if (line.type === "heading") {
      openSection(line.depth, line.text);
    } else if (line.type === "block") {
      appendBlock(line.text, line.isTableRow);
    }
  }

  return root;
}

/** Flattens the tree depth-first; handy for counts and graph building. */
export function flattenTree(root: DocumentNode): DocumentNode[] {
  const out: DocumentNode[] = [];
  const visit = (node: DocumentNode): void => {
    out.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return out;
}
