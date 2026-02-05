"use client";

import { useState } from "react";
import {
  Trash2,
  ArrowRight,
  ArrowLeft,
  MessageCircle,
  Brain,
  Wrench,
  Box,
  Cable,
  SquareTerminal,
  Send,
} from "lucide-react";
import { useNodes, useEdges, useReactFlow } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { RFNodeData, RFEdgeData } from "../../utils/graphTransformers";
import type { Node, Edge } from "@xyflow/react";
import type { PreconditionType } from "../../schemas/graph.schema";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NodePanelProps {
  nodeId: string;
  onNodeDeleted?: () => void;
  onNodeIdChanged?: (newId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

export function NodePanel({
  nodeId,
  onNodeDeleted,
  onNodeIdChanged,
  onSelectEdge,
  onSelectNode,
}: NodePanelProps) {
  const nodes = useNodes<Node<RFNodeData>>();
  const edges = useEdges<Edge<RFEdgeData>>();
  const { setNodes, setEdges } = useReactFlow();

  // Get incoming and outgoing edges
  const incomingEdges = edges.filter((e) => e.target === nodeId);
  const outgoingEdges = edges.filter((e) => e.source === nodeId);

  const node = nodes.find((n) => n.id === nodeId);
  const nodeData = node?.data;

  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  const [id, setId] = useState(node?.id ?? "");

  // Reset form when selecting a different node
  if (nodeId !== prevNodeId) {
    setPrevNodeId(nodeId);
    const currentNode = nodes.find((n) => n.id === nodeId);
    if (currentNode) {
      setId(currentNode.id);
    }
  }

  if (!node || !nodeData) {
    return <div className="p-4 text-muted-foreground">Node not found</div>;
  }

  const updateNodeData = (updates: Partial<RFNodeData>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n,
      ),
    );
  };

  const handleIdBlur = () => {
    if (id !== nodeId && id.trim()) {
      const newId = id.trim();
      // Rename node: update node id and all edges referencing it
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, id: newId, data: { ...n.data, nodeId: newId } }
            : n,
        ),
      );
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          id: e.id.replace(nodeId, newId),
          source: e.source === nodeId ? newId : e.source,
          target: e.target === nodeId ? newId : e.target,
        })),
      );
      // Notify parent of the ID change
      onNodeIdChanged?.(newId);
    }
  };

  const handleDelete = () => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
    );
    onNodeDeleted?.();
  };

  const getEdgeTypeIcon = (edge: Edge<RFEdgeData>) => {
    const iconClass = "h-3 w-3 mr-1";

    const preconditionType = edge.data?.preconditions?.[0]?.type as
      | PreconditionType
      | undefined;
    if (!preconditionType)
      return <Send className={`${iconClass} text-green-700`} />;

    switch (preconditionType) {
      case "user_said":
        return <MessageCircle className={`${iconClass} text-green-700`} />;
      case "agent_decision":
        return <Brain className={`${iconClass} text-purple-700`} />;
      case "tool_call":
        return <Wrench className={`${iconClass} text-orange-700`} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2 px-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Node Properties</h4>
          <div className="flex items-center">
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    className="text-muted-foreground"
                    variant="ghost"
                    size="icon"
                    title="View prompt"
                  >
                    <SquareTerminal />
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Node prompt</AlertDialogTitle>
                  <AlertDialogDescription>
                    Lorem ipsum dolor
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Close</AlertDialogCancel>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    title="Delete node"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete node?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    the node and remove all its connections.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={handleDelete}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <div className="space-y-2">
            <Label htmlFor="id">ID</Label>
            <Input
              id="id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              onBlur={handleIdBlur}
              placeholder="Node ID..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={nodeData.description}
              onChange={(e) => updateNodeData({ description: e.target.value })}
              rows={2}
              placeholder="Node description..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="text">Text</Label>
            <Textarea
              id="text"
              value={nodeData.text}
              onChange={(e) => updateNodeData({ text: e.target.value })}
              rows={3}
              placeholder="Node text..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="nextNodeIsUser"
                checked={nodeData.nextNodeIsUser ?? false}
                onCheckedChange={(checked) =>
                  updateNodeData({
                    nextNodeIsUser: checked === true || undefined,
                  })
                }
              />
              <Label htmlFor="nextNodeIsUser">
                Next node expects user input
              </Label>
            </div>
          </div>
        </div>

        <Separator />

        <div className="p-4">
          <Label className="text-sm font-semibold">Connections</Label>

          {incomingEdges.length === 0 && outgoingEdges.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">No connections</p>
          )}

          {incomingEdges.length > 0 && (
            <div className="mt-3">
              <div className="flex gap-1 items-center text-xs mb-1">
                Incoming
                <ArrowLeft className="h-3 w-3 mr-1" />
              </div>
              <div className="flex flex-col ml-1 gap-1">
                {incomingEdges.map((edge) => {
                  const value = edge.data?.preconditions?.[0]?.value;
                  return (
                    <div key={edge.id}>
                      <div className="w-full flex justify-between items-center text-xs gap-1 py-1">
                        <div className="flex flex-col">
                          <div className="flex items-center">
                            {getEdgeTypeIcon(edge)}
                            <span className="ml-0.5 text-[11px] truncate">
                              {edge.source}
                            </span>
                          </div>
                          {value && (
                            <div className="flex w-full gap-3 mt-1">
                              <div className="shrink-0 ml-1 w-[2px] bg-zinc-200 self-stretch"></div>
                              <div className="text-[10px] text-muted-foreground">
                                {value}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onSelectNode?.(edge.source)}
                                >
                                  <Box />
                                </Button>
                              }
                            ></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm">
                              Go to node
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onSelectEdge?.(edge.id)}
                                >
                                  <Cable />
                                </Button>
                              }
                            ></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm">
                              Go to edge
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {outgoingEdges.length > 0 && (
            <div className="mt-3">
              <div className="flex gap-1 items-center text-xs mb-1">
                Outgoing
                <ArrowRight className="h-3 w-3 mr-1" />
              </div>
              <div className="flex flex-col ml-1 gap-1">
                {outgoingEdges.map((edge) => {
                  const value = edge.data?.preconditions?.[0]?.value;
                  return (
                    <div key={edge.id}>
                      <div className="w-full flex justify-between items-center text-xs gap-1 py-1">
                        <div className="flex flex-col">
                          <div className="flex items-center">
                            {getEdgeTypeIcon(edge)}
                            <span className="ml-0.5 text-[11px] truncate">
                              {edge.target}
                            </span>
                          </div>
                          {value && (
                            <div className="flex w-full gap-3 mt-1">
                              <div className="shrink-0 ml-1 w-[2px] bg-zinc-200 self-stretch"></div>
                              <div className="text-[10px] text-muted-foreground">
                                {value}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onSelectNode?.(edge.target)}
                                >
                                  <Box />
                                </Button>
                              }
                            ></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm">
                              Go to node
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onSelectEdge?.(edge.id)}
                                >
                                  <Cable />
                                </Button>
                              }
                            ></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm">
                              Go to edge
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
