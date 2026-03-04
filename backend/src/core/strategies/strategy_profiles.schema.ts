/**
 * Strategy Profiles Zod Schemas
 */
import { z } from 'zod';

// Strategy types
export const strategyTypeSchema = z.enum([
  'accumulation_sniper',
  'distribution_whale',
  'momentum_rider',
  'rotation_trader',
  'wash_operator',
  'liquidity_farmer',
  'mixed',
]);

// Risk levels
export const riskLevelSchema = z.enum(['low', 'medium', 'high']);

// Influence levels
export const influenceLevelSchema = z.enum(['low', 'medium', 'high']);

// Sort options
export const strategySortSchema = z.enum([
  'confidence',
  'stability',
  'influence',
  'risk',
  'recent',
]);

// Query params for top strategies
export const getTopStrategiesQuerySchema = z.object({
  type: strategyTypeSchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  influenceLevel: influenceLevelSchema.optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  sort: strategySortSchema.optional().default('confidence'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

// Query params for stats
export const getStrategyStatsQuerySchema = z.object({
  chain: z.string().optional().default('ethereum'),
});

// Type exports
export type StrategyTypeEnum = z.infer<typeof strategyTypeSchema>;
export type RiskLevelEnum = z.infer<typeof riskLevelSchema>;
export type InfluenceLevelEnum = z.infer<typeof influenceLevelSchema>;
export type StrategySortEnum = z.infer<typeof strategySortSchema>;
export type GetTopStrategiesQuery = z.infer<typeof getTopStrategiesQuerySchema>;
