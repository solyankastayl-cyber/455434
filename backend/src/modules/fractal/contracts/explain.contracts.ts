/**
 * BLOCK 40.1-40.4 — Explainability Contracts
 * 
 * Makes Fractal a white-box module:
 * - 40.1: Structured Explainability Payload
 * - 40.2: TopMatches + Why This Match
 * - 40.3: Counterfactual Scenarios
 * - 40.4: Influence Attribution
 */

// ═══════════════════════════════════════════════════════════════
// Base Types
// ═══════════════════════════════════════════════════════════════

export type FractalSide = 'LONG' | 'SHORT' | 'NEUTRAL';
export type FractalAction = 'ENTER' | 'HOLD' | 'EXIT' | 'SKIP';
export type InstitutionalScoreLabel = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE' | 'DEGRADED';
export type StatusBadge = 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL';

// ═══════════════════════════════════════════════════════════════
// 40.1 — Horizon Node
// ═══════════════════════════════════════════════════════════════

export interface ExplainHorizonNode {
  horizonDays: number;        // 7/14/30/60
  rawScore: number;           // before budget/entropy
  weight: number;             // after budget cap
  contribution: number;       // rawScore × weight
  side: FractalSide;
  confidence: number;
  reliability: number;
}

// ═══════════════════════════════════════════════════════════════
// 40.1 — Assembly Layer
// ═══════════════════════════════════════════════════════════════

export interface ExplainAssembly {
  dominantHorizonDays: number | null;
  entropy: number;            // 0..1
  sizeMultiplier: number;     // 0..1
  enterThreshold: number;
  fullThreshold: number;
  budgetWasCapped: boolean;
  horizons: ExplainHorizonNode[];
  notes: string[];
}

// ═══════════════════════════════════════════════════════════════
// 40.1 — Pattern Layer
// ═══════════════════════════════════════════════════════════════

export interface ExplainPatternLayer {
  effectiveN: number;
  stabilityPSS: number;       // 0..1
  phase: string;              // ACCUMULATION/MARKUP/...
  phaseMultiplier: number;
  dynamicFloorUsed: boolean;
  temporalDispersionUsed: boolean;
  matchCountBeforeFilters: number;
  matchCountAfterFilters: number;
}

// ═══════════════════════════════════════════════════════════════
// 40.1 — Reliability Layer
// ═══════════════════════════════════════════════════════════════

export interface ExplainReliability {
  score: number;              // 0..1
  badge: StatusBadge;
  components: {
    drift: number;
    calibration: number;
    rolling: number;
    mcTail: number;
  };
  modifier: number;           // 1.0/0.85/0.60/0.30
  calibrationStatus: StatusBadge;
  driftStatus: StatusBadge;
}

// ═══════════════════════════════════════════════════════════════
// 40.1 — Confidence Decomposition
// ═══════════════════════════════════════════════════════════════

export interface ExplainConfidenceDecomp {
  rawConfidence: number;      // before caps/modifiers
  evidenceScore: number;      // 0..1
  effectiveNCap: number;      // 0..1
  reliabilityModifier: number;// 0..1
  finalConfidence: number;    // итог
}

// ═══════════════════════════════════════════════════════════════
// 40.1 — Risk Layer
// ═══════════════════════════════════════════════════════════════

export interface ExplainRiskLayer {
  tailRiskScore: number;      // 0..1
  mcP95MaxDD?: number;
  mcP10Sharpe?: number;
  notes: string[];
}

// ═══════════════════════════════════════════════════════════════
// 40.2 — Match Breakdown
// ═══════════════════════════════════════════════════════════════

export interface ExplainMatchRepBreakdown {
  retSim: number;   // similarity by raw_returns
  volSim: number;   // similarity by vol-shape
  ddSim: number;    // similarity by dd-shape
  blendedSim: number;
}

export interface ExplainMatchDirection {
  mu: number;          // expected move after match
  baseline: number;    // relative mode baseline
  excess: number;      // mu - baseline
}

export interface ExplainMatchQuality {
  ageWeight: number;
  stabilityWeight: number;
  reliabilityWeight: number;
  dispersionPenalty: number;
}

export interface ExplainMatchWhy {
  reasons: string[];
  direction: ExplainMatchDirection;
  quality: ExplainMatchQuality;
}

export interface ExplainMatch {
  rank: number;
  matchId: string;
  startTs: number;
  endTs: number;
  ageDays: number;
  similarity: ExplainMatchRepBreakdown;
  phase: string;
  regime?: string;
  futureHorizonDays: number;
  why: ExplainMatchWhy;
}

