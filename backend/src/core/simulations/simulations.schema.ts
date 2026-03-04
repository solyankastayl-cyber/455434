/**
 * Simulations Zod Schemas
 */
import { z } from 'zod';

export const GetSimulationsQuery = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
});

export const SimulationIdParams = z.object({
  id: z.string().min(1),
});

export const TargetIdParams = z.object({
  targetId: z.string().min(1),
});

export const InvalidateBody = z.object({
  reason: z.string().min(1).max(500),
});
