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

interface DigestGraphProps {
  tree: DocumentNode;
  className?: string;
}

/**
 * Sigma.js visualization of a parsed document's context tree.
 *
 * Hovering a node reveals its reference `(section, p#)`, matching the
 * typed payload produced by src/parser.
 */
export default function DigestGraph({ tree, className }: DigestGraphProps) {
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

    const showTooltip = (nodeId: string): void => {
      const display = renderer.getNodeDisplayData(nodeId);
      if (!display) return;
      const viewport = renderer.framedGraphToViewport(display);
      setHovered({ id: nodeId, x: viewport.x, y: viewport.y });
    };

    const handleEnter = ({ node }: { node: string }): void => showTooltip(node);
    const handleLeave = (): void => setHovered(null);

    renderer.on("enterNode", handleEnter);
    renderer.on("leaveNode", handleLeave);

    return () => {
      renderer.off("enterNode", handleEnter);
      renderer.off("leaveNode", handleLeave);
      renderer.kill();
      sigmaRef.current = null;
      container.innerHTML = "";
    };
  }, [graph]);

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
