import type { ZodError } from 'zod';

import { FIRST_INDEX } from './constants.js';
import { type QueueJobRequestBody, queueJobRequestSchema } from './schemas.js';

interface ValidationResult {
  valid: true;
  data: QueueJobRequestBody;
}

interface ValidationError {
  valid: false;
  error: string;
}

type ValidateQueueJobResult = ValidationResult | ValidationError;

const formatZodError = (error: ZodError): string => {
  const { issues } = error;
  const [firstIssue] = issues;
  if (firstIssue === undefined) return 'Validation failed';
  const { path, message } = firstIssue;
  const field = path.join('.');
  return field.length > FIRST_INDEX ? `${field}: ${message}` : message;
};

export const validateQueueJobRequest = (body: unknown): ValidateQueueJobResult => {
  const result = queueJobRequestSchema.safeParse(body);

  if (!result.success) {
    return {
      valid: false,
      error: formatZodError(result.error),
    };
  }

  return {
    valid: true,
    data: result.data,
  };
};
