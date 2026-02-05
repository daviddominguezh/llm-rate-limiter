"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useStoreApi,
  addEdge,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nanoid } from "nanoid";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { layoutGraph } from "../utils/layoutGraph";

import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";
import { HandleContext } from "./nodes/HandleContext";
import { Toolbar } from "./panels/Toolbar";
import { NodePanel } from "./panels/NodePanel";
import { EdgePanel } from "./panels/EdgePanel";
import { ConnectionMenu } from "./panels/ConnectionMenu";
import { GraphSchema, type Agent } from "../schemas/graph.schema";
import {
  GRAPH_DATA,
  processGraph,
  findInitialNodePosition,
  calculateInitialViewport,
} from "../utils/loadGraphData";
import {
  schemaNodeToRFNode,
  schemaEdgeToRFEdge,
  rfEdgeToSchemaEdge,
  type RFNodeData,
  type RFEdgeData,
} from "../utils/graphTransformers";

const MIN_DISTANCE = 150;
const START_NODE_ID = "INITIAL_STEP";
const DEFAULT_FIRST_NODE_ID = "first_node";
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 220;
const START_NODE_WIDTH = 100;
const START_NODE_HEIGHT = 44;
const NODE_GAP = 100;

// Default start node for blank canvas
const defaultStartNode: Node<RFNodeData> = {
  id: START_NODE_ID,
  type: "start",
  position: { x: -50, y: 200 },
  selectable: false,
  draggable: false,
  data: {
    nodeId: START_NODE_ID,
    text: "",
    description: "",
  },
};

// Default first node connected to start
const defaultFirstNode: Node<RFNodeData> = {
  id: DEFAULT_FIRST_NODE_ID,
  type: "agent",
  position: {
    x: defaultStartNode.position.x + START_NODE_WIDTH + NODE_GAP,
    y:
      defaultStartNode.position.y +
      START_NODE_HEIGHT / 2 -
      DEFAULT_NODE_HEIGHT / 2,
  },
  data: {
    nodeId: DEFAULT_FIRST_NODE_ID,
    text: "New node",
    description: "Node description",
    nodeWidth: DEFAULT_NODE_WIDTH,
  },
};

// Default edge from start to first node with user_said "hello"
const defaultStartEdge: Edge<RFEdgeData> = {
  id: `${START_NODE_ID}-${DEFAULT_FIRST_NODE_ID}`,
  source: START_NODE_ID,
  target: DEFAULT_FIRST_NODE_ID,
  sourceHandle: "right-source",
  targetHandle: "left-target",
  type: "precondition",
  data: {
    preconditions: [
      {
        type: "user_said",
        value: "Hello",
        description: "User greeting",
      },
    ],
  },
};

// Initialize nodes and edges from graph data
function createInitialNodes(): Node<RFNodeData>[] {
  if (!GRAPH_DATA) return [defaultStartNode, defaultFirstNode];
  const { graph, nodeWidth } = GRAPH_DATA;
  return graph.nodes.map((n, i) => {
    const baseNode = schemaNodeToRFNode(n, i);
    const isStartNode = n.id === START_NODE_ID;
    return {
      ...baseNode,
      type: isStartNode ? "start" : baseNode.type,
      selectable: !isStartNode,
      draggable: false,
      data: {
        ...baseNode.data,
        nodeWidth,
      },
    };
  });
}

function createInitialEdges(): Edge<RFEdgeData>[] {
  if (!GRAPH_DATA) return [defaultStartEdge];
  const { graph } = GRAPH_DATA;
  return graph.edges.map((e, i) => schemaEdgeToRFEdge(e, i, graph.nodes));
}

const initialNodes = createInitialNodes();
const initialEdges = createInitialEdges();

function GraphBuilderInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const store = useStoreApi();
  const {
    screenToFlowPosition,
    fitView,
    getInternalNode,
    setViewport,
    getViewport,
  } = useReactFlow();

  // React Flow as source of truth
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Local UI state
  const [tempEdge, setTempEdge] = useState<Edge | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [agents] = useState<Agent[]>(GRAPH_DATA?.graph.agents ?? []);

  // Connection menu state
  const [connectionMenu, setConnectionMenu] = useState<{
    position: { x: number; y: number };
    sourceNodeId: string;
    sourceHandleId: string | null;
  } | null>(null);

  // Zoom view state
  const [zoomViewNodeId, setZoomViewNodeId] = useState<string | null>(null);
  const [savedGraphState, setSavedGraphState] = useState<{
    nodes: Node<RFNodeData>[];
    edges: Edge<RFEdgeData>[];
    viewport: { x: number; y: number; zoom: number };
  } | null>(null);

  // Set initial viewport to center start node vertically
  useEffect(() => {
    if (!reactFlowWrapper.current) return;

    const initialPos = GRAPH_DATA
      ? findInitialNodePosition(GRAPH_DATA.graph)
      : defaultStartNode.position;

    if (initialPos) {
      const containerHeight = reactFlowWrapper.current.clientHeight;
      const viewport = calculateInitialViewport(initialPos, containerHeight);
      setViewport(viewport);
    }
  }, [setViewport]);

  const onConnect = useCallback(
    (params: Connection) => {
      // Prevent connecting to the start node
      if (params.target === START_NODE_ID) return;
      setEdges((eds) => addEdge({ ...params, type: "precondition" }, eds));
      setConnectionMenu(null);
    },
    [setEdges],
  );

  // Handle click on source handle to show connection menu
  const onSourceHandleClick = useCallback(
    (nodeId: string, handleId: string, event: React.MouseEvent) => {
      // Start node can only have 1 connection
      if (nodeId === START_NODE_ID) {
        const hasConnection = edges.some((e) => e.source === START_NODE_ID);
        if (hasConnection) {
          return; // Don't allow more connections from start
        }
      }

      const rect = (event.target as HTMLElement).getBoundingClientRect();
      setConnectionMenu({
        position: { x: rect.right + 10, y: rect.top },
        sourceNodeId: nodeId,
        sourceHandleId: handleId,
      });
    },
    [edges],
  );

  const handleConnectionMenuSelectNode = useCallback(
    (targetNodeId: string) => {
      if (!connectionMenu) return;

      setEdges((eds) =>
        addEdge(
          {
            source: connectionMenu.sourceNodeId,
            target: targetNodeId,
            sourceHandle: connectionMenu.sourceHandleId,
            targetHandle: "left-target",
            type: "precondition",
          },
          eds,
        ),
      );
      setConnectionMenu(null);
    },
    [connectionMenu, setEdges],
  );

  const handleConnectionMenuCreateNode = useCallback(() => {
    if (!connectionMenu) return;

    const id = `node_${nanoid(8)}`;
    const NODE_WIDTH = GRAPH_DATA?.nodeWidth ?? 180;
    const NODE_HEIGHT = 220;

    // Find the source node to position relative to it
    const sourceNode = nodes.find((n) => n.id === connectionMenu.sourceNodeId);
    const isStartNode = sourceNode?.type === "start";
    const sourceNodeWidth = isStartNode
      ? START_NODE_WIDTH
      : ((sourceNode?.data as RFNodeData)?.nodeWidth ?? NODE_WIDTH);
    const sourceNodeHeight = isStartNode ? START_NODE_HEIGHT : NODE_HEIGHT;

    // Position new node based on which handle was clicked
    let newPosition: { x: number; y: number };

    if (!sourceNode) {
      const flowPos = screenToFlowPosition(connectionMenu.position);
      newPosition = { x: flowPos.x, y: flowPos.y };
    } else if (connectionMenu.sourceHandleId === "top-source") {
      // NODE_GAP above, horizontally centered
      newPosition = {
        x: sourceNode.position.x + sourceNodeWidth / 2 - NODE_WIDTH / 2,
        y: sourceNode.position.y - NODE_HEIGHT - NODE_GAP,
      };
    } else if (connectionMenu.sourceHandleId === "bottom-source") {
      // NODE_GAP below, horizontally centered
      newPosition = {
        x: sourceNode.position.x + sourceNodeWidth / 2 - NODE_WIDTH / 2,
        y: sourceNode.position.y + sourceNodeHeight + NODE_GAP,
      };
    } else {
      // right-source (default): NODE_GAP to the right, vertically centered
      newPosition = {
        x: sourceNode.position.x + sourceNodeWidth + NODE_GAP,
        y: sourceNode.position.y + sourceNodeHeight / 2 - NODE_HEIGHT / 2,
      };
    }

    // Determine target handle based on source handle
    let targetHandle: string;
    if (connectionMenu.sourceHandleId === "top-source") {
      targetHandle = "bottom-target";
    } else if (connectionMenu.sourceHandleId === "bottom-source") {
      targetHandle = "top-target";
    } else {
      targetHandle = "left-target";
    }

    const newNode: Node<RFNodeData> = {
      id,
      type: "agent",
      position: newPosition,
      data: {
        nodeId: id,
        text: "New node",
        description: "Node description",
        nodeWidth: NODE_WIDTH,
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) =>
      addEdge(
        {
          source: connectionMenu.sourceNodeId,
          target: id,
          sourceHandle: connectionMenu.sourceHandleId,
          targetHandle,
          type: "precondition",
        },
        eds,
      ),
    );
    setConnectionMenu(null);
    setSelectedNodeId(id);
  }, [connectionMenu, nodes, screenToFlowPosition, setNodes, setEdges]);

  const handleConnectionMenuClose = useCallback(() => {
    setConnectionMenu(null);
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    // Don't select the start node
    if (node.id === START_NODE_ID) return;
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectionMenu(null);
  }, []);

  const getClosestEdge = useCallback(
    (node: Node) => {
      const { nodeLookup } = store.getState();
      const internalNode = getInternalNode(node.id);
      if (!internalNode) return null;

      const closestNode = Array.from(nodeLookup.values()).reduce(
        (res: { distance: number; node: typeof internalNode | null }, n) => {
          // Skip self and start node (start node cannot be a target)
          if (n.id !== internalNode.id && n.id !== START_NODE_ID) {
            const dx =
              n.internals.positionAbsolute.x -
              internalNode.internals.positionAbsolute.x;
            const dy =
              n.internals.positionAbsolute.y -
              internalNode.internals.positionAbsolute.y;
            const d = Math.sqrt(dx * dx + dy * dy);

            if (d < res.distance && d < MIN_DISTANCE) {
              res.distance = d;
              res.node = n;
            }
          }
          return res;
        },
        { distance: Number.MAX_VALUE, node: null },
      );

      if (!closestNode.node) {
        return null;
      }

      const closeNodeIsSource =
        closestNode.node.internals.positionAbsolute.x <
        internalNode.internals.positionAbsolute.x;

      // Determine source and target
      const source = closeNodeIsSource ? closestNode.node.id : node.id;
      const target = closeNodeIsSource ? node.id : closestNode.node.id;

      // Prevent start node from being a target
      if (target === START_NODE_ID) return null;

      return {
        id: `${source}-${target}`,
        source,
        target,
      };
    },
    [store, getInternalNode],
  );

  const onNodeDrag = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const closeEdge = getClosestEdge(node);

      if (closeEdge) {
        const edgeExists = edges.some(
          (e) => e.source === closeEdge.source && e.target === closeEdge.target,
        );
        if (!edgeExists) {
          setTempEdge({ ...closeEdge, className: "temp opacity-50" });
        } else {
          setTempEdge(null);
        }
      } else {
        setTempEdge(null);
      }
    },
    [getClosestEdge, edges],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const closeEdge = getClosestEdge(node);
      setTempEdge(null);

      if (closeEdge) {
        const edgeExists = edges.some(
          (e) => e.source === closeEdge.source && e.target === closeEdge.target,
        );
        if (!edgeExists) {
          setEdges((eds) =>
            addEdge({ ...closeEdge, type: "precondition" }, eds),
          );
        }
      }
    },
    [getClosestEdge, edges, setEdges],
  );

  const handleAddNode = useCallback(() => {
    const id = `node_${nanoid(8)}`;
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const screenCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height * 0.3,
    };
    const position = screenToFlowPosition(screenCenter);
    const NODE_WIDTH = 180;
    const NODE_HEIGHT = 60;
    const centeredPosition = {
      x: position.x - NODE_WIDTH / 2,
      y: position.y - NODE_HEIGHT / 2,
    };

    const newNode: Node<RFNodeData> = {
      id,
      type: "agent",
      position: centeredPosition,
      data: {
        nodeId: id,
        text: "New node",
        description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        nodeWidth: GRAPH_DATA?.nodeWidth ?? 180,
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(id);
  }, [screenToFlowPosition, setNodes]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const result = GraphSchema.safeParse(json);
        if (result.success) {
          // Process graph with layout (same as hardcoded load)
          const { graph, nodeWidth } = processGraph(result.data);

          const newNodes = graph.nodes.map((n, i) => {
            const baseNode = schemaNodeToRFNode(n, i);
            const isStartNode = n.id === START_NODE_ID;
            return {
              ...baseNode,
              type: isStartNode ? "start" : baseNode.type,
              selectable: !isStartNode,
              draggable: false,
              data: {
                ...baseNode.data,
                nodeWidth,
              },
            };
          });
          const newEdges = graph.edges.map((e, i) =>
            schemaEdgeToRFEdge(e, i, graph.nodes),
          );
          setNodes(newNodes);
          setEdges(newEdges);

          // Set viewport to center INITIAL_STEP
          setTimeout(() => {
            if (!reactFlowWrapper.current) return;
            const initialPos = findInitialNodePosition(graph);
            if (initialPos) {
              const containerHeight = reactFlowWrapper.current.clientHeight;
              const viewport = calculateInitialViewport(
                initialPos,
                containerHeight,
              );
              setViewport(viewport);
            }
          }, 50);
        } else {
          alert("Invalid graph file: " + result.error.message);
        }
      } catch {
        alert("Failed to parse JSON file");
      }
    };
    input.click();
  }, [setNodes, setEdges, setViewport]);

  const handleExport = useCallback(() => {
    const graph = {
      startNode: START_NODE_ID,
      agents,
      nodes: nodes.map((n) => ({
        id: n.id,
        text: (n.data as RFNodeData).text,
        // Start node exports as "agent" kind for schema compatibility
        kind: (n.type === "start" ? "agent" : n.type) as
          | "agent"
          | "agent_decision",
        description: (n.data as RFNodeData).description,
        agent: (n.data as RFNodeData).agent,
        nextNodeIsUser: (n.data as RFNodeData).nextNodeIsUser,
        position: n.position,
      })),
      edges: edges.map((e) => rfEdgeToSchemaEdge(e)),
    };

    const result = GraphSchema.safeParse(graph);
    if (!result.success) {
      alert("Graph has validation errors. Please fix before exporting.");
      return;
    }
    const json = JSON.stringify(graph, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "graph.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, agents]);

  // Zoom view handlers
  const handleZoomToNode = useCallback(
    (nodeId: string) => {
      // Use original state if already in zoom view, otherwise use current state
      const sourceNodes = savedGraphState?.nodes ?? nodes;
      const sourceEdges = savedGraphState?.edges ?? edges;

      // Only save state if not already in zoom view
      if (!savedGraphState) {
        setSavedGraphState({
          nodes: [...nodes],
          edges: [...edges],
          viewport: getViewport(),
        });
      }

      // Find connected edges from the source (original) state
      const connectedEdges = sourceEdges.filter(
        (e) => e.source === nodeId || e.target === nodeId,
      );

      // Find connected node IDs
      const connectedNodeIds = new Set([
        nodeId,
        ...connectedEdges.map((e) => e.source),
        ...connectedEdges.map((e) => e.target),
      ]);

      // Filter nodes from the source (original) state
      const filteredNodes = sourceNodes.filter((n) =>
        connectedNodeIds.has(n.id),
      );

      // Calculate node dimensions for layout
      const nodeDimensions: Record<string, { width: number; height: number }> =
        {};
      filteredNodes.forEach((n) => {
        const isStart = n.type === "start";
        nodeDimensions[n.id] = {
          width: isStart
            ? START_NODE_WIDTH
            : ((n.data as RFNodeData).nodeWidth ?? DEFAULT_NODE_WIDTH),
          height: isStart ? START_NODE_HEIGHT : DEFAULT_NODE_HEIGHT,
        };
      });

      // Prepare nodes for layoutGraph (schema format)
      const schemaNodes = filteredNodes.map((n) => ({
        id: n.id,
        text: (n.data as RFNodeData).text,
        description: (n.data as RFNodeData).description,
        kind: "agent" as const,
      }));

      // Prepare edges for layoutGraph (schema format with from/to)
      const schemaEdges = connectedEdges.map((e) => ({
        from: e.source,
        to: e.target,
      }));

      // Recalculate positions
      const layoutResult = layoutGraph(schemaNodes, schemaEdges, {
        rankdir: "LR",
        horizontalSpacing: 250,
        verticalSpacing: 100,
        nodeDimensions,
      });

      // Apply new positions to filtered nodes
      const repositionedNodes = filteredNodes.map((n) => {
        const newPos = layoutResult.nodes.find(
          (ln) => ln.id === n.id,
        )?.position;
        return newPos ? { ...n, position: newPos } : n;
      });

      // Clear selection
      setSelectedNodeId(null);
      setSelectedEdgeId(null);

      // Update state (clear selection on nodes/edges too)
      setNodes(repositionedNodes.map((n) => ({ ...n, selected: false })));
      setEdges(connectedEdges.map((e) => ({ ...e, selected: false })));
      setZoomViewNodeId(nodeId);

      // Fit viewport after a short delay
      setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50);
    },
    [nodes, edges, savedGraphState, getViewport, setNodes, setEdges, fitView],
  );

  const handleExitZoomView = useCallback(() => {
    if (savedGraphState) {
      setNodes(savedGraphState.nodes);
      setEdges(savedGraphState.edges);
      setViewport(savedGraphState.viewport, { duration: 300 });
      setSavedGraphState(null);
      setZoomViewNodeId(null);
    }
  }, [savedGraphState, setNodes, setEdges, setViewport]);

  // Combine edges with temp edge for display
  const displayEdges = tempEdge ? [...edges, tempEdge] : edges;

  const handleContextValue = {
    onSourceHandleClick,
    onZoomToNode: handleZoomToNode,
  };

  return (
    <HandleContext.Provider value={handleContextValue}>
      <div className="flex h-screen w-screen flex-col items-center">
        <Toolbar
          onAddNode={handleAddNode}
          onImport={handleImport}
          onExport={handleExport}
        />

        <div className="h-screen w-screen relative flex-1 overflow-hidden">
          <main ref={reactFlowWrapper} className="absolute inset-0">
            <ReactFlow
              nodes={nodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            >
              <Background />
              <Controls />
              <MiniMap
                nodeStrokeWidth={3}
                nodeColor={(node) => {
                  if (node.id === START_NODE_ID) return "#22c55e";
                  return "#e2e8f0";
                }}
                maskColor="rgba(0, 0, 0, 0.1)"
              />
            </ReactFlow>

            {zoomViewNodeId && (
              <div className="absolute top-4 left-4 z-10">
                <Button variant="secondary" onClick={handleExitZoomView}>
                  <X className="h-3 w-3" />
                  Quit zoom view
                </Button>
              </div>
            )}
          </main>

          {(selectedNodeId || selectedEdgeId) && (
            <aside className="absolute right-0 top-0 bottom-0 w-80 border-l border-gray-200 bg-white">
              {selectedNodeId && (
                <NodePanel
                  nodeId={selectedNodeId}
                  onNodeDeleted={() => setSelectedNodeId(null)}
                  onNodeIdChanged={(newId) => setSelectedNodeId(newId)}
                  onSelectEdge={(edgeId) => {
                    // Update React Flow selection state
                    setNodes((nds) =>
                      nds.map((n) => ({ ...n, selected: false })),
                    );
                    setEdges((eds) =>
                      eds.map((e) => ({ ...e, selected: e.id === edgeId })),
                    );
                    setSelectedEdgeId(edgeId);
                    setSelectedNodeId(null);
                  }}
                  onSelectNode={(targetNodeId) => {
                    const node = nodes.find((n) => n.id === targetNodeId);
                    if (node && reactFlowWrapper.current) {
                      const nodeData = node.data as RFNodeData;
                      const nodeWidth = nodeData.nodeWidth ?? 180;
                      const nodeHeight =
                        node.type === "start"
                          ? START_NODE_HEIGHT
                          : DEFAULT_NODE_HEIGHT;
                      const { zoom } = getViewport();
                      const { width, height } =
                        reactFlowWrapper.current.getBoundingClientRect();

                      const nodeCenterX = node.position.x + nodeWidth / 2;
                      const nodeCenterY = node.position.y + nodeHeight / 2;

                      setViewport(
                        {
                          x: width / 2 - nodeCenterX * zoom,
                          y: height / 2 - nodeCenterY * zoom,
                          zoom,
                        },
                        { duration: 300 },
                      );
                    }
                    // Update React Flow selection state
                    setNodes((nds) =>
                      nds.map((n) => ({
                        ...n,
                        selected: n.id === targetNodeId,
                      })),
                    );
                    setEdges((eds) =>
                      eds.map((e) => ({ ...e, selected: false })),
                    );
                    setSelectedNodeId(targetNodeId);
                  }}
                />
              )}
              {selectedEdgeId && (
                <EdgePanel
                  edgeId={selectedEdgeId}
                  onEdgeDeleted={() => setSelectedEdgeId(null)}
                  onSelectNode={(nodeId) => {
                    const node = nodes.find((n) => n.id === nodeId);
                    if (node && reactFlowWrapper.current) {
                      const nodeData = node.data as RFNodeData;
                      const nodeWidth = nodeData.nodeWidth ?? 180;
                      const nodeHeight =
                        node.type === "start"
                          ? START_NODE_HEIGHT
                          : DEFAULT_NODE_HEIGHT;
                      const { zoom } = getViewport();
                      const { width, height } =
                        reactFlowWrapper.current.getBoundingClientRect();

                      // Calculate node center
                      const nodeCenterX = node.position.x + nodeWidth / 2;
                      const nodeCenterY = node.position.y + nodeHeight / 2;

                      // Calculate viewport position to center the node
                      setViewport(
                        {
                          x: width / 2 - nodeCenterX * zoom,
                          y: height / 2 - nodeCenterY * zoom,
                          zoom,
                        },
                        { duration: 300 },
                      );
                    }
                    // Update React Flow selection state
                    setNodes((nds) =>
                      nds.map((n) => ({ ...n, selected: n.id === nodeId })),
                    );
                    setEdges((eds) =>
                      eds.map((e) => ({ ...e, selected: false })),
                    );
                    setSelectedNodeId(nodeId);
                    setSelectedEdgeId(null);
                  }}
                />
              )}
            </aside>
          )}

          {connectionMenu && (
            <ConnectionMenu
              position={connectionMenu.position}
              sourceNodeId={connectionMenu.sourceNodeId}
              sourceHandleId={connectionMenu.sourceHandleId}
              nodes={nodes.map((n) => ({
                id: n.id,
                text: (n.data as RFNodeData).text,
              }))}
              onSelectNode={handleConnectionMenuSelectNode}
              onCreateNode={handleConnectionMenuCreateNode}
              onClose={handleConnectionMenuClose}
            />
          )}
        </div>
      </div>
    </HandleContext.Provider>
  );
}

export function GraphBuilder() {
  return (
    <ReactFlowProvider>
      <GraphBuilderInner />
    </ReactFlowProvider>
  );
}
