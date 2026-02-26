/**
 * Debug script: traces the data pipeline for the "Resource Allocation Over Time" chart.
 * Run: npx tsx packages/e2e/visualizer/scripts/debugAllocationChart.ts
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { aggregateChartData } from '../lib/timeseries/aggregateData';
import type { ModelCapacityConfig } from '../lib/timeseries/aggregateData';
import {
  getDashboardConfig,
  getInstances,
  transformSnapshotsToDashboardData,
} from '../lib/timeseries/dashboardTransform';

const MODEL_KEY_REGEXP = /[^a-zA-Z0-9]/gu;
const SAMPLE_INDICES = [0, 1, 100, 290, 291, 400];

// eslint-disable-next-line @typescript-eslint/no-require-imports
const data: TestData = require('../../testResults/src/data/realWorld.json');

console.log('=== Model Capacities (from config) ===');
const caps = data.metadata.modelCapacities ?? {};
for (const [modelId, cap] of Object.entries(caps)) {
  console.log(`  ${modelId}: TPM=${cap.tokensPerMinute}, RPM=${cap.requestsPerMinute}`);
}

// Build capacity map (same as ResourceDashboard)
const modelCapacities = new Map<string, ModelCapacityConfig>();
for (const [modelId, cap] of Object.entries(caps)) {
  const key = modelId.replace(MODEL_KEY_REGEXP, '_');
  modelCapacities.set(key, {
    tpm: Math.max(0, cap.tokensPerMinute),
    rpm: Math.max(0, cap.requestsPerMinute),
  });
}

// Run transforms
const config = getDashboardConfig(data);
const instances = getInstances(data);
const rawData = transformSnapshotsToDashboardData(data);

console.log('\n=== WITHOUT config capacities (old behavior) ===');
const oldAgg = aggregateChartData(rawData, config.jobTypes, instances, config.models);
for (const idx of SAMPLE_INDICES) {
  if (idx >= oldAgg.length) continue;
  const point = oldAgg[idx];
  console.log(`\n--- Point ${idx} (${point.timeSeconds.toFixed(1)}s) ---`);
  for (const model of config.models) {
    const tpm = point[`${model}_tpm`] ?? 0;
    const tpmCap = point[`${model}_tpmCapacity`] ?? 0;
    console.log(`  ${model}: tpm=${tpm}, tpmCapacity=${tpmCap}`);
  }
}

console.log('\n=== WITH config capacities (fixed behavior) ===');
const newAgg = aggregateChartData(rawData, config.jobTypes, instances, config.models, modelCapacities);
for (const idx of SAMPLE_INDICES) {
  if (idx >= newAgg.length) continue;
  const point = newAgg[idx];
  console.log(`\n--- Point ${idx} (${point.timeSeconds.toFixed(1)}s) ---`);
  for (const model of config.models) {
    const tpm = point[`${model}_tpm`] ?? 0;
    const tpmCap = point[`${model}_tpmCapacity`] ?? 0;
    console.log(`  ${model}: tpm=${tpm}, tpmCapacity=${tpmCap}`);
  }
}
