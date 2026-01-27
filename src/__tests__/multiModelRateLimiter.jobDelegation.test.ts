import { createLLMRateLimiter } from '../multiModelRateLimiter.js';

import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { createMockJobResult, createMockUsage, DEFAULT_PRICING, generateJobId, ONE, RPM_LIMIT_HIGH, THREE, ZERO } from './multiModelRateLimiter.helpers.js';

const MODEL_CONFIG = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };

describe('MultiModelRateLimiter - job delegation basic', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should delegate to next model when job calls reject with delegate true', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': MODEL_CONFIG,
      },
      order: ['model-a', 'model-b'],
    });
    const modelsAttempted: string[] = [];
    const result = await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve, reject) => {
        modelsAttempted.push(modelId);
        const usage = createMockUsage(modelId);
        if (modelId === 'model-a') { reject(usage, { delegate: true }); }
        else { resolve(usage); }
        return createMockJobResult('result');
      },
    });
    expect(modelsAttempted).toEqual(['model-a', 'model-b']);
    expect(result.modelUsed).toBe('model-b');
  });
});

describe('MultiModelRateLimiter - job delegation chain 3 models', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should delegate through 3 models until one succeeds', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': MODEL_CONFIG,
        'model-c': MODEL_CONFIG,
      },
      order: ['model-a', 'model-b', 'model-c'],
    });
    const modelsAttempted: string[] = [];
    const result = await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve, reject) => {
        modelsAttempted.push(modelId);
        const usage = createMockUsage(modelId);
        if (modelId === 'model-c') { resolve(usage); }
        else { reject(usage, { delegate: true }); }
        return createMockJobResult('result');
      },
    });
    expect(modelsAttempted).toEqual(['model-a', 'model-b', 'model-c']);
    expect(result.modelUsed).toBe('model-c');
  });
});

describe('MultiModelRateLimiter - job delegation chain 4 models', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should delegate through 4 models until one succeeds', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': MODEL_CONFIG,
        'model-c': MODEL_CONFIG,
        'model-d': MODEL_CONFIG,
      },
      order: ['model-a', 'model-b', 'model-c', 'model-d'],
    });
    const modelsAttempted: string[] = [];
    const result = await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve, reject) => {
        modelsAttempted.push(modelId);
        const usage = createMockUsage(modelId);
        if (modelId === 'model-d') { resolve(usage); }
        else { reject(usage, { delegate: true }); }
        return createMockJobResult('result');
      },
    });
    expect(modelsAttempted).toEqual(['model-a', 'model-b', 'model-c', 'model-d']);
    expect(result.modelUsed).toBe('model-d');
  });
});

describe('MultiModelRateLimiter - job delegation retry', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should retry from first model when all models delegate', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': MODEL_CONFIG,
      },
      order: ['model-a', 'model-b'],
    });
    let attemptCount = ZERO;
    const modelsAttempted: string[] = [];
    const result = await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve, reject) => {
        attemptCount += ONE;
        modelsAttempted.push(modelId);
        const usage = createMockUsage(modelId);
        if (attemptCount < THREE) { reject(usage, { delegate: true }); }
        else { resolve(usage); }
        return createMockJobResult('result');
      },
    });
    expect(modelsAttempted).toEqual(['model-a', 'model-b', 'model-a']);
    expect(result.modelUsed).toBe('model-a');
  });
});
