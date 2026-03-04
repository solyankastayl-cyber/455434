/**
 * Adaptive Zod Schemas
 */
import { z } from 'zod';

export const GetWeightsQuery = z.object({
  scope: z.string().optional(),
});

export const GetConfidenceParams = z.object({
  address: z.string().min(1),
});

export const GetStrategyParams = z.object({
  type: z.string().min(1),
});

export const GetExplainParams = z.object({
  address: z.string().min(1),
});
