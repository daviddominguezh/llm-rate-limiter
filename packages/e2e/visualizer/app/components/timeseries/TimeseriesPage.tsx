'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { transformToStructuredData } from '@/lib/timeseries/structuredTransform';
import type { StructuredCapacityResult } from '@/lib/timeseries/structuredTransform';
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { useEffect, useState } from 'react';

import { DatasetSelector } from './DatasetSelector';
import { MetricsRow } from './MetricsRow';
import { ResourceDashboard } from './ResourceDashboard';
import { StreamgraphChart } from './StreamgraphChart';

async function loadDatasetJson(datasetId: string): Promise<TestData | null> {
  switch (datasetId) {
    case 'capacity-plus-one': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/capacity-plus-one.json');
      return m.default as unknown as TestData;
    }
    case 'exact-capacity': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/exact-capacity.json');
      return m.default as unknown as TestData;
    }
    case 'rate-limit-queuing': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/rate-limit-queuing.json');
      return m.default as unknown as TestData;
    }
    case 'slots-evolve-sequential': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/slots-evolve-sequential.json');
      return m.default as unknown as TestData;
    }
    case 'slots-evolve-interleaved': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/slots-evolve-interleaved.json');
      return m.default as unknown as TestData;
    }
    case 'slots-evolve-concurrent': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/slots-evolve-concurrent.json');
      return m.default as unknown as TestData;
    }
    case 'model-escalation': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/model-escalation.json');
      return m.default as unknown as TestData;
    }
    case 'realWorld': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/realWorld.json');
      return m.default as unknown as TestData;
    }
    case 'dummy': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/dummy.json');
      return m.default as unknown as TestData;
    }
    case 'mega-comprehensive': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/mega-comprehensive.json');
      return m.default as unknown as TestData;
    }
    case 'mega-comprehensive-distributed': {
      const m = await import(
        '@llm-rate-limiter/e2e-test-results/src/data/mega-comprehensive-distributed.json'
      );
      return m.default as unknown as TestData;
    }
    default:
      return null;
  }
}

export function TimeseriesPage() {
  const [selectedDataset, setSelectedDataset] = useState('realWorld');
  const [testData, setTestData] = useState<TestData | null>(null);
  const [structuredData, setStructuredData] = useState<StructuredCapacityResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDataset(): Promise<void> {
      setLoading(true);
      const data = await loadDatasetJson(selectedDataset);
      if (cancelled || data === null) return;

      const structured = transformToStructuredData(data);

      setTestData(data);
      setStructuredData(structured);
      setLoading(false);
    }

    void loadDataset();

    return () => {
      cancelled = true;
    };
  }, [selectedDataset]);

  return (
    <div className="w-full m-0 px-0">
      <Card className="shadow-none ring-0">
        <CardHeader>
          <CardTitle className="flex flex-col gap-3 items-center justify-between">
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 700,
                color: '#eee',
                margin: 0,
                letterSpacing: '-0.5px',
              }}
            >
              E2E Test Results - Capacity Visualization
            </h1>
            <DatasetSelector value={selectedDataset} onValueChange={setSelectedDataset} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 px-0">
          {loading ? (
            <div className="h-[400px] flex items-center justify-center text-muted-foreground">Loading...</div>
          ) : (
            <>
              {testData && <MetricsRow testData={testData} />}
              {structuredData && <StreamgraphChart data={structuredData} />}
            </>
          )}

          {testData && <ResourceDashboard testData={testData} />}

          {testData && <SummarySection testData={testData} />}
        </CardContent>
      </Card>
    </div>
  );
}

interface SummarySectionProps {
  testData: TestData;
}

const MS_PER_SECOND = 1000;

function SummarySection({ testData }: SummarySectionProps) {
  const { summary, metadata } = testData;
  const durationSec = (metadata.durationMs / MS_PER_SECOND).toFixed(1);

  return (
    <div className="w-full justify-center flex flex-wrap gap-2 pt-4 border-t">
      <Badge variant="outline">Duration: {durationSec}s</Badge>
      <Badge variant="outline">Total Jobs: {summary.totalJobs}</Badge>
      <Badge variant="outline">Completed: {summary.completed}</Badge>
      <Badge variant="outline">Failed: {summary.failed}</Badge>
      {summary.avgDurationMs && (
        <Badge variant="outline">Avg Duration: {(summary.avgDurationMs / MS_PER_SECOND).toFixed(2)}s</Badge>
      )}
    </div>
  );
}
