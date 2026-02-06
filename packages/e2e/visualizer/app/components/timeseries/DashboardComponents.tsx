'use client';

import type { DashboardDataPoint, JobTypeConfig } from '@/lib/timeseries/dashboardTypes';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
}

export function MetricCard({ label, value, subtext, color }: MetricCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl px-5 py-4 min-w-[140px]">
      <div className="text-[11px] text-muted-foreground uppercase tracking-[1.5px] mb-1.5 font-mono">
        {label}
      </div>
      <div
        className="text-[28px] font-bold leading-tight"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-[11px] text-muted-foreground/70 mt-1 font-mono">{subtext}</div>
      )}
    </div>
  );
}

interface SectionHeaderProps {
  children: React.ReactNode;
  subtitle?: string;
}

export function SectionHeader({ children, subtitle }: SectionHeaderProps) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
        {children}
      </h2>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}

interface ResourceGaugeProps {
  label: string;
  used: number;
  total: number;
  segments: Array<{ color: string; value: number }>;
}

export function ResourceGauge({ label, used, total, segments }: ResourceGaugeProps) {
  const PERCENT = 100;
  const HIGH_THRESHOLD = 80;
  const MED_THRESHOLD = 50;
  const pct = Math.round((used / total) * PERCENT);
  const colorClass = pct > HIGH_THRESHOLD ? 'text-red-500' : pct > MED_THRESHOLD ? 'text-yellow-500' : 'text-green-500';

  return (
    <div className="mb-4">
      <div className="flex justify-between mb-1.5 text-xs font-mono">
        <span className="text-muted-foreground">{label}</span>
        <span className={colorClass}>
          {used.toLocaleString()} / {total.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-sm overflow-hidden flex">
        {segments.map((seg, idx) => {
          const w = total > 0 ? (seg.value / total) * PERCENT : 0;
          return (
            <div
              key={idx}
              style={{ width: `${w}%`, background: seg.color }}
              className="transition-all duration-500"
            />
          );
        })}
      </div>
    </div>
  );
}

interface JobTypeLegendProps {
  jobTypes: JobTypeConfig[];
  data: DashboardDataPoint;
  instanceId: string;
}

export function JobTypeLegend({ jobTypes, data, instanceId }: JobTypeLegendProps) {
  return (
    <div className="flex gap-4 mt-3 flex-wrap">
      {jobTypes.map((jt) => {
        const ratioKey = `${instanceId}_${jt.id}_ratio`;
        const ratio = typeof data[ratioKey] === 'number' ? data[ratioKey] : 0;
        return (
          <div key={jt.id} className="flex items-center gap-1.5 text-[11px] font-mono">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: jt.color }}
            />
            <span className="text-muted-foreground">{jt.label}</span>
            <span className="text-muted-foreground/60">({ratio}%)</span>
          </div>
        );
      })}
    </div>
  );
}

interface ChartContainerProps {
  children: React.ReactNode;
}

export function ChartContainer({ children }: ChartContainerProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      {children}
    </div>
  );
}
