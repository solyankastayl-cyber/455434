/**
 * Scores Zod Schemas
 * Validation schemas for scores API
 */
import { z } from 'zod';

// Subject types
export const scoreSubjectTypeSchema = z.enum(['address', 'actor', 'entity']);

// Windows
export const scoreWindowSchema = z.enum(['7d', '30d', '90d']);

// Tiers
export const scoreTierSchema = z.enum(['green', 'yellow', 'orange', 'red']);

// Sort options
export const scoreSortSchema = z.enum([
  'composite',
  'behavior',
  'intensity',
  'consistency',
  'risk',
  'influence',
]);

// Address validation
export const ethereumAddressSchema = z.string().regex(
  /^0x[a-fA-F0-9]{40}$/,
  'Invalid Ethereum address'
);

// Query params for address score
export const getAddressScoreQuerySchema = z.object({
  window: scoreWindowSchema.optional().default('30d'),
});

// Query params for top scores
export const getTopScoresQuerySchema = z.object({
  type: scoreSubjectTypeSchema.optional().default('address'),
  sort: scoreSortSchema.optional().default('composite'),
  tier: scoreTierSchema.optional(),
  window: scoreWindowSchema.optional().default('30d'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

// Query params for watchlist
export const getWatchlistScoresQuerySchema = z.object({
  addresses: z.string().transform((s) => s.split(',')),
  window: scoreWindowSchema.optional().default('30d'),
});

// Type exports
export type ScoreSubjectType = z.infer<typeof scoreSubjectTypeSchema>;
export type ScoreWindow = z.infer<typeof scoreWindowSchema>;
export type ScoreTier = z.infer<typeof scoreTierSchema>;
export type ScoreSort = z.infer<typeof scoreSortSchema>;
export type GetAddressScoreQuery = z.infer<typeof getAddressScoreQuerySchema>;
export type GetTopScoresQuery = z.infer<typeof getTopScoresQuerySchema>;
export type GetWatchlistScoresQuery = z.infer<typeof getWatchlistScoresQuerySchema>;
