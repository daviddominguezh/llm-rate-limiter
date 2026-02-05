/**
 * Type definitions for timeseries chart visualization.
 */

export type MetricCategory = 'jobs' | 'rateLimit' | 'capacity';

export interface MetricConfig {
  /** Unique key used in chart data */
  key: string;
  /** Display label for legend/tooltip */
  label: string;
  /** Category for grouping in selector */
  category: MetricCategory;
  /** Color for the chart line */
  color: string;
}

export interface ChartDataPoint {
  /** Time in seconds from test start */
  time: number;
  /** Original timestamp for tooltip display */
  timestamp: number;
  /** What triggered this snapshot */
  trigger: string;
  /** Dynamic metric values keyed by metric key */
  [key: string]: number | string;
}

export interface DatasetInfo {
  /** Dataset identifier */
  id: string;
  /** Display name */
  label: string;
}
