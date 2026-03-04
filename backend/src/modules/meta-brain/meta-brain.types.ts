/**
 * S10.8 — Exchange Context for Meta-Brain
 * 
 * ExchangeContext = what Exchange Intelligence passes to Meta-Brain
 * 
 * READ-ONLY integration:
 * - Can ONLY downgrade confidence
 * - Can ONLY block STRONG → WEAK
 * - CANNOT upgrade or initiate signals
 * 
 * Exchange = thermometer and barometer, NOT engine.
 */

import { RegimeType } from '../exchange/observation/observation.types.js';
import { MLLabel } from '../exchange-ml/ml.types.js';
import { PatternCategory, PatternDirection } from '../exchange/patterns/pattern.types.js';

// ═══════════════════════════════════════════════════════════════
// S10.W — WHALE RISK CONTEXT (Step 7)
// ═══════════════════════════════════════════════════════════════

export type WhalePatternType = 'WHALE_TRAP_RISK' | 'FORCED_SQUEEZE_RISK' | 'BAIT_AND_FLIP';

export interface WhaleRiskContext {
  /** Active whale pattern (highest risk) */
  activePattern: WhalePatternType | null;
  
  /** Risk bucket */
  riskBucket: 'LOW' | 'MID' | 'HIGH';
  
  /** Risk score 0..1 */
  riskScore: number;
  
  /** Lift vs baseline (from LABS-05) */
  lift: number;
  
  /** Analysis horizon */
  horizon: '5m' | '15m' | '1h' | '4h';
  
  /** Source confidence */
  confidence: number;
  
  /** Data freshness (ms since last update) */
  dataAgeSec: number;
}

// ═══════════════════════════════════════════════════════════════
// EXCHANGE CONTEXT (LOCKED CONTRACT)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeContext {
  // Market regime
  regime: RegimeType;
  regimeConfidence: number;           // 0..1
  
  // Aggregated stress
  marketStress: number;               // 0..1 (liquidations, volatility)
  
  // Flow bias
  flowBias: 'BUY' | 'SELL' | 'NEUTRAL';
  flowDominance: number;              // 0..1
  
  // Liquidity state
  liquidityState: 'THIN' | 'NORMAL' | 'HEAVY';
  
  // Active patterns (read-only summary)
  patternSummary: {
    count: number;
    bullish: number;
    bearish: number;
    neutral: number;
    hasConflict: boolean;
    topPatterns: string[];
  };
  
  // ML verdict from Exchange ML
  mlVerdict: MLLabel;                 // USE | IGNORE | WARNING
  mlConfidence: number;               // 0..1
  
  // S10.W Step 7: Whale Risk Context
  whaleRisk?: WhaleRiskContext;
  
  // Timestamp
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// META-BRAIN VERDICT (what Meta-Brain outputs)
// ═══════════════════════════════════════════════════════════════

export type VerdictStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

export interface MetaBrainVerdict {
  // Direction (from Sentiment + On-chain)
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  
  // Confidence before Exchange impact
  originalConfidence: number;
  originalStrength: VerdictStrength;
  
  // Confidence after Exchange impact
  finalConfidence: number;
  finalStrength: VerdictStrength;
  
  // Was verdict downgraded?
  downgraded: boolean;
  downgradeReason: string | null;
  
  // Exchange impact details
  exchangeImpact: {
    applied: boolean;
    regimeDowngrade: boolean;
    stressGuard: boolean;
    conflictGuard: boolean;
    mlWarningGate: boolean;
    whaleRiskGuard: boolean;  // S10.W Step 7
  };
  
  // Macro Context impact (Market State Anchor)
  macroContext?: {
    flags: string[];
    confidenceMultiplier: number;
    blockedStrong: boolean;
    reason: string;
  };
  
  // ML Calibration (ACTIVE_SAFE mode)
  mlCalibration?: {
    applied: boolean;
    modelId?: string;
    mlModifier: number;
    macroModifier: number;
    capApplied?: number;
    reasonCodes: string[];
    mode: 'OFF' | 'SHADOW' | 'ACTIVE_SAFE';
  };
  
  // Invariant Check (P0.2 - Meta-Brain Hardening)
  invariantCheck?: {
    passed: boolean;
    violations: string[];
    blocked: boolean;
    blockReason?: string;
  };
  
