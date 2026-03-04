/**
 * Profiles Zod Schemas
 */
import { z } from 'zod';

export const GetProfileParams = z.object({
  address: z.string().min(1),
});

export const GetTopProfilesQuery = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  tier: z.enum(['elite', 'green', 'yellow', 'red']).optional(),
});

export const GetByStrategyQuery = z.object({
  strategyType: z.string().min(1),
  limit: z.coerce.number().min(1).max(200).default(50),
});

export const SearchProfilesQuery = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});
