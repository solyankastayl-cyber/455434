/**
 * TA Module Contracts - Type definitions for Technical Analysis
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
// OHLCV Data
// ═══════════════════════════════════════════════════════════════

export const OhlcvCandleSchema = z.object({
  ts: z.number(),           // Unix timestamp
  date: z.string(),         // ISO date string
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional()
});

export type OhlcvCandle = z.infer<typeof OhlcvCandleSchema>;

// ═══════════════════════════════════════════════════════════════
// Pivot Points
// ═══════════════════════════════════════════════════════════════

export const PivotPointSchema = z.object({
  type: z.enum(['HIGH', 'LOW']),
  price: z.number(),
  ts: z.number(),
  index: z.number(),
  strength: z.number().min(0).max(1)  // 0-1 confidence
});

export type PivotPoint = z.infer<typeof PivotPointSchema>;

// ═══════════════════════════════════════════════════════════════
// Support/Resistance Levels
// ═══════════════════════════════════════════════════════════════

export const LevelSchema = z.object({
  price: z.number(),
  type: z.enum(['SUPPORT', 'RESISTANCE']),
  strength: z.number().min(0).max(1),
  touchCount: z.number(),
  firstTouch: z.number(),     // timestamp
  lastTouch: z.number(),      // timestamp
  broken: z.boolean().default(false)
});

export type Level = z.infer<typeof LevelSchema>;

// ═══════════════════════════════════════════════════════════════
// Market Structure
// ═══════════════════════════════════════════════════════════════

export const MarketStructureSchema = z.object({
  trend: z.enum(['UPTREND', 'DOWNTREND', 'SIDEWAYS']),
  strength: z.number().min(0).max(1),
  swingHighs: z.array(PivotPointSchema),
  swingLows: z.array(PivotPointSchema),
  higherHighs: z.boolean(),
  higherLows: z.boolean(),
  lowerHighs: z.boolean(),
  lowerLows: z.boolean()
});

export type MarketStructure = z.infer<typeof MarketStructureSchema>;

// ═══════════════════════════════════════════════════════════════
// Pattern Detection
// ═══════════════════════════════════════════════════════════════

export const PatternTypeSchema = z.enum([
  // Chart Patterns
  'TRIANGLE_ASC',
  'TRIANGLE_DESC',
  'TRIANGLE_SYM',
  'FLAG_BULL',
  'FLAG_BEAR',
  'WEDGE_RISING',
  'WEDGE_FALLING',
  'DOUBLE_TOP',
  'DOUBLE_BOTTOM',
  'HEAD_SHOULDERS',
  'INV_HEAD_SHOULDERS',
  // Harmonic Patterns
  'GARTLEY',
  'BAT',
  'BUTTERFLY',
  'CRAB',
  // Candlestick Patterns
  'ENGULFING_BULL',
  'ENGULFING_BEAR',
  'HAMMER',
  'SHOOTING_STAR',
  'DOJI',
  'MORNING_STAR',
  'EVENING_STAR'
]);

export type PatternType = z.infer<typeof PatternTypeSchema>;

export const DetectedPatternSchema = z.object({
  type: PatternTypeSchema,
  confidence: z.number().min(0).max(1),
  direction: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
  startTs: z.number(),
  endTs: z.number(),
  pivots: z.array(PivotPointSchema),
  targetPrice: z.number().optional(),
  invalidationPrice: z.number().optional()
});

export type DetectedPattern = z.infer<typeof DetectedPatternSchema>;

// ═══════════════════════════════════════════════════════════════
// TA Scenario (Output)
// ═══════════════════════════════════════════════════════════════

export const TaScenarioSchema = z.object({
  id: z.string(),
  asset: z.string(),
  timeframe: z.string(),
  direction: z.enum(['LONG', 'SHORT', 'NEUTRAL']),
  confidence: z.number().min(0).max(1),
  entryPrice: z.number(),
  targetPrice: z.number(),
  stopPrice: z.number(),
  riskReward: z.number(),
  patterns: z.array(DetectedPatternSchema),
  levels: z.array(LevelSchema),
  structure: MarketStructureSchema,
  createdAt: z.string(),
  expiresAt: z.string().optional()
});

export type TaScenario = z.infer<typeof TaScenarioSchema>;

// ═══════════════════════════════════════════════════════════════
// Analyze Request/Response
// ═══════════════════════════════════════════════════════════════

export const TaAnalyzeRequestSchema = z.object({
  asset: z.string(),
  timeframe: z.string().default('1D'),
  lookback: z.number().default(200)
});

export type TaAnalyzeRequest = z.infer<typeof TaAnalyzeRequestSchema>;

export const TaAnalyzeResponseSchema = z.object({
  ok: z.boolean(),
  asset: z.string(),
  timeframe: z.string(),
  structure: MarketStructureSchema,
  levels: z.array(LevelSchema),
  patterns: z.array(DetectedPatternSchema),
  scenarios: z.array(TaScenarioSchema),
  timestamp: z.string()
});

export type TaAnalyzeResponse = z.infer<typeof TaAnalyzeResponseSchema>;

// ═══════════════════════════════════════════════════════════════
// Module Registry
// ═══════════════════════════════════════════════════════════════

export interface TaModuleConfig {
  name: string;
  type: 'prediction';
  scope: 'market';
  enabled: boolean;
  version: string;
}
