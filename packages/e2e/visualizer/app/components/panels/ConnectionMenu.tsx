"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxCollection,
} from "@/components/ui/combobox";
import { Plus, Info } from "lucide-react";

const START_NODE_ID = "INITIAL_STEP";

interface ConnectionMenuProps {
  position: { x: number; y: number };
  sourceNodeId: string;
  sourceHandleId: string | null;
  nodes: Array<{ id: string; text: string }>;
  onSelectNode: (targetNodeId: string) => void;
  onCreateNode: () => void;
  onClose: () => void;
}

export function ConnectionMenu({
  position,
  sourceNodeId,
  nodes,
  onSelectNode,
  onCreateNode,
  onClose,
}: ConnectionMenuProps) {
  // Filter out the source node and start node (start node cannot be a target)
  const availableNodes = nodes.filter(
    (n) => n.id !== sourceNodeId && n.id !== START_NODE_ID
  );

  const handleNodeSelect = (value: string | null) => {
    if (value) {
      onSelectNode(value);
    }
  };

  return (
    <>
      {/* Backdrop to close on click outside */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Menu positioned at click location */}
      <div
        className="fixed z-50 w-64 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95"
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        <p className="text-xs text-muted-foreground p-3 px-3 pb-1">
          Connect to existing node:
        </p>

        {availableNodes.length === 0 && (
          <div className="p-2 pt-0">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No other nodes available to connect to.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {availableNodes.length > 0 && (
          <div className="p-2 pt-0">
            <Combobox
              items={availableNodes}
              onValueChange={handleNodeSelect}
            >
              <ComboboxInput
                placeholder="Search nodes..."
                className="w-full"
              />
              <ComboboxContent>
                <ComboboxEmpty>No nodes found.</ComboboxEmpty>
                <ComboboxList>
                  <ComboboxCollection>
                    {(node) => (
                      <ComboboxItem key={node.id} value={node.id}>
                        {node.id}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        )}

        <Separator />

        <div className="p-2 py-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={onCreateNode}
          >
            <Plus className="h-4 w-4" />
            Create new node
          </Button>
        </div>
      </div>
    </>
  );
}
