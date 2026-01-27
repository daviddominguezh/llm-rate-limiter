/**
 * Tests for onAvailableSlotsChange callback adjustment functionality.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type {
  Availability,
  AvailabilityChangeReason,
  LLMRateLimiterInstance,
  RelativeAvailabilityAdjustment,
} from '../multiModelTypes.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const HUNDRED = 100;
const ESTIMATED_TOKENS = 1000;

const ZERO_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

interface CallbackRecord {
  availability: Availability;
  reason: AvailabilityChangeReason;
  adjustment?: RelativeAvailabilityAdjustment;
}

const createMockUsage = (
  modelId: string,
  inputTokens = ESTIMATED_TOKENS,
  outputTokens = ZERO
): {
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
} => ({ modelId, inputTokens, cachedTokens: ZERO, outputTokens });

const createTokenLimiter = (calls: CallbackRecord[]): LLMRateLimiterInstance =>
  createLLMRateLimiter({
    models: { default: { tokensPerMinute: ESTIMATED_TOKENS * TEN, resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS, estimatedNumberOfRequests: ONE }, pricing: ZERO_PRICING } },
    onAvailableSlotsChange: (availability, reason, adjustment) => { calls.push({ availability, reason, adjustment }); },
  });

describe('onAvailableSlotsChange callback adjustment - tokens', () => {
  it('should calculate negative adjustment when using fewer tokens than estimated', async () => {
    const calls: CallbackRecord[] = [];
    const limiter = createTokenLimiter(calls);
    const actualTokens = ESTIMATED_TOKENS - HUNDRED;
    await limiter.queueJob({ jobId: 'test-1', job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId, actualTokens)); return { usage: { input: actualTokens, output: ZERO, cached: ZERO }, requestCount: ONE }; } });
    const adjustmentCall = calls.find((c) => c.reason === 'adjustment');
    expect(adjustmentCall).toBeDefined();
    expect(adjustmentCall?.adjustment?.tokensPerMinute).toBe(-HUNDRED);
    limiter.stop();
  });

  it('should have memoryKB and concurrentRequests as zero in adjustment', async () => {
    const calls: CallbackRecord[] = [];
    const limiter = createTokenLimiter(calls);
    const actualTokens = ESTIMATED_TOKENS + HUNDRED;
    await limiter.queueJob({ jobId: 'test-1', job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId, actualTokens)); return { usage: { input: actualTokens, output: ZERO, cached: ZERO }, requestCount: ONE }; } });
    const adjustmentCall = calls.find((c) => c.reason === 'adjustment');
    expect(adjustmentCall?.adjustment?.memoryKB).toBe(ZERO);
    expect(adjustmentCall?.adjustment?.concurrentRequests).toBe(ZERO);
    limiter.stop();
  });
});

describe('onAvailableSlotsChange callback adjustment - requests', () => {
  it('should track request count adjustment', async () => {
    const calls: CallbackRecord[] = [];
    const limiter = createLLMRateLimiter({
      models: { default: { requestsPerMinute: HUNDRED, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: ZERO_PRICING } },
      onAvailableSlotsChange: (availability, reason, adjustment) => { calls.push({ availability, reason, adjustment }); },
    });
    const actualRequests = 2;
    await limiter.queueJob({ jobId: 'test-1', job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return { usage: { input: ESTIMATED_TOKENS, output: ZERO, cached: ZERO }, requestCount: actualRequests }; } });
    const adjustmentCall = calls.find((c) => c.reason === 'adjustment');
    expect(adjustmentCall).toBeDefined();
    expect(adjustmentCall?.adjustment?.requestsPerMinute).toBe(ONE);
    expect(adjustmentCall?.adjustment?.requestsPerDay).toBe(ONE);
    limiter.stop();
  });
});
