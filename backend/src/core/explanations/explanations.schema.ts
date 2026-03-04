/**
 * Explanations Zod Schemas
 */
import { z } from 'zod';

export const ExplainScoreParams = z.object({
  address: z.string().min(1),
});

export const ExplainScoreQuery = z.object({
  window: z.enum(['7d', '30d', '90d']).default('7d'),
});

export const ExplainStrategyParams = z.object({
  address: z.string().min(1),
});

export const ExplainAlertParams = z.object({
  id: z.string().min(1),
});
