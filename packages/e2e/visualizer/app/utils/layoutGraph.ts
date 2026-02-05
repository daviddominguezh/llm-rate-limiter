import type { Node, Edge } from "../schemas/graph.schema";
import { dagre } from "../lib/dagre";

interface NodeDimensions {
  width: number;
  height: number;
}

interface LayoutOptions {
  horizontalSpacing?: number;
  verticalSpacing?: number;
  defaultNodeWidth?: number;
  defaultNodeHeight?: number;
  nodeDimensions?: Record<string, NodeDimensions>; // Per-node dimensions
  rankdir?: "TB" | "BT" | "LR" | "RL";
}

interface LayoutResult {
  nodes: Node[];
  edges: Edge[]; // All edges, not just tree edges
}

/**
 * Layout algorithm using dagre (Sugiyama method):
 * - Handles all edges including back-edges and cycles
 * - Minimizes edge crossings
 * - Respects per-node dimensions
 */
export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): LayoutResult {
  const {
    horizontalSpacing = 150,
    verticalSpacing = 50,
    defaultNodeWidth = 180,
    defaultNodeHeight = 130,
    nodeDimensions = {},
    rankdir = "LR",
  } = options;

  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Helper to get node dimensions
  const getNodeDimensions = (nodeId: string): NodeDimensions => {
    return nodeDimensions[nodeId] ?? { width: defaultNodeWidth, height: defaultNodeHeight };
  };

  // Create a new dagre graph
  const g = new dagre.graphlib.Graph();

  // Set graph options
  g.setGraph({
    rankdir,
    nodesep: verticalSpacing,  // Vertical spacing between nodes in same rank
    ranksep: horizontalSpacing, // Horizontal spacing between ranks
    marginx: 20,
    marginy: 20,
  });

  // Default edge label
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes with their specific dimensions
  nodes.forEach((node) => {
    const dims = getNodeDimensions(node.id);
    g.setNode(node.id, {
      width: dims.width,
      height: dims.height,
      label: node.id,
    });
  });

  // Add ALL edges (dagre handles back-edges and cycles)
  edges.forEach((edge) => {
    g.setEdge(edge.from, edge.to);
  });

  // Run the layout algorithm
  dagre.layout(g);

  // Log specific nodes for debugging
  const debugNodes = ["B_GetUserId", "B_TripType"];
  debugNodes.forEach((nodeId) => {
    if (g.hasNode(nodeId)) {
      const node = g.node(nodeId);
      const dims = getNodeDimensions(nodeId);
      console.log(`[layoutGraph] ${nodeId}: height=${dims.height}, dagre height=${node?.height}`);
    }
  });

  // Extract positions from dagre
  const positions = new Map<string, { x: number; y: number }>();

  g.nodes().forEach((nodeId: string) => {
    const dagreNode = g.node(nodeId);
    const dims = getNodeDimensions(nodeId);
    if (dagreNode) {
      // dagre returns center coordinates, we want top-left
      positions.set(nodeId, {
        x: dagreNode.x - dims.width / 2,
        y: dagreNode.y - dims.height / 2,
      });
    }
  });

  // Build final positioned nodes
  const layoutedNodes = nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
  }));

  // Return ALL edges (not filtered)
  return {
    nodes: layoutedNodes,
    edges: edges,
  };
}
