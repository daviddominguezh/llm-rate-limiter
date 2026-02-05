import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { memo } from "react";

interface NodeBodyProps {
  nodeId: string;
  description: string;
  text: string;
}

const NodeBodyComponent = ({ nodeId, description, text }: NodeBodyProps) => {
  const renderTooltip = (text: string, classStyle: string) => {
    return (
      <Tooltip>
        <TooltipTrigger
          className={`flex flex-start text-left mt-1 text-xs text-muted-foreground ${classStyle}`}
        >
          {text}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">
          {text}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="px-4 py-3">
      <p className="text-sm font-semibold text-foreground">{nodeId}</p>
      {description && renderTooltip(description, "line-clamp-3! font-medium")}
      {text && renderTooltip(text, "line-clamp-4!")}
    </div>
  );
};

export const NodeBody = memo(
  NodeBodyComponent,
  (prev, next) =>
    prev.nodeId === next.nodeId && prev.description === next.description,
);
