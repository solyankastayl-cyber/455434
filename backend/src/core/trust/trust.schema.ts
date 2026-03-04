/**
 * Trust Zod Schemas
 */
import { z } from 'zod';

export const GetTrustParams = z.object({
  subjectType: z.enum(['decision_type', 'actor', 'strategy', 'system']),
  subjectId: z.string().min(1),
});

export const GetActorTrustParams = z.object({
  address: z.string().min(1),
});

export const GetDecisionTypeTrustParams = z.object({
  decisionType: z.string().min(1),
});

export const GetHighTrustQuery = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
});