  // P0.3 — Asset Truth Layer
  assetTruth?: {
    venueAgreementScore: number;
    venueDispersion: number;
    dominantVenue: string;
    activeVenueCount: number;
    confidenceModifier: number;
    applied: boolean;
  };
  
  // P1.3 — Labs Attribution
  attribution?: {
    supporting: Array<{ labId: string; direction: string; confidence: number; context: string[] }>;
    opposing: Array<{ labId: string; direction: string; confidence: number; context: string[] }>;
    neutral: Array<{ labId: string; direction: string; confidence: number; context: string[] }>;
    ignored: Array<{ labId: string; reason: string }>;
    summary: {
      totalLabs: number;
      supportingCount: number;
      opposingCount: number;
      neutralCount: number;
      confidenceAdjustment: number;
    };
  };
  
  // P1.4 — Explainability
  explain?: {
    decision: { title: string; summary: string; bullets: string[] };
    macroContext: { title: string; summary: string; bullets: string[] };
    risks: { title: string; summary: string; bullets: string[] };
    confidence: { title: string; summary: string; bullets: string[] };
  };
  
  // Sources
  sources: {
    sentiment: { confidence: number; direction: string } | null;
    onchain: { confidence: number; validation: string } | null;
    exchange: ExchangeContext;
  };
  
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// IMPACT RULES (what Exchange can do to Meta-Brain)
// ═══════════════════════════════════════════════════════════════

export interface ImpactRules {
  // Regimes that trigger downgrade
  downgradingRegimes: RegimeType[];
  
  // Thresholds
  marketStressThreshold: number;      // Above this → maxVerdict = WEAK
  conflictPatternThreshold: number;   // >= this → downgrade confidence
  regimeConfidenceThreshold: number;  // Regime must be confident to trigger
  
  // ML WARNING gate
  mlWarningBlocksStrong: boolean;     // If true, WARNING → no STRONG verdict
  
  // S10.W Step 7: Whale Risk Guard
  whaleRiskEnabled: boolean;          // Enable whale risk downgrade
  whaleRiskLiftThreshold: number;     // Minimum lift to trigger (e.g., 1.2)
  whaleRiskConfidenceMultiplier: number; // Confidence multiplier when triggered (e.g., 0.6)
}

export const DEFAULT_IMPACT_RULES: ImpactRules = {
  downgradingRegimes: [
    'EXHAUSTION',
    'LONG_SQUEEZE',
    'SHORT_SQUEEZE',
    'DISTRIBUTION',
  ],
  marketStressThreshold: 0.7,
  conflictPatternThreshold: 2,
  regimeConfidenceThreshold: 0.6,
  mlWarningBlocksStrong: true,
  
  // S10.W Step 7: Whale Risk Guard defaults
  whaleRiskEnabled: true,
  whaleRiskLiftThreshold: 1.2,
  whaleRiskConfidenceMultiplier: 0.6,
};

// ═══════════════════════════════════════════════════════════════
// DOWNGRADE LOG (for admin visibility)
// ═══════════════════════════════════════════════════════════════

export interface DowngradeLogEntry {
  timestamp: number;
  
  // Before
  originalStrength: VerdictStrength;
  originalConfidence: number;
  
  // After
  finalStrength: VerdictStrength;
  finalConfidence: number;
  
  // Why
  reason: string;
  trigger: 'REGIME' | 'STRESS' | 'CONFLICT' | 'ML_WARNING' | 'WHALE_RISK';
  
  // Context
  exchangeContext: {
    regime: string;
    regimeConfidence: number;
    marketStress: number;
    mlVerdict: string;
    conflictCount: number;
    whaleRisk?: {
      pattern: string | null;
      bucket: string;
      lift: number;
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// ADMIN METRICS
// ═══════════════════════════════════════════════════════════════

export interface ExchangeImpactMetrics {
  totalDecisions: number;
  downgraded: number;
  downgradedRate: number;             // 0..1
  
  // Breakdown by trigger
  byTrigger: {
    regime: number;
    stress: number;
    conflict: number;
    mlWarning: number;
    whaleRisk: number;  // S10.W Step 7
  };
  
  // Average confidence reduction
  avgConfidenceReduction: number;
  
  // STRONG blocked rate
  strongBlockedRate: number;
  
  // Time range
  since: number;
}
