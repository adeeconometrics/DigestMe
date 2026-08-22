import forceAtlas2 from "graphology-layout-forceatlas2";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import type { DocumentNode } from "../parser";
import { treeToGraph, type TreeNodePayload } from "../graph/treeGraph";

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
}

/** Low-energy force settings so idle graphs drift organically instead of jittering. */
function physicsSettings(graph: Parameters<typeof forceAtlas2.inferSettings>[0]) {
  const inferred = forceAtlas2.inferSettings(graph);
  return {
    ...inferred,
    scalingRatio: Math.max(inferred.scalingRatio ?? 8, 10),
    gravity: 1,
    slowDown: 24,
  };
}

/**
 * Sigma.js visualization of a parsed document's context tree.
 *
 * - Hovering reveals the node reference `(section, p#)`.
 * - Nodes are draggable; a low-energy ForceAtlas2 simulation keeps the
 *   layout fluid and settles back down once interactions stop.
 * - Clicking (press + release without drag) reports the node upward.
 */
export default function DigestGraph({ tree, className, onSelectNode, focusRequest }: DigestGraphProps) {
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

    // --- fluid motion: heat-driven force simulation -----------------------
    const settings = physicsSettings(graph);
    let hot = 0; // frames of energetic simulation left
    let frame = 0;
    let rafId = 0;
    let draggedNodeId: string | null = null;

    const reheat = (frames: number): void => {
      hot = Math.max(hot, frames);
    };

    const tick = (): void => {
      frame += 1;
      const isDragging = draggedNodeId !== null;
      // Ambient drift every 3rd frame keeps the graph gently alive;
      // drags and fresh interactions push short energetic bursts.
      if (isDragging || hot > 0 || frame % 3 === 0) {
        forceAtlas2.assign(graph, { iterations: 1, settings });
        if (hot > 0 && !isDragging) hot -= 1;
        if (draggedNodeId === null) renderer.refresh();
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
      reheat(90);
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
      reheat(30);
    };
    const handleLeave = (): void => setHovered(null);

    const handleClick = ({ node }: { node: string }): void => {
      const attributes = graph.getNodeAttributes(node);
      onSelectNode?.({ id: node, ...attributes });
      reheat(45);
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

  function focusNode(nodeId: string): void {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const display = renderer.getNodeDisplayData(nodeId);
    if (!display) return;
    renderer.getCamera().animate(
      { x: display.x, y: display.y, ratio: Math.max(renderer.getCamera().getState().ratio, 0.4) },
      { duration: 320 },
    );
  }

  // Chat-driven focus: pan to the node a reference card points at.
  useEffect(() => {
    if (!focusRequest) return;
    focusNode(focusRequest.nodeId);
  }, [focusRequest]);

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
