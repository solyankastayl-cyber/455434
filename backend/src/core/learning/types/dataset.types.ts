/**
 * Learning Dataset Types
 * 
 * ETAP 3.4: Type definitions for ML training dataset.
 * 
 * Contract v1 - features and labels schema.
 */

import type { Bucket, Horizon, DriftLevel } from '../learning.types.js';
import type { TrendLabel, DelayLabel } from './trend.types.js';
import type { Verdict } from './attribution.types.js';

// ==================== SCHEMA VERSION ====================

export const DATASET_SCHEMA_VERSION = 'v1.0.0';

// ==================== FEATURE VECTOR ====================

export interface SnapshotFeatures {
  bucket: Bucket;
  compositeScore: number;
  engineScore: number;
  engineConfidence_raw: number;
  risk_raw: number;
  coverageLevel: string;
  engineMode: string;
  actorSignalScore: number;
  topPositiveSignals: string[];
  topNegativeSignals: string[];
}

export interface LiveFeatures {
  live_netFlow: number;
  live_inflow: number;
  live_outflow: number;
  live_uniqueSenders: number;
  live_uniqueReceivers: number;
  live_exchangeInflow: number;
  live_exchangeOutflow: number;
  live_liquidityChangePct: number;
  live_eventCount: number;
  liveCoverage: 'FULL' | 'PARTIAL' | 'NONE';
}

export interface DriftFeatures {
  driftLevel: DriftLevel;
  driftScore: number;
  confidenceModifier: number;
  engineConfidence_adj: number;
}

export interface MarketFeatures {
  priceAtDecision: number;
  mcapAtDecision: number;
  volumeAtDecision: number;
  momentumAtDecision: number;
}

export interface FeatureVector {
  snapshot: SnapshotFeatures;
  live: LiveFeatures;
  drift: DriftFeatures;
  market: MarketFeatures;
}

// ==================== LABELS ====================

export interface TrendLabels {
  trend_1d: TrendLabel | null;
  trend_7d: TrendLabel | null;
  trend_30d: TrendLabel | null;
}

export interface DelayLabels {
  delayClass_7d: DelayLabel | null;
  delayClass_30d: DelayLabel | null;
}

export interface OutcomeLabels {
  ret_1d_pct: number | null;
  ret_7d_pct: number | null;
  ret_30d_pct: number | null;
  maxDrawdown_7d: number | null;
  maxDrawdown_30d: number | null;
}

export interface VerdictLabels {
  verdict_1d: Verdict | null;
  verdict_7d: Verdict | null;
  verdict_30d: Verdict | null;
}

export interface Labels {
  trends: TrendLabels;
  delays: DelayLabels;
  outcomes: OutcomeLabels;
  verdicts: VerdictLabels;
}

// ==================== SAMPLE ====================

export interface SampleQuality {
  trainEligible: boolean;
  reasons: string[];
  liveCoverage: 'FULL' | 'PARTIAL' | 'NONE';
  trendCoverage: number;    // 0-3 horizons
  verdictCoverage: number;  // 0-3 horizons
  dataCompleteness: number; // 0-1
}

export interface LearningSampleData {
  sampleId: string;         // snapshotId:horizon
  snapshotId: string;
  tokenAddress: string;
  symbol: string;
  horizon: Horizon;
  snapshotAt: Date;
  
  features: FeatureVector;
  labels: Labels;
  quality: SampleQuality;
  
  schemaVersion: string;
  builtAt: Date;
}

// ==================== BUILD CONFIG ====================

export interface DatasetBuildConfig {
  horizons: Horizon[];
  since?: Date;
  until?: Date;
  mode: 'incremental' | 'backfill';
  limit?: number;
  includeNoLive: boolean;     // Include samples without approved LIVE
  includeCriticalDrift: boolean; // Include CRITICAL drift (trainEligible=false)
}

export interface BuildRunResult {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  config: DatasetBuildConfig;
  stats: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    skipReasons: Record<string, number>;
  };
}
