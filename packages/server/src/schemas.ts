import { z } from 'zod';

import { MIN_STRING_LENGTH } from './constants.js';

export const queueJobRequestSchema = z.object({
  jobId: z.string().min(MIN_STRING_LENGTH, { message: 'jobId is required' }),
  jobType: z.string().min(MIN_STRING_LENGTH, { message: 'jobType is required' }),
  payload: z.record(z.string(), z.unknown()),
});

export type QueueJobRequestBody = z.infer<typeof queueJobRequestSchema>;
