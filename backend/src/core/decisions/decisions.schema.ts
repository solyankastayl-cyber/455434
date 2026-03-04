/**
 * Decisions Zod Schemas
 */
import { z } from 'zod';

export const DecisionScopeEnum = z.enum(['actor', 'strategy', 'signal']);
export const DecisionTypeEnum = z.enum([
  'follow', 'copy', 'watch', 'ignore', 'reduce_exposure', 'increase_exposure'
]);

export const GetDecisionParams = z.object({
  address: z.string().min(1),
});

export const GetDecisionHistoryQuery = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const GetRecommendedQuery = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
});
