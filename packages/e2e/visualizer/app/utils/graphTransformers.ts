import { Position, type Node as RFNode, type Edge as RFEdge } from "@xyflow/react";
import type {
  Node as SchemaNode,
  Edge as SchemaEdge,
  Precondition,
  ContextPreconditions,
} from "../schemas/graph.schema";

// Default node dimensions for handle calculation
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 80;

interface HandlePair {
  sourceHandle: string;
  targetHandle: string;
}

/**
 * Calculate the closest source and target handles based on node positions.
 * Available handles:
 * - Sources: right-source, top-source, bottom-source
 * - Targets: left-target, top-target, bottom-target
 */
function getClosestHandles(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number },
  _nodeWidth: number = DEFAULT_NODE_WIDTH,
  _nodeHeight: number = DEFAULT_NODE_HEIGHT
): HandlePair {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;

  // For left-to-right flow (target is to the right)
  if (dx >= 0) {
    return { sourceHandle: "right-source", targetHandle: "left-target" };
  }

  // For right-to-left flow (back edges), use vertical handles
  if (dy > 0) {
    // Target is below source: use bottom-source → top-target
    return { sourceHandle: "bottom-source", targetHandle: "top-target" };
  } else {
    // Target is above source: use top-source → bottom-target
    return { sourceHandle: "top-source", targetHandle: "bottom-target" };
  }
}

export interface RFNodeData extends Record<string, unknown> {
  nodeId: string;
  text: string;
  description: string;
  agent?: string;
  nextNodeIsUser?: boolean;
  muted?: boolean;
  nodeWidth?: number | null;
}

export interface RFEdgeData extends Record<string, unknown> {
  preconditions?: Precondition[];
  contextPreconditions?: ContextPreconditions;
  muted?: boolean;
}

export function schemaNodeToRFNode(node: SchemaNode, index = 0): RFNode<RFNodeData> {
  // Generate default position if not provided (grid layout)
  const defaultPosition = {
    x: (index % 5) * 300,
    y: Math.floor(index / 5) * 150,
  };

  return {
    id: node.id,
    type: node.kind,
    position: node.position ?? defaultPosition,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      nodeId: node.id,
      text: node.text,
      description: node.description,
      agent: node.agent,
      nextNodeIsUser: node.nextNodeIsUser,
    },
  };
}

export function rfNodeToSchemaNode(
  rfNode: RFNode,
  originalNode: SchemaNode
): SchemaNode {
  const data = rfNode.data as RFNodeData | undefined;
  return {
    id: rfNode.id,
    text: data?.text ?? originalNode.text,
    kind: originalNode.kind,
    description: data?.description ?? originalNode.description,
    agent: data?.agent ?? originalNode.agent,
    nextNodeIsUser: data?.nextNodeIsUser ?? originalNode.nextNodeIsUser,
    position: rfNode.position,
  };
}

export function schemaEdgeToRFEdge(
  edge: SchemaEdge,
  index = 0,
  nodes?: SchemaNode[]
): RFEdge<RFEdgeData> {
  // Calculate closest handles if nodes are provided
  let sourceHandle: string | undefined;
  let targetHandle: string | undefined;

  if (nodes) {
    const sourceNode = nodes.find((n) => n.id === edge.from);
    const targetNode = nodes.find((n) => n.id === edge.to);

    if (sourceNode?.position && targetNode?.position) {
      const handles = getClosestHandles(sourceNode.position, targetNode.position);
      sourceHandle = handles.sourceHandle;
      targetHandle = handles.targetHandle;
    }
  }

  return {
    id: `${edge.from}-${edge.to}-${index}`,
    source: edge.from,
    target: edge.to,
    sourceHandle,
    targetHandle,
    type: "precondition",
    data: {
      preconditions: edge.preconditions,
      contextPreconditions: edge.contextPreconditions,
    },
  };
}

export function rfEdgeToSchemaEdge(rfEdge: RFEdge<RFEdgeData>): SchemaEdge {
  return {
    from: rfEdge.source,
    to: rfEdge.target,
    preconditions: rfEdge.data?.preconditions,
    contextPreconditions: rfEdge.data?.contextPreconditions,
  };
}
