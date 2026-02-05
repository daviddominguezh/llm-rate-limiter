'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DATASETS } from '@/lib/timeseries';

interface DatasetSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
}

function handleValueChange(
  onValueChange: (value: string) => void,
  value: string | null
): void {
  if (value !== null) {
    onValueChange(value);
  }
}

export function DatasetSelector({ value, onValueChange }: DatasetSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Dataset:</span>
      <Select value={value} onValueChange={(v) => handleValueChange(onValueChange, v)}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select dataset" />
        </SelectTrigger>
        <SelectContent>
          {DATASETS.map((dataset) => (
            <SelectItem key={dataset.id} value={dataset.id}>
              {dataset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
