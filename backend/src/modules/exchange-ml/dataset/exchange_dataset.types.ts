/**
 * Exchange Auto-Learning Loop - PR1: Dataset Types
 * 
 * These types define the core data structures for the auto-learning system:
 * - Samples: Feature snapshots at signal time (t0)
 * - Labels: Resolved outcomes (WIN/LOSS) after horizon period
 * - Jobs: Scheduled labeling tasks
 */

// ═══════════════════════════════════════════════════════════════
// HORIZONS (LOCKED - Same as existing exchange module)
// ═══════════════════════════════════════════════════════════════

export type ExchangeHorizon = '1D' | '7D' | '30D';

export const HORIZON_MS: Record<ExchangeHorizon, number> = {
  '1D': 24 * 60 * 60 * 1000,      // 24 hours
  '7D': 7 * 24 * 60 * 60 * 1000,  // 7 days
  '30D': 30 * 24 * 60 * 60 * 1000, // 30 days
};

// ═══════════════════════════════════════════════════════════════
// SAMPLE STATUS
// ═══════════════════════════════════════════════════════════════

export type SampleStatus = 
  | 'PENDING'      // Waiting for label resolution
  | 'RESOLVED'     // Label assigned (WIN/LOSS)
  | 'EXPIRED'      // Too old to resolve
  | 'ERROR';       // Error during resolution

// ═══════════════════════════════════════════════════════════════
// LABEL RESULT
// ═══════════════════════════════════════════════════════════════

export type LabelResult = 'WIN' | 'LOSS' | 'NEUTRAL';

// ═══════════════════════════════════════════════════════════════
// SAMPLE DOCUMENT (exch_dataset_samples collection)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeSample {
  // Identity (unique key: symbol + horizon + t0)
  _id?: string;
  symbol: string;
  horizon: ExchangeHorizon;
  t0: Date;                        // Signal timestamp
  
  // Feature snapshot at t0
  features: ExchangeFeatureSnapshot;
  featureVersion: string;          // e.g., 'v1.0.0'
  
  // Entry price at t0
  entryPrice: number;
  
  // Label (filled after resolution)
  label: LabelResult | null;
  status: SampleStatus;
  
  // Resolution details
  resolveAt: Date;                 // When to resolve (t0 + horizon)
  resolvedAt: Date | null;         // When actually resolved
  exitPrice: number | null;        // Price at resolveAt
  returnPct: number | null;        // (exitPrice - entryPrice) / entryPrice
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  
  // Original signal data (for debugging)
  signalMeta?: {
    verdictId?: string;
    confidence?: number;
    direction?: 'LONG' | 'SHORT' | 'NEUTRAL';
    expectedReturn?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE SNAPSHOT (What we capture at t0)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeFeatureSnapshot {
  // Price features
  price: number;
  priceChange24h: number;
  priceChange7d: number;
  
  // Volume features  
  volume24h: number;
  volumeRatio: number;            // vs 7d average
  
  // Technical indicators
  rsi14: number | null;
  macdSignal: number | null;
  bbWidth: number | null;         // Bollinger Band width
  
  // Funding & OI (if available)
  fundingRate: number | null;
  openInterest: number | null;
  oiChange24h: number | null;
  
  // Sentiment features (if available)
  sentimentScore: number | null;
  
  // Regime features
  regimeType: string | null;
  regimeConfidence: number | null;
  
  // Market context
  btcCorrelation: number | null;
  marketStress: number | null;
  
  // Raw feature vector for ML
  rawVector?: number[];
}

// ═══════════════════════════════════════════════════════════════
// LABEL JOB (exch_label_jobs collection)
// ═══════════════════════════════════════════════════════════════

export type LabelJobStatus = 
  | 'PENDING'      // Scheduled for resolution
  | 'PROCESSING'   // Currently being processed
  | 'COMPLETED'    // Successfully resolved
  | 'FAILED';      // Error during resolution

export interface ExchangeLabelJob {
  _id?: string;
  sampleId: string;                // Reference to exch_dataset_samples._id
  
  // Job scheduling
  resolveAt: Date;                 // When to run
  status: LabelJobStatus;
  
  // Processing details
  attempts: number;
  lastAttemptAt: Date | null;
  error: string | null;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// LABELING THRESHOLDS (Configurable)
// ═══════════════════════════════════════════════════════════════

export interface LabelingConfig {
  // WIN threshold: returnPct >= winThreshold
  winThreshold: number;            // e.g., 0.01 = 1%
  
  // NEUTRAL zone: |returnPct| < neutralZone
  neutralZone: number;             // e.g., 0.005 = 0.5%
  
  // Direction-aware labeling
  useDirectionAware: boolean;      // If true, consider signal direction
  
  // Max age for resolution (samples older than this are EXPIRED)
  maxAgeDays: number;              // e.g., 45 days
}

export const DEFAULT_LABELING_CONFIG: LabelingConfig = {
  winThreshold: 0.01,              // 1% profit = WIN
  neutralZone: 0.005,              // +/- 0.5% = NEUTRAL
  useDirectionAware: true,
  maxAgeDays: 45,
};

// ═══════════════════════════════════════════════════════════════
// DATASET STATS
// ═══════════════════════════════════════════════════════════════

export interface DatasetStats {
  totalSamples: number;
  byStatus: Record<SampleStatus, number>;
  byHorizon: Record<ExchangeHorizon, number>;
  byLabel: Record<LabelResult | 'PENDING', number>;
  
  // Time range
  oldestSample: Date | null;
  newestSample: Date | null;
  
  // Resolution stats
  avgResolutionDelayMs: number;
  pendingCount: number;
  
  // Label distribution
  winRate: number;                 // WIN / (WIN + LOSS)
}

console.log('[Exchange ML] Dataset types loaded');
