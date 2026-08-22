import Graph from "graphology";
import type { Attributes } from "graphology-types";
import type { DocumentNode } from "../parser";

export interface TreeNodePayload extends Attributes {
  kind: DocumentNode["kind"];
  label: string;
  section: string;
  page: number | null;
}

export const NODE_COLORS: Record<DocumentNode["kind"], string> = {
  document: "#1d3432",
  section: "#b8d856",
  block: "#bfe5eb",
};

const NODE_SIZES: Record<DocumentNode["kind"], number> = {
  document: 14,
  section: 8,
  block: 4,
};

/**
 * Maps a parsed document context tree onto a graphology graph:
 * one node per tree node, one edge per parent-child relationship.
 *
 * Initial positions are placed on concentric rings by depth so the
 * force layout starts from a readable, deterministic shape.
 */
export function treeToGraph(root: DocumentNode): Graph<TreeNodePayload> {
  const graph = new Graph<TreeNodePayload>();
  let ringIndex = 0;

  const visit = (node: DocumentNode, depth: number, parentId: string | null): void => {
    // Deterministic radial seed position; force-atlas2 refines it afterwards.
    const angle = (ringIndex * 137.5 * Math.PI) / 180;
    const radius = depth === 0 ? 0 : Math.min(6 + depth * 2.5, 30);
    ringIndex += 1;

    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        size: NODE_SIZES[node.kind],
        color: NODE_COLORS[node.kind],
        label: node.label,
        kind: node.kind,
        section: node.section,
        page: node.page,
      });
    }

    if (parentId && !graph.hasEdge(parentId, node.id)) {
      // Darkest palette ink keeps parent-child references clearly readable.
      graph.addEdge(parentId, node.id, { color: "#1d3432", size: 1.6 });
    }

    node.children.forEach((child) => visit(child, depth + 1, node.id));
  };

  visit(root, 0, null);
  return graph;
}
