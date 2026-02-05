import type { Graph } from "../schemas/graph.schema";
import { GraphSchema } from "../schemas/graph.schema";
import { layoutGraph } from "./layoutGraph";
import graphData from "../data/graph2.json";

interface LoadGraphResult {
  graph: Graph;
  nodeWidth: number;
}

function calculateNodeWidth(nodes: Graph["nodes"]): number {
  const maxIdLength = Math.max(...nodes.map((n) => n.id.length));
  const nodePadding = 40;
  return maxIdLength * 7.5 + nodePadding;
}

const FIXED_NODE_HEIGHT = 220;

/**
 * Calculate per-node dimensions for layout.
 * All nodes have fixed height of 133px except INITIAL_STEP.
 */
function calculateNodeDimensions(
  nodes: Graph["nodes"],
  nodeWidth: number
): Record<string, { width: number; height: number }> {
  const dimensions: Record<string, { width: number; height: number }> = {};

  for (const node of nodes) {
    // Special case: INITIAL_STEP is a small StartNode button
    if (node.id === "INITIAL_STEP") {
      dimensions[node.id] = { width: 100, height: 44 };
      continue;
    }

    dimensions[node.id] = { width: nodeWidth, height: FIXED_NODE_HEIGHT };
  }

  return dimensions;
}

function ensureNodePositions(graph: Graph, nodeWidth: number): Graph {
  const hasPositions = graph.nodes.every((node) => node.position !== undefined);

  if (hasPositions) {
    return graph;
  }

  const horizontalGap = 0;
  const verticalGap = 0;
  const nodeDimensions = calculateNodeDimensions(graph.nodes, nodeWidth);

  const layoutResult = layoutGraph(graph.nodes, graph.edges, {
    horizontalSpacing: nodeWidth + horizontalGap,
    verticalSpacing: verticalGap,
    defaultNodeWidth: nodeWidth,
    defaultNodeHeight: 130,
    nodeDimensions,
    rankdir: "LR",
  });

  return {
    ...graph,
    nodes: layoutResult.nodes,
    edges: layoutResult.edges,
  };
}

/**
 * Process a validated graph: calculate node width and ensure positions.
 * Use this for both hardcoded data and imported files.
 */
export function processGraph(graph: Graph): LoadGraphResult {
  const nodeWidth = calculateNodeWidth(graph.nodes);
  const processedGraph = ensureNodePositions(graph, nodeWidth);
  return { graph: processedGraph, nodeWidth };
}

export function loadGraphData(): LoadGraphResult | null {
  const result = GraphSchema.safeParse(graphData);

  if (!result.success) {
    console.error(
      "[loadGraphData] Graph validation failed:",
      result.error.format(),
    );
    return null;
  }

  return processGraph(result.data);
}

export function findInitialNodePosition(
  graph: Graph,
): { x: number; y: number } | null {
  const initialNode = graph.nodes.find((n) => n.id === "INITIAL_STEP");
  return initialNode?.position ?? null;
}

export function calculateInitialViewport(
  initialNodePosition: { x: number; y: number },
  containerHeight: number,
): { x: number; y: number; zoom: number } {
  const nodeHeight = 44; // Start node height
  const padding = 50;
  const zoom = 0.8;

  // Center the node vertically, accounting for zoom
  const nodeCenterY = initialNodePosition.y + nodeHeight / 2;

  return {
    x: -initialNodePosition.x * zoom + padding,
    y: containerHeight / 2 - nodeCenterY * zoom,
    zoom,
  };
}

// Set to null for empty canvas, or loadGraphData() to load from JSON
export const GRAPH_DATA: ReturnType<typeof loadGraphData> = null;
