/**
 * EVIDENCE ENGINE — P4 Explainability Contracts
 * 
 * Every terminal must answer:
 * 1. Why is the signal what it is?
 * 2. What are the key drivers?
 * 3. What would need to change to flip the signal?
 */

// ═══════════════════════════════════════════════════════════════
// CORE CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface EvidenceDriver {
  id: string;
  displayName: string;
  contribution: number;       // -1 to +1
  contributionPct: number;    // % of total signal
  direction: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  explanation: string;
}

export interface EvidenceDelta {
  metric: string;
  current: number;
  change3m: number | null;
  change12m: number | null;
  trend: 'RISING' | 'FALLING' | 'STABLE';
}

export interface EvidenceConflict {
  driver1: string;
  driver2: string;
  description: string;
  resolution: string;
}

export interface EvidenceFlipCondition {
  condition: string;
  likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
  timeframe: string;
}

export interface EvidencePack {
  headline: string;
  regimeSummary: string;
  keyDrivers: EvidenceDriver[];
  deltas: EvidenceDelta[];
  conflicts: EvidenceConflict[];
  whatWouldFlip: EvidenceFlipCondition[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// MACRO-SPECIFIC EVIDENCE
// ═══════════════════════════════════════════════════════════════

export interface MacroEvidencePack extends EvidencePack {
  type: 'MACRO';
  scoreSummary: {
    scoreSigned: number;
    score01: number;
    interpretation: string;
  };
  componentBreakdown: {
    core: { weight: number; contribution: number };
    housing: { weight: number; contribution: number };
    activity: { weight: number; contribution: number };
    credit: { weight: number; contribution: number };
    liquidity: { weight: number; contribution: number };
  };
  regimeAnalysis: {
    dominant: string;
    distribution: Record<string, number>;
    consistency: 'ALIGNED' | 'MIXED' | 'CONFLICTING';
  };
}

// ═══════════════════════════════════════════════════════════════
// AE BRAIN EVIDENCE
// ═══════════════════════════════════════════════════════════════

export interface AeEvidencePack extends EvidencePack {
  type: 'AE_BRAIN';
  stateSummary: {
    regime: string;
    novelty: number;
    nearestCluster: string;
  };
  transitionAnalysis: {
    selfTransition: number;
    mostLikelyNext: string;
    probability: number;
  };
  scenarioWeights: {
    bull: number;
    base: number;
    bear: number;
    dominant: string;
    reasoning: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// CASCADE EVIDENCE
// ═══════════════════════════════════════════════════════════════

export interface CascadeEvidencePack extends EvidencePack {
  type: 'CASCADE';
  asset: 'SPX' | 'BTC' | 'DXY';
  multiplierBreakdown: {
    mStress: { value: number; explanation: string };
    mPersistence: { value: number; explanation: string };
    mNovelty: { value: number; explanation: string };
    mScenario: { value: number; explanation: string };
    mLiquidity: { value: number; explanation: string };
    mSPX?: { value: number; explanation: string };  // BTC only
    final: number;
  };
  guardAnalysis: {
    level: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
    cap: number;
    trigger: string;
  };
  sizeRecommendation: {
    size: number;
    rationale: string;
  };
}
