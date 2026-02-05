"use client";

import { useState } from "react";
import {
  Trash2,
  Plus,
  Info,
  MessageCircle,
  Brain,
  Wrench,
  Pencil,
} from "lucide-react";
import { useEdges, useReactFlow } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Card } from "@/components/ui/card";
import type {
  Precondition,
  PreconditionType,
} from "../../schemas/graph.schema";
import type { RFEdgeData } from "../../utils/graphTransformers";
import type { Edge } from "@xyflow/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const START_NODE_ID = "INITIAL_STEP";

interface EdgePanelProps {
  edgeId: string;
  onEdgeDeleted?: () => void;
  onSelectNode?: (nodeId: string) => void;
}

interface EdgePreconditionInput {
  value: string;
  description: string;
}

export function EdgePanel({
  edgeId,
  onEdgeDeleted,
  onSelectNode,
}: EdgePanelProps) {
  const edges = useEdges<Edge<RFEdgeData>>();
  const { setEdges } = useReactFlow();

  // Find edge by ID
  const edge = edges.find((e) => e.id === edgeId);
  const from = edge?.source ?? "";
  const to = edge?.target ?? "";
  const edgeData = edge?.data;

  const [prevEdgeId, setPrevEdgeId] = useState(edgeId);
  const [preconditions, setPreconditions] = useState<Precondition[]>(
    edgeData?.preconditions ?? [],
  );
  const [isAddingPrecondition, setIsAddingPrecondition] = useState(false);
  const [newPreconditionType, setNewPreconditionType] =
    useState<PreconditionType>("user_said");
  const [newPreconditionValue, setNewPreconditionValue] = useState("");
  const [newPreconditionDescription, setNewPreconditionDescription] =
    useState("");
  const [showTypeChangeConfirm, setShowTypeChangeConfirm] = useState(false);
  const [editingPreconditionIndex, setEditingPreconditionIndex] = useState<
    number | null
  >(null);
  const [editingPreconditionValue, setEditingPreconditionValue] = useState("");
  const [editingPreconditionDescription, setEditingPreconditionDescription] =
    useState("");
  const [editingPreconditionType, setEditingPreconditionType] =
    useState<PreconditionType>("user_said");
  const [showEditModal, setShowEditModal] = useState(false);

  // State for multi-edge precondition inputs (keyed by edge ID)
  const [multiEdgeInputs, setMultiEdgeInputs] = useState<
    Record<string, EdgePreconditionInput>
  >({});

  // Reset form when selecting a different edge
  if (edgeId !== prevEdgeId) {
    setPrevEdgeId(edgeId);
    if (edge?.data) {
      setPreconditions(edge.data.preconditions ?? []);
    }
  }

  if (!edge) {
    return <div className="p-4 text-muted-foreground">Edge not found</div>;
  }

  const existingType = preconditions.length > 0 ? preconditions[0].type : null;
  const isFromStartNode = from === START_NODE_ID;

  // Find other edges from the same source
  const siblingEdges = edges.filter(
    (e) => e.source === from && e.id !== edge.id,
  );

  // All edges from same source (current + siblings)
  const allSourceEdges = [edge, ...siblingEdges];

  const updateEdgeData = (updates: Partial<RFEdgeData>) => {
    setEdges((eds) =>
      eds.map((e) =>
        e.id === edge.id ? { ...e, data: { ...e.data, ...updates } } : e,
      ),
    );
  };

  const doAddPrecondition = () => {
    if (newPreconditionValue.trim()) {
      const newPrecondition: Precondition = {
        type: existingType ?? newPreconditionType,
        value: newPreconditionValue.trim(),
        description: newPreconditionDescription.trim() || undefined,
      };
      const newPreconditions = [...preconditions, newPrecondition];
      setPreconditions(newPreconditions);
      updateEdgeData({ preconditions: newPreconditions });
      setNewPreconditionValue("");
      setNewPreconditionDescription("");
      setIsAddingPrecondition(false);
    }
  };

  const handleAddPrecondition = () => {
    doAddPrecondition();
  };

  const handleEditPrecondition = (index: number) => {
    setEditingPreconditionIndex(index);
    setEditingPreconditionValue(preconditions[index].value);
    setEditingPreconditionDescription(preconditions[index].description ?? "");
    setEditingPreconditionType(preconditions[index].type);
    setShowEditModal(true);
  };

  const handleSaveEditedPrecondition = () => {
    if (editingPreconditionIndex === null) return;
    if (!editingPreconditionValue.trim()) return;

    const canChangeType = siblingEdges.length === 0;

    const updatedPreconditions = preconditions.map((p, i) =>
      i === editingPreconditionIndex
        ? {
            ...p,
            type: canChangeType ? editingPreconditionType : p.type,
            value: editingPreconditionValue.trim(),
            description: editingPreconditionDescription.trim() || undefined,
          }
        : p,
    );
    setPreconditions(updatedPreconditions);
    updateEdgeData({ preconditions: updatedPreconditions });
    handleCancelEdit();
  };

  const handleCancelEdit = () => {
    setEditingPreconditionIndex(null);
    setEditingPreconditionValue("");
    setEditingPreconditionDescription("");
    setEditingPreconditionType("user_said");
    setShowEditModal(false);
  };

  const initializeMultiEdgeInputs = () => {
    const inputs: Record<string, EdgePreconditionInput> = {};
    for (const e of allSourceEdges) {
      inputs[e.id] = { value: "", description: "" };
    }
    setMultiEdgeInputs(inputs);
  };

  const handleConfirmTypeChange = () => {
    // Add preconditions to all edges from the same source
    setEdges((eds) =>
      eds.map((e) => {
        const input = multiEdgeInputs[e.id];
        if (input && input.value.trim()) {
          const newPrecondition: Precondition = {
            type: newPreconditionType,
            value: input.value.trim(),
            description: input.description.trim(),
          };
          const existingPreconditions =
            (e.data?.preconditions as Precondition[] | undefined) ?? [];
          return {
            ...e,
            data: {
              ...e.data,
              preconditions: [...existingPreconditions, newPrecondition],
            },
          };
        }
        return e;
      }),
    );

    // Update local state for current edge
    const currentInput = multiEdgeInputs[edge.id];
    if (currentInput && currentInput.value.trim()) {
      const newPrecondition: Precondition = {
        type: newPreconditionType,
        value: currentInput.value.trim(),
        description: currentInput.description.trim(),
      };
      setPreconditions([...preconditions, newPrecondition]);
    }

    setShowTypeChangeConfirm(false);
    setMultiEdgeInputs({});
  };

  const handleDeleteEdge = () => {
    setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    onEdgeDeleted?.();
  };

  const getTypeColor = (type: PreconditionType) => {
    switch (type) {
      case "user_said":
        return "text-green-700";
      case "agent_decision":
        return "text-purple-700";
      case "tool_call":
        return "text-orange-700";
    }
  };

  const getTypeIcon = (type: PreconditionType) => {
    const iconStyle = `w-3 h-3 ${getTypeColor(type)}`;
    switch (type) {
      case "user_said":
        return <MessageCircle className={iconStyle} />;
      case "agent_decision":
        return <Brain className={iconStyle} />;
      case "tool_call":
        return <Wrench className={iconStyle} />;
    }
  };

  const getTypeBackgroundColor = (type: PreconditionType) => {
    switch (type) {
      case "user_said":
        return "bg-green-100";
      case "agent_decision":
        return "bg-purple-100";
      case "tool_call":
        return "bg-orange-100";
    }
  };

  const updateMultiEdgeInput = (
    edgeId: string,
    field: keyof EdgePreconditionInput,
    value: string,
  ) => {
    setMultiEdgeInputs((prev) => ({
      ...prev,
      [edgeId]: {
        ...prev[edgeId],
        [field]: value,
      },
    }));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2 px-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Edge Properties</h4>
          <AlertDialog>
            <AlertDialogTrigger
              className={!isFromStartNode ? "visible" : "invisible"}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete edge"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete edge?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the
                  edge.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleDeleteEdge}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="p-3">
        <div className="flex flex-col text-xs leading-none font-medium">
          <span className="flex gap-1 text-xs text-muted-foreground">
            <span className="w-[50px]">From:</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-medium"
              onClick={() => onSelectNode?.(from)}
            >
              {from}
            </Button>
          </span>

          <span className="flex gap-1  text-xs text-muted-foreground">
            <span className="w-[50px]">To:</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-medium"
              onClick={() => onSelectNode?.(to)}
            >
              {to}
            </Button>
          </span>
        </div>
        {existingType && (
          <div className="mt-2">
            <Alert className="flex gap-1">
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 text-muted-foreground!" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm">
                  To change the edge type, the source node must have 1 or fewer
                  edges
                </TooltipContent>
              </Tooltip>

              <AlertDescription>
                <div className="text-xs text-muted-foreground mt-[1px]">
                  Edges are locked to:{" "}
                  <span
                    className={`rounded px-1 py-0.5 ${getTypeColor(existingType)} ${getTypeBackgroundColor(existingType)}`}
                  >
                    {existingType}
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Precondition</Label>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  // If there are sibling edges and no existing type, show modal with form
                  if (!existingType && siblingEdges.length > 0) {
                    initializeMultiEdgeInputs();
                    setShowTypeChangeConfirm(true);
                  } else {
                    setIsAddingPrecondition(true);
                  }
                }}
                className={`h-6 w-6 ${preconditions.length === 0 ? "visible" : "invisible"}`}
                title="Add precondition"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-col gap-2 mt-2">
              {preconditions.map((p, index) => (
                <Card key={index} className="p-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div
                          className={`flex items-center gap-1 leading-none rounded text-[10px] font-semibold ${getTypeColor(p.type)}`}
                        >
                          {getTypeIcon(p.type)}
                          <div className="mt-[1px]">
                            {p.type.toUpperCase()}:
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          onClick={() => handleEditPrecondition(index)}
                          title="Edit precondition"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="flex text-sm items-center gap-1 bg-muted rounded-md p-2">
                        {p.type === "user_said" && "\u201C"}
                        <div className="text-gray-600 text-[13px]">
                          {p.value}
                        </div>
                        {p.type === "user_said" && "\u201D"}
                      </div>

                      {p.description && (
                        <div className="flex w-full gap-1">
                          <div className="ml-0.5 w-[2px] bg-zinc-200 self-stretch"></div>
                          <div className="text-xs text-muted-foreground">
                            {p.description}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}

              {preconditions.length === 0 && !isAddingPrecondition && (
                <Alert>
                  <Info className="h-3 w-3 text-muted-foreground!" />
                  <AlertDescription>
                    <div className="text-xs text-muted-foreground mt-[1px]">
                      No preconditions
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {isAddingPrecondition && (
                <Card className="p-3 mt-1 shadow-lg">
                  <div className="flex flex-col gap-2">
                    {!existingType && (
                      <div className="flex gap-2">
                        <Label className="text-xs">Type:</Label>
                        <Select
                          value={newPreconditionType}
                          onValueChange={(value) => {
                            if (value)
                              setNewPreconditionType(value as PreconditionType);
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="p-1">
                            <SelectItem value="user_said">user_said</SelectItem>
                            <SelectItem value="agent_decision">
                              agent_decision
                            </SelectItem>
                            <SelectItem value="tool_call">tool_call</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Value</Label>
                      <Textarea
                        value={newPreconditionValue}
                        onChange={(e) =>
                          setNewPreconditionValue(e.target.value)
                        }
                        placeholder="Precondition value..."
                        rows={2}
                        className="text-xs"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description (optional)</Label>
                      <Input
                        value={newPreconditionDescription}
                        onChange={(e) =>
                          setNewPreconditionDescription(e.target.value)
                        }
                        placeholder="Description..."
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddingPrecondition(false)}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleAddPrecondition}>
                        Add
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation modal for type change affecting sibling edges */}
      <AlertDialog
        open={showTypeChangeConfirm}
        onOpenChange={setShowTypeChangeConfirm}
      >
        <AlertDialogContent
          className="max-h-[80vh] overflow-hidden flex flex-col"
          style={{ maxWidth: "36rem" }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Set preconditions for all edges</AlertDialogTitle>
            <AlertDialogDescription>
              All edges from <strong>{from}</strong> will share the same
              precondition type. Set the value for each edge below.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex space-y-2 border-b pb-4 gap-2">
            <Label className="text-xs shrink-0">
              Precondition type (shared)
            </Label>
            <Select
              value={newPreconditionType}
              onValueChange={(value) => {
                if (value) setNewPreconditionType(value as PreconditionType);
              }}
            >
              <SelectTrigger className="text-xs w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="p-1">
                <SelectItem value="user_said">user_said</SelectItem>
                <SelectItem value="agent_decision">agent_decision</SelectItem>
                <SelectItem value="tool_call">tool_call</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 py-4 px-0.5">
            {allSourceEdges.map((e) => (
              <Card key={e.id} className="p-3">
                <p className="text-sm font-medium mb-2">
                  {e.source} → {e.target}
                </p>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Value</Label>
                    <Input
                      value={multiEdgeInputs[e.id]?.value ?? ""}
                      onChange={(ev) =>
                        updateMultiEdgeInput(e.id, "value", ev.target.value)
                      }
                      placeholder="Precondition value..."
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={multiEdgeInputs[e.id]?.description ?? ""}
                      onChange={(ev) =>
                        updateMultiEdgeInput(
                          e.id,
                          "description",
                          ev.target.value,
                        )
                      }
                      placeholder="Description..."
                      rows={2}
                      className="text-xs"
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmTypeChange}
              disabled={
                !allSourceEdges.every((e) =>
                  multiEdgeInputs[e.id]?.value.trim(),
                )
              }
            >
              Add Preconditions
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit precondition modal */}
      <AlertDialog open={showEditModal} onOpenChange={setShowEditModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Precondition</AlertDialogTitle>
            <AlertDialogDescription>
              Modify the precondition value and description.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {siblingEdges.length === 0 && (
              <div className="space-y-2 flex gap-2">
                <Label>Type</Label>
                <Select
                  value={editingPreconditionType}
                  onValueChange={(value) => {
                    if (value)
                      setEditingPreconditionType(value as PreconditionType);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user_said">user_said</SelectItem>
                    <SelectItem value="agent_decision">
                      agent_decision
                    </SelectItem>
                    <SelectItem value="tool_call">tool_call</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-value">Value</Label>
              <Textarea
                id="edit-value"
                value={editingPreconditionValue}
                onChange={(e) => setEditingPreconditionValue(e.target.value)}
                placeholder="Precondition value..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description (optional)</Label>
              <Textarea
                id="edit-description"
                value={editingPreconditionDescription}
                onChange={(e) =>
                  setEditingPreconditionDescription(e.target.value)
                }
                placeholder="Description..."
                rows={2}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelEdit}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSaveEditedPrecondition}
              disabled={!editingPreconditionValue.trim()}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
