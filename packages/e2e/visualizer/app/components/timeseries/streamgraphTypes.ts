import type { StreamgraphPanel } from '@/lib/timeseries/streamgraphTransform';

// =============================================================================
// Shared types for the streamgraph chart system
// =============================================================================

export type AxisPosition = 'top' | 'bottom' | 'none';

/** Shared cursor state across panels in a model group */
export interface GroupCursorState {
  index: number;
  hoveredKey: string | null;
}

export interface PanelProps {
  panel: StreamgraphPanel;
  height?: number;
  axisPosition: AxisPosition;
  groupCursor: GroupCursorState | null;
  onCursorChange: (c: GroupCursorState | null) => void;
}

/** Component type for the panel, used to avoid circular imports */
export type StreamgraphPanelComponent = React.ComponentType<PanelProps>;
