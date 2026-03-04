/**
 * Smart Money Profile Schema (B4)
 * 
 * Purpose: "Этот кошелёк historically приводил к результату?"
 * 
 * CRITICAL RULES:
 * - B4 ≠ сигнал, B4 = контекст + усилитель доверия
 * - B4 никогда не триггерит алерт
 * - B4 влияет на интерпретацию A-layer
 * - sampleSize < N → label = 'emerging'
 * - NO external "alpha lists"
 * - NO "trust me bro"
 * 
 * Smart ≠ "умный" / "крупный" / "часто торгует"
 * Smart = коррелирует с исходом / раньше рынка / повторяемо
 */
import { z } from 'zod';

/**
 * Subject type - wallet or cluster
 */
export const SubjectTypeEnum = z.enum([
  'wallet',   // Individual wallet
  'cluster',  // Confirmed cluster from B3
]);

/**
 * Smart Money Label
 * RULE: sampleSize < MIN_SAMPLE → label = 'emerging'
 */
export const SmartLabelEnum = z.enum([
  'emerging',  // Not enough data yet
  'proven',    // Consistent performance
  'elite',     // Top tier performance
]);

/**
 * Performance metrics
 */
export const PerformanceMetricsSchema = z.object({
  winRate: z.number().min(0).max(1),           // Win rate (0-1)
  avgReturn: z.number(),                        // Average return %
  maxDrawdown: z.number().min(0).max(1),       // Max drawdown (0-1)
  medianHoldTime: z.number(),                   // Median holding time in hours
});

/**
 * Correlation metrics (with outcomes)
 */
export const CorrelationMetricsSchema = z.object({
  accumulationSuccess: z.number().min(0).max(1),  // Success rate on accumulation
  distributionTiming: z.number().min(0).max(1),   // Timing quality on distributions
});

/**
 * Score components - transparent breakdown
 */
export const ScoreComponentsSchema = z.object({
  winRateContrib: z.number(),           // 40% weight
  accumulationContrib: z.number(),      // 30% weight
  timingContrib: z.number(),            // 20% weight
  drawdownPenalty: z.number(),          // -10% penalty
});

/**
 * Main Smart Money Profile Schema
 */
export const SmartMoneyProfileSchema = z.object({
  profileId: z.string(),
  
  // Subject identification
  subjectType: SubjectTypeEnum,
  subjectId: z.string(),  // wallet address or clusterId
  
  // Sample size - CRITICAL for confidence
  sampleSize: z.number().min(0),  // Number of events analyzed
  
  // Confidence (derived from sampleSize)
  // confidence = min(1, sampleSize / TARGET_SAMPLE)
  confidence: z.number().min(0).max(1),
  
  // Performance metrics
  performance: PerformanceMetricsSchema,
  
  // Correlation with outcomes
  correlation: CorrelationMetricsSchema,
  
  // Derived score (0-100)
  score: z.number().min(0).max(100),
  
  // Score breakdown (transparent)
  scoreComponents: ScoreComponentsSchema,
  
  // Label (depends on score AND sampleSize)
  label: SmartLabelEnum,
  
  // Label explanation
  labelExplanation: z.string(),
  
  // Analysis period
  analysisPeriod: z.object({
    startDate: z.date(),
    endDate: z.date(),
    daysAnalyzed: z.number(),
  }),
  
  // Chain
  chain: z.string().default('Ethereum'),
  
  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Smart Money Summary for UI
 * Used in alerts and token pages
 */
export const SmartMoneySummarySchema = z.object({
  // Badge info
  hasSmartMoney: z.boolean(),
  smartMoneyCount: z.number(),
  
  // Top performer
  topPerformer: z.object({
    subjectId: z.string(),
    subjectType: SubjectTypeEnum,
    label: SmartLabelEnum,
    winRate: z.number(),
    sampleSize: z.number(),
  }).optional(),
  
  // Human-readable summary
  summary: z.string(),
  
  // Tooltip text
  tooltip: z.string(),
});

/**
 * Smart Money in Alert context
 * For enriching alerts with B4 data
 */
export const AlertSmartMoneyContextSchema = z.object({
  groupId: z.string(),
  
  // Smart money involvement
  smartMoneyInvolved: z.boolean(),
  smartMoneyCount: z.number(),
  
  // Labels breakdown
  labelCounts: z.object({
    elite: z.number(),
    proven: z.number(),
    emerging: z.number(),
  }),
  
  // Context for alert
  contextText: z.string(),  // "Wallets with historically strong performance observed"
  
  // Confidence boost suggestion
  confidenceBoost: z.number().min(0).max(0.2),  // Max 20% boost
  
  calculatedAt: z.date(),
});

// Type exports
export type SubjectType = z.infer<typeof SubjectTypeEnum>;
export type SmartLabel = z.infer<typeof SmartLabelEnum>;
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;
export type CorrelationMetrics = z.infer<typeof CorrelationMetricsSchema>;
export type SmartMoneyScoreComponents = z.infer<typeof ScoreComponentsSchema>;
export type SmartMoneyProfile = z.infer<typeof SmartMoneyProfileSchema>;
export type SmartMoneySummary = z.infer<typeof SmartMoneySummarySchema>;
export type AlertSmartMoneyContext = z.infer<typeof AlertSmartMoneyContextSchema>;
