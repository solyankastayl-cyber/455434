/**
 * BLOCK 39.1-39.5 — Institutional Multi-Horizon Contracts
 * 
 * Final institutional layer for Fractal:
 * - 39.1: Horizon Budget + Anti-Dominance
 * - 39.2: Smooth Consensus-to-Exposure Mapping
 * - 39.3: Tail-Aware Weight Objective
 * - 39.4: Institutional Score (Module Self-Rating)
 * - 39.5: Phase-Sensitive Risk Multiplier
 */

// ═══════════════════════════════════════════════════════════════
// BLOCK 39.1 — Horizon Budget Control
// ═══════════════════════════════════════════════════════════════

export type HorizonKey = 7 | 14 | 30 | 60;

export interface HorizonBudgetConfig {
  /** Max contribution cap per horizon */
  caps: Record<HorizonKey, number>;     // e.g., {7:0.18, 14:0.22, 30:0.28, 60:0.32}
  /** Max allowed dominance from single horizon */
  maxDominance: number;                 // e.g., 0.45 (45%)
  /** Redistribute excess proportionally */
  redistributeExcess: boolean;
}

export interface HorizonBudgetResult {
  original: Record<HorizonKey, number>;     // raw contributions
  capped: Record<HorizonKey, number>;       // after cap
  redistributed: Record<HorizonKey, number>; // after redistribution
  dominantHorizon: HorizonKey | null;
  dominancePct: number;
  wasCapped: boolean;
}

export const DEFAULT_HORIZON_BUDGET_CONFIG: HorizonBudgetConfig = {
  caps: { 7: 0.18, 14: 0.22, 30: 0.28, 60: 0.32 },
  maxDominance: 0.45,
  redistributeExcess: true,
};

// ═══════════════════════════════════════════════════════════════
// BLOCK 39.2 — Smooth Exposure Mapping
// ═══════════════════════════════════════════════════════════════

export interface ExposureMapConfig {
  /** Score where exposure starts rising from 0 */
  enter: number;      // e.g., 0.08
  /** Score where exposure reaches ~1.0 */
  full: number;       // e.g., 0.28
  /** Curvature: >1 steeper, <1 flatter */
  gamma: number;      // e.g., 1.4
  /** Minimal exposure once activated */
  minOn: number;      // e.g., 0.15
  /** Small bleed exposure below enter threshold */
  bleed: number;      // e.g., 0.00-0.05
}

export interface ExposureResult {
  absScore: number;
  baseExposure: number;
  entropyScale: number;
  reliabilityModifier: number;
  phaseMultiplier: number;
  finalExposure: number;
  sizeMultiplier: number;
}

export const DEFAULT_EXPOSURE_MAP_CONFIG: ExposureMapConfig = {
  enter: 0.08,
  full: 0.28,
  gamma: 1.4,
  minOn: 0.15,
  bleed: 0.00,
};

// ═══════════════════════════════════════════════════════════════
// BLOCK 39.3 — Tail-Aware Weight Objective
// ═══════════════════════════════════════════════════════════════

export interface TailAwareObjectiveConfig {
  weights: {
    sharpe: number;           // +1.0
    cagr: number;             // +0.2
    p95dd: number;            // -1.0 (penalty)
    worstdd: number;          // -0.4 (penalty)
    dominance: number;        // -0.2 (penalty)
    stability: number;        // +0.15
    tradeCount: number;       // -0.3 (penalty if low)
  };
  minTrades: number;          // 25
  targetTrades: number;       // 40
}

export interface TailAwareObjectiveResult {
  score: number;
  components: {
    sharpeContrib: number;
    cagrContrib: number;
    p95ddPenalty: number;
    worstddPenalty: number;
    dominancePenalty: number;
    stabilityBonus: number;
    tradeCountPenalty: number;
  };
  meetsMinTrades: boolean;
}

export const DEFAULT_TAIL_OBJECTIVE_CONFIG: TailAwareObjectiveConfig = {
  weights: {
    sharpe: 1.0,
    cagr: 0.2,
    p95dd: -1.0,
    worstdd: -0.4,
    dominance: -0.2,
    stability: 0.15,
    tradeCount: -0.3,
  },
  minTrades: 25,
  targetTrades: 40,
};

// ═══════════════════════════════════════════════════════════════
// BLOCK 39.4 — Institutional Score (Module Self-Rating)
// ═══════════════════════════════════════════════════════════════

export interface InstitutionalScoreConfig {
  weights: {
    reliability: number;        // 0.30
    stability: number;          // 0.25
    rollingPassRate: number;    // 0.20
    calibrationQuality: number; // 0.15
    tailRiskHealth: number;     // 0.10
  };
}

export type RiskProfile = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE' | 'DEGRADED';

export interface InstitutionalScoreResult {
  score: number;                // 0..1
  riskProfile: RiskProfile;
  components: {
    reliability: number;
    stability: number;
    rollingPassRate: number;
    calibrationQuality: number;
    tailRiskHealth: number;
  };
  recommendation: string;
}

export const DEFAULT_INSTITUTIONAL_SCORE_CONFIG: InstitutionalScoreConfig = {
  weights: {
    reliability: 0.30,
    stability: 0.25,
    rollingPassRate: 0.20,
    calibrationQuality: 0.15,
    tailRiskHealth: 0.10,
  },
};

// ═══════════════════════════════════════════════════════════════
// BLOCK 39.5 — Phase-Sensitive Risk Multiplier
// ═══════════════════════════════════════════════════════════════

export type MarketPhase = 
  | 'ACCUMULATION' 
  | 'MARKUP' 
  | 'DISTRIBUTION' 
  | 'MARKDOWN' 
  | 'CAPITULATION' 
  | 'RECOVERY' 
  | 'UNKNOWN';

export interface PhaseRiskConfig {
  multipliers: Record<MarketPhase, number>;
  /** Reduce multiplier further if reliability is low */
  reliabilityFloor: number;   // e.g., 0.5
}

export const DEFAULT_PHASE_RISK_CONFIG: PhaseRiskConfig = {
  multipliers: {
    ACCUMULATION: 1.0,
    MARKUP: 1.1,
    DISTRIBUTION: 0.7,
    MARKDOWN: 0.6,
    CAPITULATION: 0.5,
    RECOVERY: 0.9,
    UNKNOWN: 0.8,
  },
  reliabilityFloor: 0.5,
};

// ═══════════════════════════════════════════════════════════════
// Combined Institutional Config
// ═══════════════════════════════════════════════════════════════

export interface InstitutionalConfig {
  horizonBudget: HorizonBudgetConfig;
  exposureMap: ExposureMapConfig;
  tailObjective: TailAwareObjectiveConfig;
  institutionalScore: InstitutionalScoreConfig;
  phaseRisk: PhaseRiskConfig;
}

export const DEFAULT_INSTITUTIONAL_CONFIG: InstitutionalConfig = {
  horizonBudget: DEFAULT_HORIZON_BUDGET_CONFIG,
  exposureMap: DEFAULT_EXPOSURE_MAP_CONFIG,
  tailObjective: DEFAULT_TAIL_OBJECTIVE_CONFIG,
  institutionalScore: DEFAULT_INSTITUTIONAL_SCORE_CONFIG,
  phaseRisk: DEFAULT_PHASE_RISK_CONFIG,
};
