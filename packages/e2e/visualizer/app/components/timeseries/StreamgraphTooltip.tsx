'use client';

// =============================================================================
// Types
// =============================================================================

export interface TooltipEntry {
  jobType: string;
  color: string;
  running: number;
  capacity: number;
}

export interface CursorTooltipState {
  x: number;
  y: number;
  time: number;
  hoveredKey: string | null;
  entries: TooltipEntry[];
}

// =============================================================================
// Constants
// =============================================================================

const TOOLTIP_OFFSET_X = 16;
const TOOLTIP_OFFSET_Y = -10;

// =============================================================================
// Tooltip component
// =============================================================================

export function CursorTooltip({ state }: { state: CursorTooltipState }) {
  const { x, y, time, hoveredKey, entries } = state;

  return (
    <div
      className="absolute pointer-events-none z-20 rounded px-2.5 py-1.5 text-xs"
      style={{
        left: x + TOOLTIP_OFFSET_X,
        top: y + TOOLTIP_OFFSET_Y,
        background: 'rgba(0,0,0,0.88)',
        color: '#ccc',
        whiteSpace: 'nowrap',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <div style={{ color: '#888', marginBottom: 3 }}>{time.toFixed(1)}s</div>
      {entries.map((entry) => (
        <TooltipRow key={entry.jobType} entry={entry} highlighted={entry.jobType === hoveredKey} />
      ))}
    </div>
  );
}

function TooltipRow({ entry, highlighted }: { entry: TooltipEntry; highlighted: boolean }) {
  return (
    <div className="flex items-center gap-2" style={{ fontWeight: highlighted ? 700 : 400 }}>
      <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
      <span style={{ color: entry.color }}>{entry.jobType}</span>
      <span>
        {entry.running} / {entry.capacity}
      </span>
    </div>
  );
}
