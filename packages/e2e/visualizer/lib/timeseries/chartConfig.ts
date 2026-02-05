/**
 * Chart configuration: colors, datasets, and default settings.
 */
import type { DatasetInfo } from './types';

/** Chart color palette using CSS variables */
export const CHART_COLORS = [
  'oklch(var(--chart-1))',
  'oklch(var(--chart-2))',
  'oklch(var(--chart-3))',
  'oklch(var(--chart-4))',
  'oklch(var(--chart-5))',
  'oklch(0.65 0.15 150)', // Additional colors for many metrics
  'oklch(0.60 0.18 30)',
  'oklch(0.70 0.12 200)',
];

/** Available test result datasets */
export const DATASETS: DatasetInfo[] = [
  { id: 'capacity-plus-one', label: 'Capacity Plus One' },
  { id: 'exact-capacity', label: 'Exact Capacity' },
  { id: 'rate-limit-queuing', label: 'Rate Limit Queuing' },
  { id: 'slots-evolve-sequential', label: 'Slots Evolve Sequential' },
  { id: 'slots-evolve-interleaved', label: 'Slots Evolve Interleaved' },
  { id: 'slots-evolve-concurrent', label: 'Slots Evolve Concurrent' },
  { id: 'model-escalation', label: 'Model Escalation' },
  { id: 'dummy', label: 'Dummy' },
];

/** Default metrics to show when chart loads */
export const DEFAULT_METRICS = ['activeJobs'];

/** Get color for a metric by index */
export function getMetricColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
