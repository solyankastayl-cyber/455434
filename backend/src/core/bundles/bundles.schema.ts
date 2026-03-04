/**
 * Bundles Zod Schemas
 * Validation for bundle queries
 */
import { z } from 'zod';

// Bundle type enum
export const BundleTypeEnum = z.enum([
  'accumulation',
  'distribution', 
  'flow',
  'wash',
  'rotation',
  'unknown'
]);
export type BundleTypeSchema = z.infer<typeof BundleTypeEnum>;

// Window enum
export const BundleWindowEnum = z.enum(['1d', '7d', '30d']);
export type BundleWindowSchema = z.infer<typeof BundleWindowEnum>;

// Chain enum
export const BundleChainEnum = z.enum(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon']);
export type BundleChainSchema = z.infer<typeof BundleChainEnum>;

/**
 * Query active bundles
 */
export const QueryActiveBundlesSchema = z.object({
  window: BundleWindowEnum.optional().default('7d'),
  bundleType: BundleTypeEnum.optional(),
  minIntensity: z.coerce.number().min(0).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional().default(0.5),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});
export type QueryActiveBundlesInput = z.infer<typeof QueryActiveBundlesSchema>;

/**
 * Query bundles for address
 */
export const QueryByAddressSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address'),
  window: BundleWindowEnum.optional().default('7d'),
  direction: z.enum(['in', 'out', 'both']).optional().default('both'),
  bundleType: BundleTypeEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
export type QueryByAddressInput = z.infer<typeof QueryByAddressSchema>;

/**
 * Query corridor bundle
 */
export const QueryCorridorSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid from address'),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid to address'),
  window: BundleWindowEnum.optional().default('7d'),
});
export type QueryCorridorInput = z.infer<typeof QueryCorridorSchema>;

/**
 * Bundle response
 */
export const BundleResponseSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  chain: BundleChainEnum,
  window: BundleWindowEnum,
  bundleType: BundleTypeEnum,
  confidence: z.number(),
  interactionCount: z.number(),
  densityScore: z.number(),
  netflowRaw: z.string(),
  netflowDirection: z.enum(['in', 'out', 'balanced']),
  intensityScore: z.number(),
  consistencyScore: z.number(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
});
export type BundleResponse = z.infer<typeof BundleResponseSchema>;
