import { z } from "zod";

export const AgentSchema = z.object({
  id: z.string(),
  description: z.string(),
});

export const NodeKindSchema = z.enum(["agent", "agent_decision"]);

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const NodeSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: NodeKindSchema,
  description: z.string().default(""),
  agent: z.string().optional(),
  nextNodeIsUser: z.boolean().optional(),
  position: PositionSchema.optional(),
});

export const PreconditionTypeSchema = z.enum([
  "user_said",
  "agent_decision",
  "tool_call",
]);

export const PreconditionSchema = z.object({
  type: PreconditionTypeSchema,
  value: z.string(),
  description: z.string().optional(),
});

export const ContextPreconditionsSchema = z.object({
  preconditions: z.array(z.string()),
  jumpTo: z.string().optional(),
});

export const PreconditionsArraySchema = z
  .array(PreconditionSchema)
  .refine(
    (preconditions) => {
      if (preconditions.length === 0) return true;
      const firstType = preconditions[0].type;
      return preconditions.every((p) => p.type === firstType);
    },
    {
      message:
        "All preconditions in an edge must have the same type (user_said, agent_decision, or tool_call)",
    }
  );

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  preconditions: PreconditionsArraySchema.optional(),
  contextPreconditions: ContextPreconditionsSchema.optional(),
});

export const GraphSchema = z.object({
  startNode: z.string(),
  agents: z.array(AgentSchema),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

export type Agent = z.infer<typeof AgentSchema>;
export type NodeKind = z.infer<typeof NodeKindSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type PreconditionType = z.infer<typeof PreconditionTypeSchema>;
export type Precondition = z.infer<typeof PreconditionSchema>;
export type ContextPreconditions = z.infer<typeof ContextPreconditionsSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
