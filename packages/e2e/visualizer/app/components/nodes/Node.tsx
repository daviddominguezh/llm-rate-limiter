"use client";

import { memo } from "react";
import { type NodeProps, useEdges } from "@xyflow/react";
import { Separator } from "@/components/ui/separator";
import type { RFNodeData, RFEdgeData } from "../../utils/graphTransformers";
import { NodeHeader, type NodeKind } from "./NodeHeader";
import { NodeBody } from "./NodeBody";
import { Handles } from "./Handles";
import type { Edge } from "@xyflow/react";

function getNodeKind(nodeId: string, edges: Edge<RFEdgeData>[]): NodeKind {
  // Find outgoing edges from this node
  const outgoingEdges = edges.filter((e) => e.source === nodeId);

  // If no outgoing edges, it's an agent node
  if (outgoingEdges.length === 0) {
    return "agent";
  }

  // Check preconditions on outgoing edges
  for (const edge of outgoingEdges) {
    const preconditions = edge.data?.preconditions;
    if (preconditions && preconditions.length > 0) {
      const preconditionType = preconditions[0].type;
      switch (preconditionType) {
        case "user_said":
          return "user_routing";
        case "agent_decision":
          return "agent_decision";
        case "tool_call":
          return "tool_call";
      }
    }
  }

  // No preconditions on outgoing edges
  return "agent";
}

function AgentNodeComponent({ data, selected, id }: NodeProps) {
  const nodeData = data as RFNodeData;
  const edges = useEdges<Edge<RFEdgeData>>();

  const width = nodeData.nodeWidth ?? 180;
  const muted = nodeData.muted ?? false;
  const nodeKind = getNodeKind(id, edges);
  const nextNodeIsUser = nodeData.nextNodeIsUser ?? false;

  const borderWidth = nextNodeIsUser ? "border-2" : "border";
  const borderColor = nextNodeIsUser
    ? "border-red-500"
    : selected
      ? "border-primary"
      : "border-secondary";
  const opacity = muted ? "opacity-40" : "opacity-100";

  const containerBaseStyle =
    "rounded-lg bg-white p-1 transition-opacity overflow-hidden";
  const containerClassname = `${containerBaseStyle} ${borderWidth} ${borderColor} ${opacity}`;

  return (
    <div
      className={containerClassname}
      style={{ width: `${width}px`, minHeight: "220px", maxHeight: "220px" }}
    >
      <Handles nodeId={id} nextNodeIsUser={nextNodeIsUser} />
      <NodeHeader nodeKind={nodeKind} agent={nodeData.agent} nodeId={id} />
      <Separator />
      <NodeBody
        nodeId={nodeData.nodeId}
        description={nodeData.description}
        text={nodeData.text}
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
