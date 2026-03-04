/**
 * Normalized Alert Event Schema (A0)
 * 
 * Purpose: Единый формат для всех типов алертов
 * Makes events comparable, dedupable, scorable, groupable
 */
import { z } from 'zod';

export const NormalizedEventMetricsSchema = z.object({
  value: z.number(),              // Actual measured value
  threshold: z.number(),          // Rule threshold
  baseline: z.number(),           // Baseline for comparison
  deviation: z.number(),          // % deviation from baseline
  direction: z.enum(['in', 'out']),
});

export const MarketContextSchema = z.object({
  regime: z.enum(['trend', 'range', 'volatility']).optional(),
  sentiment: z.enum(['bullish', 'neutral', 'bearish']).optional(),
}).optional();

export const NormalizedAlertEventSchema = z.object({
  // Identity
  eventId: z.string(),
  ruleId: z.string(),
  userId: z.string(),
  
  // What happened
  signalType: z.string(),
  scope: z.enum(['strategy', 'actor', 'entity', 'token', 'wallet']),
  targetId: z.string(),
  targetMeta: z.object({
    symbol: z.string().optional(),
    name: z.string().optional(),
    chain: z.string().optional(),
  }).optional(),
  
  // When
  triggeredAt: z.date(),
  
  // How much (normalized metrics)
  metrics: NormalizedEventMetricsSchema,
  
  // Quality
  confidence: z.number().min(0).max(1),
  
  // Context (for A2 - severity)
  marketContext: MarketContextSchema,
  
  // Raw data (for reference)
  rawSignal: z.any().optional(),
});

// Type export
export type NormalizedAlertEvent = z.infer<typeof NormalizedAlertEventSchema>;
export type NormalizedEventMetrics = z.infer<typeof NormalizedEventMetricsSchema>;
export type MarketContext = z.infer<typeof MarketContextSchema>;
