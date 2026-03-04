/**
 * BLOCK 17 — Shadow Portfolio & Paper Trading Types
 * ===================================================
 * 
 * Real-time validation without risking money.
 * Everything logged, nothing faked.
 */

import type { Venue, Timeframe, Direction } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// SHADOW TRADE
// ═══════════════════════════════════════════════════════════════

export interface ShadowTrade {
  _id?: string;
  id: string;
  
  timestamp: number;
  date: string;
  
  asset: string;
  venue: Venue;
  side: 'BUY' | 'SELL' | 'AVOID';
  
  entryPrice: number;
  horizon: '1h' | '4h' | '24h';
  
  confidence: number;
  clusterId: string;
  patternLabel: string;
  featuresHash: string;
  
  // Context at decision time
  marketRegime: string;
  reasons: string[];
  
  // Status
  status: 'OPEN' | 'CLOSED' | 'EXPIRED';
  
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// SHADOW OUTCOME
// ═══════════════════════════════════════════════════════════════

export interface ShadowOutcome {
  _id?: string;
  
  tradeId: string;
  asset: string;
  
  exitPrice: number;
  pnlPct: number;
  
  label: 'TP' | 'FP' | 'FN' | 'WEAK';
  
  horizon: '1h' | '4h' | '24h';
  
  createdAt: number;
}

export const SHADOW_THRESHOLDS = {
  TP: 3,      // > 3% in right direction = True Positive
  WEAK: 1,    // < 1% movement = Weak signal
  // else FP (wrong direction) or FN (missed)
} as const;

export function labelShadowOutcome(
  side: 'BUY' | 'SELL' | 'AVOID',
  pnlPct: number
): ShadowOutcome['label'] {
  if (side === 'AVOID') {
    // Check if we missed a move
    if (Math.abs(pnlPct) > SHADOW_THRESHOLDS.TP) return 'FN';
    return 'WEAK';
  }
  
  const directionCorrect = (side === 'BUY' && pnlPct > 0) || (side === 'SELL' && pnlPct < 0);
  const magnitude = Math.abs(pnlPct);
  
  if (directionCorrect && magnitude >= SHADOW_THRESHOLDS.TP) return 'TP';
  if (!directionCorrect && magnitude >= SHADOW_THRESHOLDS.TP) return 'FP';
  return 'WEAK';
}

// ═══════════════════════════════════════════════════════════════
// SHADOW PORTFOLIO METRICS
// ═══════════════════════════════════════════════════════════════

export interface ShadowMetrics {
  period: string;  // '7d' | '30d' | 'all'
  
  // Counts
  totalTrades: number;
  tpCount: number;
  fpCount: number;
  fnCount: number;
  weakCount: number;
  avoidCount: number;
  
  // Rates
  winRate: number;
  precision: number;      // TP / (TP + FP)
  coverage: number;       // % days with signals
  stability: number;      // week-to-week consistency
  
  // Returns
  avgPnl: number;
  totalPnl: number;
  maxDrawdown: number;
  
  // Quality
  hitRateTopK: number;
  fnRate: number;         // missed opportunities
  avoidAccuracy: number;  // % of AVOIDs that were actually flat
  
  // Baseline comparison
  vsBaseline: {
    randomTopVolume: number;
    rsiOversold: number;
    yesterdayGainers: number;
    excessReturn: number;
  };
  
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// DECISION GATE
// ═══════════════════════════════════════════════════════════════

export interface DecisionGate {
  exchangeRiskAllow: boolean;
  confidenceAboveThreshold: boolean;
  assetInTopK: boolean;
  invariantsOk: boolean;
  
  passed: boolean;
  rejectReasons: string[];
}

export const DECISION_GATE_CONFIG = {
  minConfidence: 0.55,
  topK: 10,
  maxVolatilityZ: 3,
  requireRegimeCompatible: true,
} as const;

export function checkDecisionGate(
  confidence: number,
  rank: number,
  marketRegime: string,
  volatilityZ: number
): DecisionGate {
  const reasons: string[] = [];
  
  const exchangeRiskAllow = marketRegime !== 'RISK_OFF';
  if (!exchangeRiskAllow) reasons.push('Market in RISK_OFF');
  
  const confidenceAboveThreshold = confidence >= DECISION_GATE_CONFIG.minConfidence;
  if (!confidenceAboveThreshold) reasons.push(`Confidence ${(confidence * 100).toFixed(0)}% < ${DECISION_GATE_CONFIG.minConfidence * 100}%`);
  
  const assetInTopK = rank <= DECISION_GATE_CONFIG.topK;
  if (!assetInTopK) reasons.push(`Rank ${rank} > top ${DECISION_GATE_CONFIG.topK}`);
  
  const invariantsOk = volatilityZ < DECISION_GATE_CONFIG.maxVolatilityZ;
  if (!invariantsOk) reasons.push('Volatility extreme');
  
  return {
    exchangeRiskAllow,
    confidenceAboveThreshold,
    assetInTopK,
    invariantsOk,
    passed: exchangeRiskAllow && confidenceAboveThreshold && assetInTopK && invariantsOk,
    rejectReasons: reasons,
  };
}

console.log('[Block17] Shadow Portfolio Types loaded');
