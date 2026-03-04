/**
 * PHASE 2.2 — Dataset Types
 * ==========================
 * 
 * Types for ML dataset construction.
 * 
 * DatasetRow = FeatureSnapshot (t0) + Target (t1)
 * 
 * IMMUTABLE CONTRACT v1
 * ---------------------
 * - Features are from t0 (snapshot)
 * - Target is from t1 (truth evaluation)
 * - No leakage: t1 data never in features
 */

// ═══════════════════════════════════════════════════════════════
// ENCODED FEATURES (numeric for ML)
// ═══════════════════════════════════════════════════════════════

export interface EncodedFeatures {
  // Exchange (5 features)
  exchangeVerdict: number;      // BULL=1, NEUTRAL=0, BEAR=-1
  exchangeConfidence: number;   // 0..1
  stress: number;               // 0..1
  whaleRisk: number;            // LOW=0, MID=0.5, HIGH=1
  readinessScore: number;       // READY=1, RISKY=0.5, AVOID/DEGRADED=0

  // Sentiment (3 features)
  sentimentVerdict: number;     // 1 / 0 / -1
  sentimentConfidence: number;  // 0..1
  alignment: number;            // ALIGNED=1, PARTIAL=0.5, CONFLICT=0

  // Onchain (2 features)
  onchainValidation: number;    // CONFIRMS=1, NO_DATA=0.5, CONTRA=0
  onchainConfidence: number;    // 0..1

  // Meta (1 feature)
  dataCompleteness: number;     // 0..1
}

// ═══════════════════════════════════════════════════════════════
// TARGET (what happened after t0)
// ═══════════════════════════════════════════════════════════════

export interface DatasetTarget {
  priceChangePct: number;       // actual price change %
  direction: 1 | -1 | 0;        // UP / DOWN / FLAT
  confirmed: boolean;           // did verdict match reality?
  diverged: boolean;            // did verdict diverge from reality?
  maxAdverseMove: number;       // worst drawdown before t1
  maxFavorableMove: number;     // best gain before t1
}

// ═══════════════════════════════════════════════════════════════
// DATASET ROW
// ═══════════════════════════════════════════════════════════════

export interface DatasetRow {
  rowId: string;
  symbol: string;

  t0: number;                   // snapshot timestamp
  t1: number;                   // evaluation timestamp

  snapshotId: string;           // reference to original snapshot

  features: EncodedFeatures;
  target: DatasetTarget;

  meta: {
    horizonBars: number;        // how many bars between t0 and t1
    horizonHours: number;       // hours between t0 and t1
    dataQuality: number;        // from snapshot completeness
    version: 'v1';
  };
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface BuildDatasetResponse {
  ok: boolean;
  symbol: string;
  rowsCreated: number;
  skipped: {
    noTruth: number;
    lowQuality: number;
    alreadyExists: number;
  };
  error?: string;
}

export interface DatasetStatsResponse {
  ok: boolean;
  symbol: string;
  total: number;
  confirmed: number;
  diverged: number;
  confirmRate: number;
  avgConfidence: number;
  timeRange: {
    from: number;
    to: number;
  } | null;
}

export interface DatasetReadyResponse {
  ok: boolean;
  total: number;
  usable: number;
  discarded: {
    lowCompleteness: number;
    mockData: number;
    noTarget: number;
  };
  bySymbol: Record<string, number>;
}

console.log('[Phase 2.2] Dataset Types loaded');
