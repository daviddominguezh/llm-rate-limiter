'use client';

import type { InstanceConfig } from '@/lib/timeseries/capacityTypes';
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

interface MetricsRowProps {
  testData: TestData;
  instances: InstanceConfig[];
}

const MS_PER_SECOND = 1000;

export function MetricsRow({ testData, instances }: MetricsRowProps) {
  const { summary, metadata } = testData;
  const durationSec = (metadata.durationMs / MS_PER_SECOND).toFixed(1);

  return (
    <div
      className="w-full flex justify-center items-center gap-6 pt-0 pb-4"
      style={{
        color: '#888',
        fontSize: '13px',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <span>
        <span style={{ color: '#666' }}>Total Jobs:</span>{' '}
        <span style={{ color: '#E8715A', fontWeight: 600 }}>{summary.totalJobs}</span>
      </span>
      <span style={{ color: '#333' }}>·</span>
      <span>
        <span style={{ color: '#666' }}>Completed:</span>{' '}
        <span style={{ color: '#5A9CE8', fontWeight: 600 }}>{summary.completed}</span>
      </span>
      <span style={{ color: '#333' }}>·</span>
      <span>
        <span style={{ color: '#666' }}>Failed:</span>{' '}
        <span style={{ color: summary.failed > 0 ? '#E8715A' : '#6EC97D', fontWeight: 600 }}>
          {summary.failed}
        </span>
      </span>
      <span style={{ color: '#333' }}>·</span>
      <span>
        <span style={{ color: '#666' }}>Instances:</span>{' '}
        <span style={{ color: '#6EC97D', fontWeight: 600 }}>{instances.length}</span>
      </span>
      <span style={{ color: '#333' }}>·</span>
      <span>
        <span style={{ color: '#666' }}>Duration:</span>{' '}
        <span style={{ color: '#D4A843', fontWeight: 600 }}>{durationSec}s</span>
      </span>
    </div>
  );
}
