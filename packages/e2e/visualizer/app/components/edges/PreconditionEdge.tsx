"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { MessageSquare, Brain, Wrench } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { RFEdgeData } from "../../utils/graphTransformers";

function PreconditionEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8, // Rounded corners on the right angles
  });

  const edgeData = data as RFEdgeData | undefined;
  const preconditions = edgeData?.preconditions;
  const hasPreconditions = preconditions && preconditions.length > 0;
  const preconditionType = hasPreconditions ? preconditions[0].type : null;
  const muted = edgeData?.muted ?? false;

  const getTypeIcon = () => {
    switch (preconditionType) {
      case "user_said":
        return <MessageSquare className="h-3 w-3" />;
      case "agent_decision":
        return <Brain className="h-3 w-3" />;
      case "tool_call":
        return <Wrench className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const getTypeColors = () => {
    switch (preconditionType) {
      case "user_said":
        return "bg-green-100 text-green-700 border-green-300";
      case "agent_decision":
        return "bg-purple-100 text-purple-700 border-purple-300";
      case "tool_call":
        return "bg-orange-100 text-orange-700 border-orange-300";
      default:
        return "bg-gray-100 text-gray-700 border-gray-300";
    }
  };

  const getStrokeColor = () => {
    if (selected) return "#000000";
    switch (preconditionType) {
      case "user_said":
        return "#22c55e"; // green-500
      case "agent_decision":
        return "#a855f7"; // purple-500
      case "tool_call":
        return "#f97316"; // orange-500
      default:
        return "#94a3b8"; // slate-400
    }
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: getStrokeColor(),
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: selected ? "none" : "5 5",
          opacity: muted ? 0.4 : 1,
          transition: "opacity 150ms",
          animation: selected ? "none" : "dash-flow 1s linear infinite",
        }}
      />
      {hasPreconditions && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              opacity: muted ? 0.4 : 1,
              transition: "opacity 150ms",
            }}
          >
            <Tooltip>
              <TooltipTrigger
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${getTypeColors()} ${
                  selected ? "ring-2 ring-blue-500 ring-offset-1" : ""
                }`}
              >
                {getTypeIcon()}
                <span>{preconditions.length}</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm">
                <div className="space-y-1">
                  {preconditions.map((p, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-medium capitalize">{p.type.replace("_", " ")}:</span>{" "}
                      {p.value}
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PreconditionEdge = memo(PreconditionEdgeComponent);
