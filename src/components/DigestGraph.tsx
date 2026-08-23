import forceAtlas2 from "graphology-layout-forceatlas2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import type { DocumentNode } from "../parser";
import {
  EDGE_BASE,
  EDGE_DIMMED,
  EDGE_TRACE,
  pathToNode,
  treeToGraph,
  type TreeNodePayload,
} from "../graph/treeGraph";

interface HoveredNode {
  id: string;
  x: number;
  y: number;
}

export interface SelectedNode extends TreeNodePayload {
  id: string;
}

interface DigestGraphProps {
  tree: DocumentNode;
  className?: string;
  /** Fired when a node is clicked (as opposed to dragged). */
  onSelectNode?: (node: SelectedNode) => void;
  /** External request to pan the camera to a node (chat references). */
  focusRequest?: { nodeId: string; nonce: number } | null;
  /** The node whose context trace should be lit up (retrieval visualization). */
  selectedNodeId?: string | null;
}

/** Gentle force settings so interactions settle slowly, Obsidian-style. */
function physicsSettings(graph: Parameters<typeof forceAtlas2.inferSettings>[0]) {
  const inferred = forceAtlas2.inferSettings(graph);
  return {
    ...inferred,
    scalingRatio: Math.max(inferred.scalingRatio ?? 8, 10),
    gravity: 1.2,
    slowDown: 42,
  };
}

/**
 * Sigma.js visualization of a parsed document's context tree.
 *
 * - Hovering reveals the node reference `(section, p#)`.
 * - Edges stay thin and opaque; selecting a node lights up the
 *   root-to-node context trace in signal red while the rest recede.
 * - Nodes are draggable; physics only stirs briefly after interactions,
 *   settling slowly instead of idling.
 * - Clicking (press + release without drag) reports the node upward.
 */
