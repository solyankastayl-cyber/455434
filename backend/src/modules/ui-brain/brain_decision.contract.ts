/**
 * BRAIN v4 — DECISION ENGINE CONTRACT
 * 
 * Brain is not a dashboard. It's a decision engine.
 * It answers: Where are we? What to do? Why? How confident?
 */

// ═══════════════════════════════════════════════════════════════
// VERDICT (Layer 1 - The Answer)
// ═══════════════════════════════════════════════════════════════

export type MarketRegime = 
  | 'BULLISH' 
  | 'BEARISH' 
  | 'NEUTRAL' 
  | 'NEUTRAL_MIXED'
  | 'RISK_OFF'
  | 'CRISIS';

export type MarketBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type MarketPosture = 'OFFENSIVE' | 'DEFENSIVE' | 'NEUTRAL';

export interface MarketVerdict {
  regime: MarketRegime;
  dominantBias: MarketBias;
  posture: MarketPosture;
  confidence: number; // 0-100%
}

export interface ActionRecommendation {
  primary: string;           // "Maintain balanced exposure", "Reduce risk", etc.
  multiplier: number;        // 0.85x / 1.00x / 1.15x
  cashBufferRange: string;   // "15-20%"
  leverageRecommended: boolean;
}

// ═══════════════════════════════════════════════════════════════
// REASONING (Layer 2 - Why)
// ═══════════════════════════════════════════════════════════════

export type ReasonSentiment = 'supportive' | 'neutral' | 'risk';

export interface Reason {
  text: string;
  sentiment: ReasonSentiment;
  indicator?: string;  // Optional link to macro indicator
}

// ═══════════════════════════════════════════════════════════════
// HORIZON PHASES (replaces Synthetic/Replay/Hybrid)
// ═══════════════════════════════════════════════════════════════

export type PhaseStrength = 'weak' | 'medium' | 'strong';

export interface HorizonPhase {
  horizon: 30 | 90 | 180 | 365;
  phase: MarketBias;
  strength: PhaseStrength;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// RISK MAP
// ═══════════════════════════════════════════════════════════════

export type VolatilityRegime = 'low' | 'normal' | 'elevated' | 'extreme';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type GuardStatus = 'none' | 'warn' | 'block' | 'crisis';

export interface RiskMap {
  volatilityRegime: VolatilityRegime;
  tailRisk: RiskLevel;
  guardStatus: GuardStatus;
  overrideIntensity: number;  // %
  capitalScaling: number;     // %
}

// ═══════════════════════════════════════════════════════════════
// CAUSAL FLOW (from AE Brain)
// ═══════════════════════════════════════════════════════════════

export type CausalDirection = 'positive' | 'negative' | 'neutral';

export interface CausalLink {
  from: string;
  to: string;
  direction: CausalDirection;
  strength: number;  // 0-1
}

export interface CausalChain {
  id: string;
  links: CausalLink[];
  targetAsset: 'SPX' | 'BTC' | 'USD';
  netEffect: CausalDirection;
}

// ═══════════════════════════════════════════════════════════════
// MACRO SUMMARY (enriched with interpretation)
// ═══════════════════════════════════════════════════════════════

export interface MacroIndicatorSummary {
  key: string;
  title: string;
  currentValue: string;
  status: ReasonSentiment;
  interpretation: string;
  // Rich tooltip content
  normalRange: string;
  riskRange: string;
  bullishCondition: string;
  bearishCondition: string;
  usdImpact: string;
  spxImpact: string;
  btcImpact: string;
}

// ═══════════════════════════════════════════════════════════════
// ALLOCATION PIPELINE (with impact explanation)
// ═══════════════════════════════════════════════════════════════

export interface AllocationStep {
  spx: number;
  btc: number;
  cash: number;
}

export interface AllocationImpact {
  brainImpact: number;      // %
  optimizerImpact: number;  // %
  scalingImpact: number;    // %
  explanation: string;
}

export interface AllocationPipeline {
  base: AllocationStep;
  afterBrain: AllocationStep;
  final: AllocationStep;
  impact: AllocationImpact;
}

// ═══════════════════════════════════════════════════════════════
// CAPITAL SCALING (with drivers)
// ═══════════════════════════════════════════════════════════════

export interface CapitalScalingDriver {
  name: string;
  value: number;
  effect: 'reduce' | 'neutral' | 'increase';
}

export interface CapitalScalingSummary {
  scaleFactor: number;
  drivers: CapitalScalingDriver[];
  explanation: string;
}

// ═══════════════════════════════════════════════════════════════
// MODEL TRANSPARENCY
// ═══════════════════════════════════════════════════════════════

export interface ModelTransparency {
  systemVersion: string;
  capitalScalingVersion: string;
  dataAsOf: string;
  determinismHash: string;
  frozen: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ADVANCED (hidden by default)
// ═══════════════════════════════════════════════════════════════

export interface ModelDecomposition {
  horizons: Array<{
    horizon: number;
    synthetic: number;
    replay: number;
    hybrid: number;
    macroAdj: number;
    macroDelta: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN PACK — BrainDecisionPack
// ═══════════════════════════════════════════════════════════════

export interface BrainDecisionPack {
  // Layer 1 - The Answer
  verdict: MarketVerdict;
  action: ActionRecommendation;
  
  // Layer 2 - Why
  reasons: Reason[];
  
  // Layer 3 - Market by Timeframe
  horizons: HorizonPhase[];
  
  // Layer 4 - Risk
  risk: RiskMap;
  
  // Layer 5 - Causality
  causal: CausalChain[];
  
  // Layer 6 - Macro Summary
  macroSummary: MacroIndicatorSummary[];
  
  // Layer 7 - Allocation
  allocation: AllocationPipeline;
  
  // Layer 8 - Capital Scaling
  capitalScaling: CapitalScalingSummary;
  
  // Layer 9 - Transparency
  transparency: ModelTransparency;
  
  // Hidden - Advanced decomposition
  advanced: ModelDecomposition;
  
  // Meta
  generatedAt: string;
}
