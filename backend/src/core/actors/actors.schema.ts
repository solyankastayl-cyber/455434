/**
 * Actors Zod Schema - PLACEHOLDER
 */

import { z } from 'zod';

export const ActorTypeSchema = z.enum(['fund', 'whale', 'trader', 'market_maker', 'unknown']);

export const CreateActorSchema = z.object({
  name: z.string().min(1).max(100),
  type: ActorTypeSchema.default('unknown'),
});

export const UpdateActorSchema = CreateActorSchema.partial();

export type CreateActorInput = z.infer<typeof CreateActorSchema>;
export type UpdateActorInput = z.infer<typeof UpdateActorSchema>;
