/**
 * Types for the resource dashboard visualization.
 */

export interface DashboardDataPoint {
  time: string;
  timeSeconds: number;
  [key: string]: string | number;
}

export interface JobTypeConfig {
  id: string;
  label: string;
  color: string;
}

export interface InstanceInfo {
  shortId: string;
  fullId: string;
}

export interface DashboardConfig {
  jobTypes: JobTypeConfig[];
  instances: InstanceInfo[];
  models: string[];
}

export const JOB_TYPE_COLORS: Record<string, string> = {
  summary: '#E85E3B',
  analysis: '#3B8EE8',
  extraction: '#5EBB6E',
  default: '#D4A843',
};

export const INSTANCE_COLORS = ['#E8715A', '#5A9CE8', '#6EC97D', '#D4A843'];

export const TOOLTIP_STYLE = {
  background: 'rgba(15, 15, 20, 0.95)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  padding: '10px 14px',
  fontSize: '12px',
  color: '#ccc',
};
