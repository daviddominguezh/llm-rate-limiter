import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  BottomSourceContent,
  BottomSourceContentRed,
  BottomTargetContent,
  BottomTargetContentRed,
  HANDLE_SIZE,
  LeftTargetContent,
  LeftTargetContentRed,
  RightSourceContent,
  RightSourceContentRed,
  TopSourceContent,
  TopSourceContentRed,
  TopTargetContent,
  TopTargetContentRed,
} from "./HandleContent";
import { useHandleContext } from "./HandleContext";

// Pre-rendered static handle style objects - never recreate
const handleStyleBase = {
  width: `${HANDLE_SIZE}px`,
  height: `${HANDLE_SIZE}px`,
  borderWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
} as const;

const topTargetStyle = {
  ...handleStyleBase,
  backgroundColor: "var(--xy-background-color)",
  left: "35%",
} as const;
const topSourceStyle = {
  ...handleStyleBase,
  backgroundColor: "white",
  left: "65%",
} as const;
const bottomTargetStyle = {
  ...handleStyleBase,
  backgroundColor: "var(--xy-background-color)",
  left: "35%",
} as const;
const bottomSourceStyle = {
  ...handleStyleBase,
  backgroundColor: "white",
  left: "65%",
} as const;
const leftTargetStyle = {
  ...handleStyleBase,
  backgroundColor: "var(--xy-background-color)",
  top: "50%",
} as const;

const rightSourceStyle = {
  ...handleStyleBase,
  backgroundColor: "white",
  top: "50%",
} as const;

interface HandlesProps {
  nodeId: string;
  nextNodeIsUser?: boolean;
}

function HandlesComponent({ nodeId, nextNodeIsUser }: HandlesProps) {
  const { onSourceHandleClick } = useHandleContext();

  const handleSourceClick = (handleId: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSourceHandleClick?.(nodeId, handleId, e);
  };

  // Prevent drag-and-drop connection - only allow click
  const preventDrag = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      {/* Top handles */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        style={topTargetStyle}
      >
        {nextNodeIsUser ? TopTargetContentRed : TopTargetContent}
      </Handle>
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        style={topSourceStyle}
        onClick={handleSourceClick("top-source")}
        onMouseDown={preventDrag}
      >
        {nextNodeIsUser ? TopSourceContentRed : TopSourceContent}
      </Handle>

      {/* Bottom handles */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        style={bottomTargetStyle}
      >
        {nextNodeIsUser ? BottomTargetContentRed : BottomTargetContent}
      </Handle>
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        style={bottomSourceStyle}
        onClick={handleSourceClick("bottom-source")}
        onMouseDown={preventDrag}
      >
        {nextNodeIsUser ? BottomSourceContentRed : BottomSourceContent}
      </Handle>

      {/* Left handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        style={leftTargetStyle}
      >
        {nextNodeIsUser ? LeftTargetContentRed : LeftTargetContent}
      </Handle>

      {/* Right handles */}
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        style={rightSourceStyle}
        onClick={handleSourceClick("right-source")}
        onMouseDown={preventDrag}
      >
        {nextNodeIsUser ? RightSourceContentRed : RightSourceContent}
      </Handle>
    </>
  );
}

export const Handles = memo(HandlesComponent);
