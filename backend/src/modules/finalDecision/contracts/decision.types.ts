/**
 * PHASE 4 — Final Decision Types
 * ================================
 * Buy / Sell / Avoid policy contracts
 */

// ═══════════════════════════════════════════════════════════════
// DECISION TYPES
// ═══════════════════════════════════════════════════════════════

export type Action = 'BUY' | 'SELL' | 'AVOID';

export type AvoidReason =
  | 'NON_LIVE_DATA'
  | 'ML_NOT_READY'
  | 'WHALE_RISK'
  | 'MARKET_STRESS'
  | 'CONTRADICTION'
  | 'LOW_CONFIDENCE'
  | 'NEUTRAL_VERDICT'
  | 'DEGRADED_DATA'
  | 'SYSTEM_ERROR';

export type BuyReason = 'STRONG_BULLISH_CONTEXT';
export type SellReason = 'STRONG_BEARISH_CONTEXT';

// ═══════════════════════════════════════════════════════════════
// POLICY THRESHOLDS (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

export const DECISION_THRESHOLDS = {
  BUY: 0.65,
  SELL: 0.65,
  AVOID: 0.45,
} as const;

// ═══════════════════════════════════════════════════════════════
// INPUT CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface RiskFlags {
  whaleRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  marketStress: 'NORMAL' | 'ELEVATED' | 'EXTREME';
  contradiction: boolean;
  liquidationRisk: boolean;
}

export interface DecisionContext {
  symbol: string;
  timestamp: number;
  
  // From Meta-Brain
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rawConfidence: number;
  mlAdjustedConfidence: number;
  strength: 'WEAK' | 'STRONG';
  
  // Data quality
  dataMode: 'LIVE' | 'MIXED' | 'MOCK';
  completeness: number;
  
  // ML status
  mlReady: boolean;
  mlDrift: boolean;
  
  // Risk assessment
  risk: RiskFlags;
  
  // Drivers & blockers
  drivers: string[];
  risks: string[];
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT DECISION
// ═══════════════════════════════════════════════════════════════

export interface FinalDecision {
  symbol: string;
  timestamp: number;
  
  // The action
  action: Action;
  confidence: number;
  reason: string;
  
  // Explainability (CRITICAL for Phase 5)
  explainability: {
    verdict: string;
    rawConfidence: number;
    mlAdjustedConfidence: number;
    dataMode: string;
    mlReady: boolean;
    appliedRules: string[];
    blockedBy?: string;
    riskFlags: RiskFlags;
  };
  
  // Policy version
  policyVersion: string;
}

// ═══════════════════════════════════════════════════════════════
// DECISION RECORD (for storage/learning)
// ═══════════════════════════════════════════════════════════════

export interface DecisionRecord extends FinalDecision {
  _id?: string;
  createdAt: Date;
  
  // Future: outcome tracking
  outcome?: {
    priceAtDecision: number;
    priceAfter1h?: number;
    priceAfter4h?: number;
    priceAfter24h?: number;
    wasCorrect?: boolean;
    actualChangePct?: number;
  };
}

console.log('[Phase 4] Decision Types loaded');
