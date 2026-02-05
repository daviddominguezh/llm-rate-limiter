import type { NodeTypes } from "@xyflow/react";
import { AgentNode } from "./Node";
import { StartNode } from "./StartNode";

export const nodeTypes: NodeTypes = {
  agent: AgentNode,
  agent_decision: AgentNode,
  start: StartNode,
};

export { AgentNode, StartNode };
