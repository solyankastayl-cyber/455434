/**
 * Timelines Zod Schemas
 */
import { z } from 'zod';

export const GetTimelineParams = z.object({
  address: z.string().min(1),
});

export const GetTimelineQuery = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
});

export const GetTimelineByTypeQuery = z.object({
  type: z.string().min(1),
  limit: z.coerce.number().min(1).max(200).default(20),
});
