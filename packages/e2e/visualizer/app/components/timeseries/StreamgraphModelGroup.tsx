'use client';

import type { StreamgraphPanel } from '@/lib/timeseries/streamgraphTransform';
import { useCallback, useState } from 'react';

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

  return (
    <div onMouseLeave={handleGroupLeave}>
      {group.map((panel, gi) => (
        <div key={`${panel.instanceId}|${panel.modelId}`}>
          {gi > 0 && <div style={{ height: 2, background: '#fff' }} />}
          <PanelComponent
            panel={panel}
            height={propHeight}
            axisPosition={axisPositions[startIdx + gi]}
            groupCursor={cursor}
            onCursorChange={setCursor}
          />
        </div>
      ))}
    </div>
  );
}
