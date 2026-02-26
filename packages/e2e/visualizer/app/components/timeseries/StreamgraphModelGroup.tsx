'use client';

import type { StreamgraphPanel } from '@/lib/timeseries/streamgraphTransform';
import { useCallback, useMemo, useState } from 'react';

import type { AxisPosition, GroupCursorState, StreamgraphPanelComponent } from './streamgraphTypes';

// =============================================================================
// Model group — shares cursor state across panels of the same model
// =============================================================================

interface ModelGroupProps {
  group: StreamgraphPanel[];
  propHeight?: number;
  axisPositions: AxisPosition[];
  startIdx: number;
  PanelComponent: StreamgraphPanelComponent;
}

export function ModelGroup({ group, propHeight, axisPositions, startIdx, PanelComponent }: ModelGroupProps) {
  const [cursor, setCursor] = useState<GroupCursorState | null>(null);
  const handleGroupLeave = useCallback(() => setCursor(null), []);

  const groupYMax = useMemo(() => computeGroupYMax(group), [group]);

  return (
    <div onMouseLeave={handleGroupLeave}>
      <ModelHeader modelId={group[0].modelId} />
      {group.map((panel, gi) => (
        <div key={`${panel.instanceId}|${panel.modelId}`}>
          {gi > 0 && <div style={{ height: 2, background: '#fff', marginLeft: 40 }} />}
          <PanelComponent
            panel={panel}
            height={propHeight}
            axisPosition={axisPositions[startIdx + gi]}
            groupCursor={cursor}
            onCursorChange={setCursor}
            groupYMax={groupYMax}
          />
        </div>
      ))}
    </div>
  );
}

function ModelHeader({ modelId }: { modelId: string }) {
  return (
    <div
      className="text-xs pl-3"
      style={{ color: '#fff', fontFamily: "'JetBrains Mono', monospace", marginLeft: 40 }}
    >
      {modelId}
    </div>
  );
}

/** Compute the maximum y value across all panels in the group */
function computeGroupYMax(group: StreamgraphPanel[]): number {
  let max = 1;
  for (const panel of group) {
    for (const poolVal of panel.poolPerRow) {
      if (poolVal > max) max = poolVal;
    }
    for (const row of panel.capacityRows) {
      let rowSum = 0;
      for (const [key, val] of Object.entries(row)) {
        if (key !== 'time') rowSum += val;
      }
      if (rowSum > max) max = rowSum;
    }
  }
  return max;
}
