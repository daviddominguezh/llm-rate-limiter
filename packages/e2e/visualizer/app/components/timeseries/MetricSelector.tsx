'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { MetricConfig, MetricCategory } from '@/lib/timeseries';

interface MetricSelectorProps {
  metrics: MetricConfig[];
  selected: string[];
  onSelectionChange: (selected: string[]) => void;
}

const CATEGORY_LABELS: Record<MetricCategory, string> = {
  jobs: 'Jobs',
  rateLimit: 'Rate Limits',
  capacity: 'Capacity',
};

function groupMetricsByCategory(
  metrics: MetricConfig[]
): Record<MetricCategory, MetricConfig[]> {
  const grouped: Record<MetricCategory, MetricConfig[]> = {
    jobs: [],
    rateLimit: [],
    capacity: [],
  };
  for (const metric of metrics) {
    grouped[metric.category].push(metric);
  }
  return grouped;
}

export function MetricSelector({
  metrics,
  selected,
  onSelectionChange,
}: MetricSelectorProps) {
  const grouped = groupMetricsByCategory(metrics);

  const handleToggle = (key: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selected, key]);
    } else {
      onSelectionChange(selected.filter((k) => k !== key));
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      {Object.entries(grouped).map(([category, categoryMetrics]) => (
        <MetricCategoryGroup
          key={category}
          category={category as MetricCategory}
          metrics={categoryMetrics}
          selected={selected}
          onToggle={handleToggle}
        />
      ))}
    </div>
  );
}

interface MetricCategoryGroupProps {
  category: MetricCategory;
  metrics: MetricConfig[];
  selected: string[];
  onToggle: (key: string, checked: boolean) => void;
}

function MetricCategoryGroup({
  category,
  metrics,
  selected,
  onToggle,
}: MetricCategoryGroupProps) {
  if (metrics.length === 0) return null;

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">
        {CATEGORY_LABELS[category]}
      </span>
      <div className="flex flex-wrap gap-3">
        {metrics.map((metric) => (
          <MetricCheckbox
            key={metric.key}
            metric={metric}
            checked={selected.includes(metric.key)}
            onCheckedChange={(checked) => onToggle(metric.key, checked)}
          />
        ))}
      </div>
    </div>
  );
}

interface MetricCheckboxProps {
  metric: MetricConfig;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function MetricCheckbox({ metric, checked, onCheckedChange }: MetricCheckboxProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Checkbox
        id={metric.key}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <Label htmlFor={metric.key} className="text-xs cursor-pointer">
        <span
          className="inline-block w-2 h-2 rounded-full mr-1"
          style={{ backgroundColor: metric.color }}
        />
        {metric.label}
      </Label>
    </div>
  );
}
