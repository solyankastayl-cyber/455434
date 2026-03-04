/**
 * User Tiers Zod Schemas
 */
import { z } from 'zod';

export const UserTierEnum = z.enum(['free', 'pro', 'elite']);

export const UpdateUserTierBody = z.object({
  tier: UserTierEnum,
});

export const UserIdParams = z.object({
  userId: z.string().min(1),
});
