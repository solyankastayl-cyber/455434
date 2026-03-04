/**
 * B4 — Exchange Verdict Types
 * 
 * Types for Exchange Verdict Engine.
 * Final BULLISH/BEARISH/NEUTRAL verdict.
 */

export type Verdict = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type Strength = 'WEAK' | 'MEDIUM' | 'STRONG';

export interface VerdictReasons {
  bullish: string[];
  bearish: string[];
  blockers: string[];
}

export interface VerdictEvidence {
  regime: { type: string; confidence: number } | null;
  stress: number;
  whales: { netBias: string; riskBucket: string; lift?: number };
  patterns: string[];
}

export interface VerdictGuards {
  blockedByWhaleRisk: boolean;
  blockedByCascadeRisk: boolean;
  blockedByConflict: boolean;
  blockedByReadiness: boolean;
}

export interface AxisContrib {
  momentum: number;
  structure: number;
  participation: number;
  orderbookPressure: number;
  positioning: number;
  marketStress: number;
}

export interface ExchangeVerdict {
  symbol: string;
  exchange: string;
  
  verdict: Verdict;
  confidence: number;
  strength: Strength;
  
  reasons: VerdictReasons;
  evidence: VerdictEvidence;
  guards: VerdictGuards;
  
  axisContrib: AxisContrib;
  
  readiness: {
    status: string;
    score: number;
    reasons: string[];
  };
  
  contextRefs: { updatedAt: string };
  updatedAt: string;
}

export interface ExchangeVerdictDebug extends ExchangeVerdict {
  debug: {
    bullScore: number;
    bearScore: number;
    delta: number;
    penalties: string[];
    boosts: string[];
    thresholds: { bullishDelta: number; bearishDelta: number };
  };
}

console.log('[B4] Verdict Types loaded');
