/**
 * Wallet Profile Schema (B1)
 * 
 * Purpose: "Кто это? Трейдер? Фонд? Мост? Degen?"
 * 
 * WalletProfile — агрегированное поведение, не события.
 * Это snapshot, обновляется раз в N минут.
 * 
 * WITHOUT this:
 * - Smart Money = магия
 * - Correlations = шум
 * - Alerts = недоверие
 */
import { z } from 'zod';

/**
 * Dominant behavior type
 */
export const DominantActionEnum = z.enum([
  'buy',      // Primarily buying/accumulating
  'sell',     // Primarily selling/distributing
  'bridge',   // Bridge/cross-chain user
  'lp',       // Liquidity provider
  'mixed',    // No clear dominant action
]);

/**
 * Wallet tags - behavioral labels
 */
export const WalletTagEnum = z.enum([
  // Activity tags
  'active',           // Regular activity
  'dormant',          // Inactive for long period
  'new',              // Recently created
  
  // Volume tags
  'high-volume',      // Large transaction volumes
  'low-volume',       // Small transactions
  'whale',            // Very large holdings
  
  // Behavior tags
  'trader',           // Frequent trading
  'holder',           // Long-term holding
  'flipper',          // Quick buy-sell patterns
  'degen',            // High-risk behavior
  
  // Technical tags
  'bridge-user',      // Uses bridges frequently
  'cex-like',         // CEX-like patterns
  'contract',         // Smart contract
  'multisig',         // Multi-signature wallet
]);

/**
 * Activity metrics
 */
export const ActivityMetricsSchema = z.object({
  firstSeen: z.date(),
  lastSeen: z.date(),
  activeDays: z.number(),
  txCount: z.number(),
  avgTxPerDay: z.number().optional(),
});

/**
 * Flow metrics (in USD or native token)
 */
export const FlowMetricsSchema = z.object({
  totalIn: z.number(),
  totalOut: z.number(),
  netFlow: z.number(),        // totalIn - totalOut
  avgTxSize: z.number(),
  maxTxSize: z.number().optional(),
});

/**
 * Behavior metrics
 */
export const BehaviorMetricsSchema = z.object({
  dominantAction: DominantActionEnum,
  
  // Activity pattern
  burstinessScore: z.number().min(0).max(1), // 0 = uniform, 1 = very bursty
  
  // Trading style
  holdingPeriodAvg: z.number().optional(),   // Average days holding tokens
  
  // Risk indicators
  diversificationScore: z.number().min(0).max(1).optional(), // 0 = concentrated, 1 = diversified
});

/**
 * Token interaction summary
 */
export const TokenInteractionSchema = z.object({
  address: z.string(),
  symbol: z.string().optional(),
  name: z.string().optional(),
  
  // Interaction stats
  buyVolume: z.number(),
  sellVolume: z.number(),
  netVolume: z.number(),
  txCount: z.number(),
  
  // Timing
  firstInteraction: z.date(),
  lastInteraction: z.date(),
});

/**
 * Main Wallet Profile Schema
 */
export const WalletProfileSchema = z.object({
  // Identity
  address: z.string(),
  chain: z.string().default('Ethereum'),
  
  // Profile metadata
  profileId: z.string(),
  updatedAt: z.date(),
  snapshotVersion: z.number().default(1),
  
  // Aggregated metrics
  activity: ActivityMetricsSchema,
  flows: FlowMetricsSchema,
  behavior: BehaviorMetricsSchema,
  
  // Token interactions (top N by volume)
  tokens: z.object({
    interactedCount: z.number(),
    topTokens: z.array(TokenInteractionSchema).max(10),
  }),
  
  // Behavioral tags
  tags: z.array(WalletTagEnum),
  
  // Profile confidence (0-1)
  // Low confidence = not enough data
  confidence: z.number().min(0).max(1),
  
  // Human-readable summary
  summary: z.object({
    headline: z.string(),      // "Active trader with high volume"
    description: z.string(),   // Longer explanation
  }).optional(),
});

/**
 * Profile update event (for tracking changes)
 */
export const ProfileUpdateEventSchema = z.object({
  profileId: z.string(),
  address: z.string(),
  
  updateType: z.enum(['created', 'refreshed', 'tags_changed']),
  
  previousTags: z.array(WalletTagEnum).optional(),
  newTags: z.array(WalletTagEnum).optional(),
  
  timestamp: z.date(),
});

// Type exports
export type DominantAction = z.infer<typeof DominantActionEnum>;
export type WalletTag = z.infer<typeof WalletTagEnum>;
export type ActivityMetrics = z.infer<typeof ActivityMetricsSchema>;
export type FlowMetrics = z.infer<typeof FlowMetricsSchema>;
export type BehaviorMetrics = z.infer<typeof BehaviorMetricsSchema>;
export type TokenInteraction = z.infer<typeof TokenInteractionSchema>;
export type WalletProfile = z.infer<typeof WalletProfileSchema>;
export type ProfileUpdateEvent = z.infer<typeof ProfileUpdateEventSchema>;
