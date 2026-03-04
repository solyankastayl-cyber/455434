/**
 * Gate Check Types & Interfaces
 * 
 * EPIC 9 / Gate Check: ML Activation Barrier
 * These types define the contract for gate check validation
 * 
 * DUAL-HORIZON VALIDATION: 24h + 7d
 */

export type GateStatus = 'PASSED' | 'BLOCKED' | 'SHADOW_ONLY';

export type GateSection = 
  | 'DATA_READY' 
  | 'LABELS_READY' 
  | 'NEGATIVE_READY' 
  | 'TEMPORAL_READY' 
  | 'SAFETY_READY';

export interface SectionResult {
  section: GateSection;
  passed: boolean;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
}

export interface HorizonGateResult {
  horizon: '24h' | '7d';
  passed: boolean;
  precision?: number;
  falsePositiveRate?: number;
  negativeRatio?: number;
  sampleCount?: number;
  reasons: string[];
}

export interface GateCheckResultDTO {
  runId: string;
  horizon: '7d' | '30d';
  gate_status: GateStatus;
  trainingAllowed: boolean;
  
  // Dual-horizon results
  gate24h: HorizonGateResult;
  gate7d: HorizonGateResult;
  
  failed_sections: GateSection[];
  passed_sections: GateSection[];
  
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
  
  sections: SectionResult[];
  
  createdAt: string;
  version: string;
}

export interface GateCheckOptions {
  horizon: '7d' | '30d';
  dryRun?: boolean;
  forceRecalc?: boolean;
}

// ============================================
// DUAL-HORIZON THRESHOLDS (24h + 7d)
// ============================================

// 24h Gate: Fast reaction, noise protection
export const GATE_THRESHOLDS_24H = {
  precision: 0.58,
  falsePositiveRate: 0.35,
  calibrationBrier: 0.22,
  negativeRatio: 0.65,
  minSamples: 1500,
};

// 7d Gate: Stability, follow-through
export const GATE_THRESHOLDS_7D = {
  precision: 0.62,
  stabilityStdDev: 0.18,
  drift: 0.15,
  negativeRatio: 0.70,
  minSamples: 5000,
};

// ============================================
// SECTION THRESHOLDS
// ============================================

export const GATE_THRESHOLDS = {
  DATA_READY: {
    minTokens: 50,
    minChains: 1,
    minTimeSpanDays: 180,
    minSignals: 10_000,
    minAvgCoverage: 0.40,
    maxMissingRate: 0.10,
  },
  
  LABELS_READY: {
    minLabels: 10_000,
    requiredWindows: ['24h', '7d'],  // Updated for dual-horizon
    minClasses: 5,
    maxFutureLeaks: 0,
    maxDominantClassShare: 0.50,
    requireFakeout: true,
  },
  
  NEGATIVE_READY: {
    minNegPosRatio: 3.0,
    minNegativeTypes: 3,
    minNoiseShare: 0.20,
    minExhaustionShare: 0.10,
    minStructuralShare: 0.15,
  },
  
  TEMPORAL_READY: {
    requiredDeltaFeatures: true,
    minSlopeWindows: 2,
    requireAcceleration: true,
    minRegimes: 3,
    consistencyRange: [0, 1] as [number, number],
  },
  
  SAFETY_READY: {
    uiIsolation: true,
    readOnlyTokensWallets: true,
    shadowMetricsLogged: true,
    rollbackAvailable: true,
    explainabilityAvailable: true,
  },
} as const;

// ============================================
// FINAL GATE DECISION LOGIC
// ============================================

/**
 * Compute final gate status from dual-horizon results
 * 
 * PASS:         24h PASS && 7d PASS -> ACTIVE_ELIGIBLE
 * SHADOW_ONLY:  7d PASS only        -> Shadow training allowed
 * BLOCKED:      24h FAIL            -> No training
 */
export function computeFinalGateStatus(
  gate24h: HorizonGateResult,
  gate7d: HorizonGateResult
): GateStatus {
  if (gate24h.passed && gate7d.passed) {
    return 'PASSED';
  } else if (gate7d.passed) {
    return 'SHADOW_ONLY';
  } else {
    return 'BLOCKED';
  }
}
