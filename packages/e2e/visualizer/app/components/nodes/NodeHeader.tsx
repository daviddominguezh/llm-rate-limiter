import { memo } from "react";
import { MessageSquare, Brain, Wrench, Send, Shrink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHandleContext } from "./HandleContext";

export type NodeKind =
  | "agent"
  | "user_routing"
  | "agent_decision"
  | "tool_call";

interface NodeHeaderProps {
  nodeKind: NodeKind;
  agent?: string;
  nodeId: string;
}

const NodeHeaderComponent = ({ nodeKind, nodeId }: NodeHeaderProps) => {
  const { onZoomToNode } = useHandleContext();
  let headerLabel: string;
  let headerIcon: React.ReactNode;
  let colorClass: string;

  switch (nodeKind) {
    case "user_routing":
      headerLabel = "User";
      colorClass = "text-green-700";
      headerIcon = <MessageSquare className={`h-4 w-4 ${colorClass}`} />;
      break;
    case "agent_decision":
      headerLabel = "Decision";
      colorClass = "text-purple-700";
      headerIcon = <Brain className={`h-4 w-4 ${colorClass}`} />;
      break;
    case "tool_call":
      headerLabel = "Tool";
      colorClass = "text-orange-700";
      headerIcon = <Wrench className={`h-4 w-4 ${colorClass}`} />;
      break;
    default:
      headerLabel = "Agent";
      colorClass = "text-muted-foreground";
      headerIcon = <Send className={`h-4 w-4 ${colorClass}`} />;
  }

  return (
    <div className="flex justify-between items-center group">
      <div className="flex items-center gap-2 px-4 py-3">
        {headerIcon}
        <span className={`text-xs font-medium uppercase ${colorClass}`}>
          {headerLabel}
        </span>
      </div>

      <Button
        variant="ghost"
        size="icon-lg"
        className="mr-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onZoomToNode?.(nodeId);
        }}
      >
        <Shrink className="h-3 w-3" />
      </Button>
    </div>
  );
};

export const NodeHeader = memo(
  NodeHeaderComponent,
  (prev, next) =>
    prev.nodeKind === next.nodeKind &&
    prev.agent === next.agent &&
    prev.nodeId === next.nodeId,
);
