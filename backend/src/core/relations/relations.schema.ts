/**
 * Relations Zod Schemas
 * Validation for relation queries
 */
import { z } from 'zod';

// Window enum
export const RelationWindowEnum = z.enum(['1d', '7d', '30d', '90d', 'all']);
export type RelationWindowSchema = z.infer<typeof RelationWindowEnum>;

// Direction enum
export const RelationDirectionEnum = z.enum(['out', 'in', 'bi']);
export type RelationDirectionSchema = z.infer<typeof RelationDirectionEnum>;

// Chain enum
export const RelationChainEnum = z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon']);
export type RelationChainSchema = z.infer<typeof RelationChainEnum>;

// Source enum
export const RelationSourceEnum = z.enum(['erc20', 'eth', 'all']);
export type RelationSourceSchema = z.infer<typeof RelationSourceEnum>;

/**
 * Query graph (for visualization)
 */
export const QueryGraphSchema = z.object({
  window: RelationWindowEnum.optional().default('7d'),
  minDensity: z.coerce.number().min(0).optional().default(0),
  chain: RelationChainEnum.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});
export type QueryGraphInput = z.infer<typeof QueryGraphSchema>;

/**
 * Query relations for an address
 */
export const QueryByAddressSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address'),
  window: RelationWindowEnum.optional().default('7d'),
  direction: z.enum(['in', 'out', 'both']).optional().default('both'),
  minDensity: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});
export type QueryByAddressInput = z.infer<typeof QueryByAddressSchema>;

/**
 * Query corridor between two addresses
 */
export const QueryCorridorSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid from address'),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid to address'),
  window: RelationWindowEnum.optional().default('7d'),
});
export type QueryCorridorInput = z.infer<typeof QueryCorridorSchema>;

/**
 * Relation response
 */
export const RelationResponseSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  chain: RelationChainEnum,
  window: RelationWindowEnum,
  direction: RelationDirectionEnum,
  interactionCount: z.number(),
  volumeRaw: z.string(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  densityScore: z.number(),
  source: RelationSourceEnum,
});
export type RelationResponse = z.infer<typeof RelationResponseSchema>;
