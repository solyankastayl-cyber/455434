/**
 * Actions Zod Schemas
 */
import { z } from 'zod';

export const GetSuggestedQuery = z.object({
  limit: z.coerce.number().min(1).max(50).default(20),
});

export const ActionIdParams = z.object({
  id: z.string().min(1),
});

export const GetHistoryQuery = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
});
