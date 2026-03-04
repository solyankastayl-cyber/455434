/**
 * C1 — Alignment Contracts
 * 
 * Types for Exchange × Sentiment Alignment.
 * 
 * LOCKED v1 — do not modify without versioning.
 */

// ═══════════════════════════════════════════════════════════════
// DIRECTION
// ═══════════════════════════════════════════════════════════════

export type DirectionVerdict = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

// ═══════════════════════════════════════════════════════════════
// ALIGNMENT TYPES
// ═══════════════════════════════════════════════════════════════

export type AlignmentType =
  | 'CONFIRMED'      // sentiment and exchange agree
  | 'CONTRADICTED'   // sentiment and exchange disagree
  | 'IGNORED'        // both neutral, no direction
  | 'EXCHANGE_ONLY'  // exchange confident, sentiment not usable
  | 'SENTIMENT_ONLY' // sentiment confident, exchange not ready
  | 'NO_DATA';       // insufficient data from both

// ═══════════════════════════════════════════════════════════════
// LAYER INPUTS
// ═══════════════════════════════════════════════════════════════

export interface ExchangeLayerInput {
  verdict: DirectionVerdict;
  confidence: number; // 0..1
  readiness: 'READY' | 'DEGRADED' | 'NO_DATA';
  reasons?: string[];
  drivers?: string[];
}

export interface SentimentLayerInput {
  verdict: DirectionVerdict;
  confidence: number; // 0..1
  usable: boolean;
  reasons?: string[];
  drivers?: string[];
  keywords?: string[];
  source?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export interface AlignmentConfig {
  minExchangeConfidence: number;   // default 0.45
  minSentimentConfidence: number;  // default 0.35
}

export const DEFAULT_ALIGNMENT_CONFIG: AlignmentConfig = {
  minExchangeConfidence: 0.45,
  minSentimentConfidence: 0.35,
};

// ═══════════════════════════════════════════════════════════════
// ALIGNMENT RESULT
// ═══════════════════════════════════════════════════════════════

export interface AlignmentDrivers {
  exchangeDrivers: string[];
  sentimentDrivers: string[];
  conflictDrivers: string[];
}

export interface AlignmentCore {
  type: AlignmentType;
  strength: number;     // 0..1
  trustShift: number;   // -1..+1 (hint for C3, not applied in C1)
  explanation: string[];
  drivers: AlignmentDrivers;
}

export interface AlignmentResult {
  symbol: string;
  t0: string; // ISO timestamp
  
  exchange: ExchangeLayerInput;
  sentiment: SentimentLayerInput;
  
  alignment: AlignmentCore;
  
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// BATCH / DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════

export interface AlignmentBatchItem {
  symbol: string;
  t0: string;
  exchange: ExchangeLayerInput;
  sentiment: SentimentLayerInput;
}

export interface AlignmentDiagnostics {
  counts: Record<AlignmentType, number>;
  rates: {
    confirmationRate: number;
    contradictionRate: number;
  };
  avgStrength: number;
  avgTrustShift: number;
  totalItems: number;
}

console.log('[C1] Alignment Contracts loaded');