export default function DigestGraph({ tree, className, onSelectNode, focusRequest, selectedNodeId }: DigestGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<TreeNodePayload> | null>(null);
  const [hovered, setHovered] = useState<HoveredNode | null>(null);

  const graph = useMemo(() => {
    const built = treeToGraph(tree);
    // Refine the radial seed layout into an organic, readable cluster.
    forceAtlas2.assign(built, {
      iterations: 180,
      settings: forceAtlas2.inferSettings(built),
    });
    return built;
  }, [tree]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Sigma(graph, container, {
      allowInvalidContainer: true,
      minCameraRatio: 0.08,
      maxCameraRatio: 6,
      labelDensity: 0.9,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 8,
      defaultEdgeType: "line",
      renderLabels: true,
      stagePadding: 60,
    });
    sigmaRef.current = renderer;
    container.classList.add("is-grabbable");

    // --- calm motion: heat-driven force simulation, no idle drift -----------
    const settings = physicsSettings(graph);
    let hot = 0; // frames of gentle simulation left after an interaction
    let rafId = 0;
    let draggedNodeId: string | null = null;

    const reheat = (frames: number): void => {
      hot = Math.max(hot, frames);
    };

    const tick = (): void => {
      const isDragging = draggedNodeId !== null;
      if (isDragging || hot > 0) {
        forceAtlas2.assign(graph, { iterations: 1, settings });
        if (hot > 0 && !isDragging) hot -= 1;
        renderer.refresh();
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    // --- node dragging -----------------------------------------------------
    const handleDown = ({ node }: { node: string }): void => {
      draggedNodeId = node;
      graph.setNodeAttribute(node, "highlighted", true);
      container.classList.add("is-dragging");
      setHovered(null);
    };

    const handleMove = (event: MouseEvent): void => {
      if (!draggedNodeId) return;
      const rect = container.getBoundingClientRect();
      const position = renderer.viewportToGraph({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      graph.setNodeAttribute(draggedNodeId, "x", position.x);
      graph.setNodeAttribute(draggedNodeId, "y", position.y);
      reheat(36);
    };

    const handleUp = (): void => {
      if (!draggedNodeId) return;
      graph.setNodeAttribute(draggedNodeId, "highlighted", false);
      draggedNodeId = null;
      container.classList.remove("is-dragging");
    };

    // --- hover + click ------------------------------------------------------
    const showTooltip = (nodeId: string): void => {
      const display = renderer.getNodeDisplayData(nodeId);
      if (!display) return;
      const viewport = renderer.framedGraphToViewport(display);
      setHovered({ id: nodeId, x: viewport.x, y: viewport.y });
    };

    const handleEnter = ({ node }: { node: string }): void => {
      showTooltip(node);
      reheat(14);
    };
    const handleLeave = (): void => setHovered(null);

    const handleClick = ({ node }: { node: string }): void => {
      const attributes = graph.getNodeAttributes(node);
      onSelectNode?.({ id: node, ...attributes });
      reheat(20);
    };

    renderer.on("downNode", handleDown);
    renderer.on("enterNode", handleEnter);
    renderer.on("leaveNode", handleLeave);
    renderer.on("clickNode", handleClick);
    container.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.cancelAnimationFrame(rafId);
      renderer.off("downNode", handleDown);
      renderer.off("enterNode", handleEnter);
      renderer.off("leaveNode", handleLeave);
      renderer.off("clickNode", handleClick);
      container.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      renderer.kill();
      sigmaRef.current = null;
      container.innerHTML = "";
    };
  }, [graph, onSelectNode]);

  // Context trace: when a node is selected (graph click or chat reference),
  // the edges along its path from the document root activate while the
  // remaining edges recede — signaling where the retrieval came from.
  useEffect(() => {
    const tracePath = selectedNodeId ? pathToNode(tree, selectedNodeId) : null;
    const onTrace = new Set(tracePath ?? []);

    graph.forEachEdge((edge, _attributes, source, target) => {
      const active = Boolean(tracePath && onTrace.has(source) && onTrace.has(target));
      graph.setEdgeAttribute(edge, "color", active ? EDGE_TRACE.color : tracePath ? EDGE_DIMMED.color : EDGE_BASE.color);
      graph.setEdgeAttribute(edge, "size", active ? EDGE_TRACE.size : EDGE_BASE.size);
      graph.setEdgeAttribute(edge, "zIndex", active ? 1 : 0);
    });

    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, "highlighted", onTrace.has(node));
    });
  }, [graph, tree, selectedNodeId]);

  const focusNode = useCallback((nodeId: string): void => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const display = renderer.getNodeDisplayData(nodeId);
    if (!display) return;
    renderer.getCamera().animate(
      { x: display.x, y: display.y, ratio: Math.max(renderer.getCamera().getState().ratio, 0.4) },
      { duration: 320 },
    );
  }, []);

  // Chat-driven focus: pan to the node a reference card points at.
  useEffect(() => {
    if (!focusRequest) return;
    focusNode(focusRequest.nodeId);
  }, [focusRequest, focusNode]);

  const hoveredPayload = hovered ? graph.getNodeAttributes(hovered.id) : null;

  return (
    <div className={`digest-graph ${className ?? ""}`}>
      <div ref={containerRef} className="digest-graph-canvas" />
      <div className="digest-graph-legend" aria-hidden="true">
        <span><i style={{ background: "#1d3432" }} /> document</span>
        <span><i style={{ background: "#b8d856" }} /> section</span>
        <span><i style={{ background: "#bfe5eb" }} /> block</span>
      </div>
      {hovered && hoveredPayload && (
        <button
          className="digest-graph-tooltip"
          onClick={() => focusNode(hovered.id)}
          style={{ left: hovered.x, top: hovered.y }}
          type="button"
        >
          <span className="tooltip-section">({hoveredPayload.section || "root"})</span>
          {hoveredPayload.page !== null && <span className="tooltip-page">p{hoveredPayload.page}</span>}
        </button>
      )}
    </div>
  );
}