export interface ExplainHorizonMatches {
  horizonDays: number;
  side: FractalSide;
  confidence: number;
  weight: number;
  entropyLocal?: number;
  topMatches: ExplainMatch[];
}

export interface ExplainMatches {
  perHorizon: ExplainHorizonMatches[];
  mergedTop: ExplainMatch[];
}

// ═══════════════════════════════════════════════════════════════
// 40.3 — Counterfactual Scenarios
// ═══════════════════════════════════════════════════════════════

export interface CounterfactualToggles {
  disableAgeDecay?: boolean;
  disablePhaseDiversity?: boolean;
  disableEntropyGuard?: boolean;
  disableHorizonBudget?: boolean;
  disableReliabilityModifier?: boolean;
}

export interface CounterfactualScenario {
  name: string;
  toggles: CounterfactualToggles;
  signal: {
    side: FractalSide;
    confidence: number;
    exposure: number;
  };
  deltaVsBase: {
    confidenceDelta: number;
    exposureDelta: number;
    sideChanged: boolean;
  };
}

export interface CounterfactualExplain {
  base: {
    side: FractalSide;
    confidence: number;
    exposure: number;
  };
  scenarios: CounterfactualScenario[];
  fragileLayer?: string;  // which layer flip causes side change
}

// ═══════════════════════════════════════════════════════════════
// 40.4 — Influence Attribution
// ═══════════════════════════════════════════════════════════════

export interface HorizonInfluence {
  horizonDays: number;
  confidenceContribution: number;  // % of final confidence
  exposureContribution: number;    // % of final exposure
  signalAlignment: number;         // -1 to 1 (agreement with final)
  marginality: number;             // how close to flip
}

export interface LayerInfluence {
  layer: string;
  impact: number;                  // -1 to 1
  essential: boolean;              // removing it flips signal
  description: string;
}

export interface InfluenceAttribution {
  horizons: HorizonInfluence[];
  layers: LayerInfluence[];
  dominantFactor: string;
  stabilityScore: number;          // 0..1 (how stable across scenarios)
}

// ═══════════════════════════════════════════════════════════════
// 40.4 — No Trade Reasons
// ═══════════════════════════════════════════════════════════════

export type NoTradeReason = 
  | 'LOW_EFFECTIVE_N'
  | 'HIGH_ENTROPY'
  | 'CALIBRATION_DEGRADED'
  | 'DRIFT_DETECTED'
  | 'RELIABILITY_CRITICAL'
  | 'FREEZE_ACTIVE'
  | 'PHASE_CAPITULATION'
  | 'LOW_CONFIDENCE'
  | 'CONSENSUS_SPLIT';

export interface NoTradeExplain {
  active: boolean;
  reasons: NoTradeReason[];
  details: Record<NoTradeReason, string>;
  threshold: {
    minEffectiveN: number;
    maxEntropy: number;
    minConfidence: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// 40.5 — Institutional Badge Breakdown
// ═══════════════════════════════════════════════════════════════

export interface InstitutionalBadgeComponents {
  robustness: number;      // From reliability + effectiveN
  tailRisk: number;        // From MC/risk metrics
  stability: number;       // From PSS + entropy
  calibration: number;     // From calibration quality
  consensus: number;       // From horizon agreement
}

export interface InstitutionalBadgeBreakdown {
  score: number;
  label: InstitutionalScoreLabel;
  components: InstitutionalBadgeComponents;
  maxExposureAllowed: number;
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════
// Main Payload
// ═══════════════════════════════════════════════════════════════

export interface FractalExplainV21 {
  asOfTs: number;
  symbol: string;
  
  // Signal
  signal: FractalSide;
  action: FractalAction;
  confidence: number;
  reliability: number;
  institutionalScore: InstitutionalScoreLabel;
  
  // Layers
  assembly: ExplainAssembly;
  patternLayer: ExplainPatternLayer;
  reliabilityLayer: ExplainReliability;
  confidenceDecomposition: ExplainConfidenceDecomp;
  riskLayer: ExplainRiskLayer;
  
  // 40.2: Matches
  matches?: ExplainMatches;
  
  // 40.3: Counterfactual
  counterfactual?: CounterfactualExplain;
  
  // 40.4: Attribution
  influence?: InfluenceAttribution;
  
  // 40.4: No Trade
  noTrade?: NoTradeExplain;
  
  // 40.5: Institutional Breakdown
  institutionalBreakdown?: InstitutionalBadgeBreakdown;
  
  // Debug
  debug?: Record<string, unknown>;
}

