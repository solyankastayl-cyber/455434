/**
 * PHASE 2.1 — Feature Snapshot Types
 * ====================================
 * 
 * Snapshot = system state at time t0, BEFORE market moves.
 * 
 * IMMUTABLE CONTRACT v1
 * ---------------------
 * - NO future price data allowed
 * - NO targets or outcomes
 * - NULL values are acceptable (important for data quality)
 * - completeness is calculated honestly
 */

// ═══════════════════════════════════════════════════════════════
// VERDICT TYPES
// ═══════════════════════════════════════════════════════════════

export type VerdictDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'NO_DATA';
export type WhaleRisk = 'LOW' | 'MID' | 'HIGH' | 'UNKNOWN';
export type Readiness = 'READY' | 'RISKY' | 'AVOID' | 'DEGRADED' | 'NO_DATA';
export type Alignment = 'ALIGNED' | 'PARTIAL' | 'CONFLICT' | 'NO_DATA';
export type Validation = 'CONFIRMS' | 'CONTRADICTS' | 'NO_DATA';

// ═══════════════════════════════════════════════════════════════
// EXCHANGE CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface ExchangeContext {
  verdict: VerdictDirection;
  confidence: number;         // 0..1
  regime: string;             // e.g., 'ACCUMULATION', 'EXHAUSTION'
  stress: number;             // 0..1
  patterns: string[];         // active patterns
  whaleRisk: WhaleRisk;
  readiness: Readiness;
}

// ═══════════════════════════════════════════════════════════════
// SENTIMENT CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface SentimentContext {
  verdict: VerdictDirection;
  confidence: number;         // 0..1
  alignment: Alignment;       // alignment with exchange
}

// ═══════════════════════════════════════════════════════════════
// ONCHAIN CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface OnchainContext {
  validation: Validation;     // does onchain confirm exchange?
  confidence: number;         // 0..1
}

// ═══════════════════════════════════════════════════════════════
// META-BRAIN CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface MetaBrainContext {
  finalVerdict: string;       // final decision
  finalConfidence: number;    // 0..1
  downgraded: boolean;        // was confidence reduced?
  downgradedBy: string | null; // which guard triggered
}

// ═══════════════════════════════════════════════════════════════
// FEATURE SNAPSHOT (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

export interface FeatureSnapshot {
  snapshotId: string;
  symbol: string;
  timestamp: number;          // t0 (ms since epoch)

  // TRIAD inputs
  exchange: ExchangeContext;
  sentiment: SentimentContext;
  onchain: OnchainContext;

  // Final decision
  metaBrain: MetaBrainContext;

  // Quality metadata
  meta: {
    dataCompleteness: number; // 0..1 (how much data was available)
    providers: string[];      // data sources used
    dataMode: 'LIVE' | 'MOCK' | 'MIXED';
    version: 'v1';
  };
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface CreateSnapshotResponse {
  ok: boolean;
  snapshot?: FeatureSnapshot;
  error?: string;
}

export interface SnapshotHistoryResponse {
  ok: boolean;
  symbol: string;
  count: number;
  snapshots: FeatureSnapshot[];
}

export interface SnapshotStatsResponse {
  ok: boolean;
  symbol: string;
  total: number;
  avgCompleteness: number;
  byDataMode: {
    LIVE: number;
    MOCK: number;
    MIXED: number;
  };
  timeRange: {
    from: number;
    to: number;
  } | null;
}

console.log('[Phase 2.1] FeatureSnapshot Types loaded');
