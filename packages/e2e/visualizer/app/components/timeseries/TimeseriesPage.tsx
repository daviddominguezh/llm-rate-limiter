'use client';

import { useState, useEffect } from 'react';
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DatasetSelector } from './DatasetSelector';
import { MetricSelector } from './MetricSelector';
import { TimeseriesChart } from './TimeseriesChart';
import {
  transformSnapshotsToChartData,
  getAvailableMetrics,
  DEFAULT_METRICS,
  type ChartDataPoint,
  type MetricConfig,
} from '@/lib/timeseries';

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
    case 'dummy': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/dummy.json');
      return m.default as unknown as TestData;
    }
    default:
      return null;
  }
}

export function TimeseriesPage() {
  const [selectedDataset, setSelectedDataset] = useState('capacity-plus-one');
  const [testData, setTestData] = useState<TestData | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [metrics, setMetrics] = useState<MetricConfig[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(DEFAULT_METRICS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDataset(): Promise<void> {
      setLoading(true);
      const data = await loadDatasetJson(selectedDataset);
      if (cancelled || data === null) return;

      setTestData(data);
      setChartData(transformSnapshotsToChartData(data));
      const availableMetrics = getAvailableMetrics(data);
      setMetrics(availableMetrics);
      initializeSelectedMetrics(availableMetrics, setSelectedMetrics);
      setLoading(false);
    }

    void loadDataset();

    return () => {
      cancelled = true;
    };
  }, [selectedDataset]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>E2E Test Results Visualization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ControlsSection
            selectedDataset={selectedDataset}
            onDatasetChange={setSelectedDataset}
            metrics={metrics}
            selectedMetrics={selectedMetrics}
            onMetricsChange={setSelectedMetrics}
          />
          <ChartSection
            loading={loading}
            chartData={chartData}
            selectedMetrics={selectedMetrics}
            metricConfigs={metrics}
          />
          {testData && <SummarySection testData={testData} />}
        </CardContent>
      </Card>
    </div>
  );
}

function initializeSelectedMetrics(
  availableMetrics: MetricConfig[],
  setSelectedMetrics: (metrics: string[]) => void
) {
  const activeJobsMetric = availableMetrics.find((m) => m.key.endsWith('_activeJobs'));
  if (activeJobsMetric) {
    setSelectedMetrics([activeJobsMetric.key]);
  } else if (availableMetrics.length > 0) {
    setSelectedMetrics([availableMetrics[0].key]);
  }
}

interface ControlsSectionProps {
  selectedDataset: string;
  onDatasetChange: (dataset: string) => void;
  metrics: MetricConfig[];
  selectedMetrics: string[];
  onMetricsChange: (metrics: string[]) => void;
}

function ControlsSection({
  selectedDataset,
  onDatasetChange,
  metrics,
  selectedMetrics,
  onMetricsChange,
}: ControlsSectionProps) {
  return (
    <div className="space-y-4">
      <DatasetSelector value={selectedDataset} onValueChange={onDatasetChange} />
      <MetricSelector
        metrics={metrics}
        selected={selectedMetrics}
        onSelectionChange={onMetricsChange}
      />
    </div>
  );
}

interface ChartSectionProps {
  loading: boolean;
  chartData: ChartDataPoint[];
  selectedMetrics: string[];
  metricConfigs: MetricConfig[];
}

function ChartSection({
  loading,
  chartData,
  selectedMetrics,
  metricConfigs,
}: ChartSectionProps) {
  if (loading) {
    return (
      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <TimeseriesChart
      data={chartData}
      selectedMetrics={selectedMetrics}
      metricConfigs={metricConfigs}
    />
  );
}

interface SummarySectionProps {
  testData: TestData;
}

function SummarySection({ testData }: SummarySectionProps) {
  const { summary, metadata } = testData;
  const durationSec = (metadata.durationMs / 1000).toFixed(1);

  return (
    <div className="flex flex-wrap gap-2 pt-4 border-t">
      <Badge variant="outline">Duration: {durationSec}s</Badge>
      <Badge variant="outline">Total Jobs: {summary.totalJobs}</Badge>
      <Badge variant="outline">Completed: {summary.completed}</Badge>
      <Badge variant="outline">Failed: {summary.failed}</Badge>
      {summary.avgDurationMs && (
        <Badge variant="outline">
          Avg Duration: {(summary.avgDurationMs / 1000).toFixed(2)}s
        </Badge>
      )}
    </div>
  );
}
