'use client';

import type { StreamgraphStream } from '@/lib/timeseries/streamgraphTransform';
import { useMemo } from 'react';

import type { CrosshairValue } from './streamgraphOverlay';

// =============================================================================
// Types
// =============================================================================

export interface CrosshairTooltipState {
  time: number;
  x: number;
  y: number;
  values: CrosshairValue[];
}

// =============================================================================
// Panel label
// =============================================================================

export function PanelLabel({ instanceId, modelId }: { instanceId: string; modelId: string }) {
  return (
    <div
      className="px-3 py-1 text-xs"
      style={{ color: '#888', fontFamily: "'JetBrains Mono', monospace" }}
    >
      <span style={{ color: '#aaa', fontWeight: 600 }}>{instanceId}</span>
      <span style={{ color: '#555' }}> / </span>
      <span>{modelId}</span>
    </div>
  );
}

// =============================================================================
// Crosshair tooltip
// =============================================================================

const TOOLTIP_OFFSET_X = 16;
const TOOLTIP_OFFSET_Y = -12;

export function CrosshairTooltip({ tooltip }: { tooltip: CrosshairTooltipState }) {
  return (
    <div
      className="absolute pointer-events-none z-20 rounded px-3 py-2 text-xs"
      style={{
        left: tooltip.x + TOOLTIP_OFFSET_X,
        top: tooltip.y + TOOLTIP_OFFSET_Y,
        background: 'rgba(0,0,0,0.9)',
        color: '#eee',
        whiteSpace: 'nowrap',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <div style={{ color: '#666', marginBottom: 4 }}>{tooltip.time.toFixed(1)}s</div>
      {tooltip.values.map((v) => (
        <CrosshairValueRow key={v.jobType} value={v} />
      ))}
    </div>
  );
}

function CrosshairValueRow({ value }: { value: CrosshairValue }) {
  return (
    <div className="flex items-center gap-2 leading-relaxed">
      <span className="inline-block w-2 h-2 rounded-sm" style={{ background: value.color }} />
      <span style={{ color: '#aaa' }}>{value.jobType}</span>
      <span style={{ color: value.color }}>
        {value.running.toFixed(2)}
        <span style={{ color: '#555' }}> / </span>
        {value.capacity.toFixed(2)}
      </span>
    </div>
  );
}

// =============================================================================
// Legend
// =============================================================================

export function StreamLegend({ streams }: { streams: StreamgraphStream[] }) {
  const uniqueJobTypes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of streams) {
      if (!seen.has(s.jobType)) seen.set(s.jobType, s.color);
    }
    return [...seen.entries()];
  }, [streams]);

  return (
    <div className="flex justify-center gap-4 py-2 text-xs text-muted-foreground">
      {uniqueJobTypes.map(([jt, color]) => (
        <div key={jt} className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
          <span>{jt}</span>
        </div>
      ))}
    </div>
  );
}
