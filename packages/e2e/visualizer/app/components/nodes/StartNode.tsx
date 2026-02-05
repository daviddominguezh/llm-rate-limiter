"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useHandleContext } from "./HandleContext";

function StartNodeComponent({ selected, id }: NodeProps) {
  const { onSourceHandleClick } = useHandleContext();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSourceHandleClick?.(id, "right-source", e);
  };

  // Prevent drag-and-drop connection - only allow click
  const preventDrag = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-green-500 px-6 py-3 ${
        selected ? "ring-2 ring-primary ring-offset-2" : ""
      }`}
    >
      <span className="text-sm font-semibold uppercase tracking-wide text-white">
        Start
      </span>
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        onClick={handleClick}
        onMouseDown={preventDrag}
        style={{
          backgroundColor: "white",
          width: "12px",
          height: "12px",
          border: "2px solid #22c55e",
          cursor: "pointer",
        }}
      />
    </div>
  );
}

export const StartNode = memo(StartNodeComponent);
