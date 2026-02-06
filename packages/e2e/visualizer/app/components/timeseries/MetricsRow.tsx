'use client';

import type { InstanceConfig } from '@/lib/timeseries/capacityTypes';
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

interface MetricsRowProps {
  testData: TestData;
  instances: InstanceConfig[];
}

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
}

const MS_PER_SECOND = 1000;

function MetricCard({ label, value, subtext, color }: MetricCardProps) {
  return (
    <div
      style={{
        background: 'rgb(18,18,22)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px',
        padding: '16px 20px',
        minWidth: '140px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          marginBottom: '6px',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '28px',
          fontWeight: 700,
          color: color ?? '#eee',
          fontFamily: "'Space Grotesk', sans-serif",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {subtext && (
        <div
          style={{
            fontSize: '11px',
            color: '#555',
            marginTop: '4px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {subtext}
        </div>
      )}
    </div>
  );
}

export function MetricsRow({ testData, instances }: MetricsRowProps) {
  const { summary, metadata } = testData;
  const durationSec = (metadata.durationMs / MS_PER_SECOND).toFixed(1);

  return (
    <div
      className="px-12 py-1.5 pb-6 w-full flex justify-evenly"
      style={{
        color: '#ccc',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div className="w-full flex justify-center gap-3">
        <MetricCard
          label="Total Jobs"
          value={summary.totalJobs}
          subtext={`${summary.failed} failed`}
          color="#E8715A"
        />
        <MetricCard label="Completed" value={summary.completed} subtext="jobs finished" color="#5A9CE8" />
        <MetricCard label="Instances" value={instances.length} subtext="distributed nodes" color="#6EC97D" />
        <MetricCard label="Duration" value={`${durationSec}s`} subtext="total runtime" color="#D4A843" />
      </div>
    </div>
  );
}
