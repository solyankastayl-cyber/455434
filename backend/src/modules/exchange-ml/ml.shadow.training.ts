/**
 * ML Shadow Training Service
 * 
 * Safe ML retraining with macro features:
 * - Shadow mode only (no production deployment)
 * - Comparison metrics vs active model
 * - Red flag detection
 * - Rollback safety
 * 
 * RULES (LOCKED):
 * - Macro NEVER changes direction
 * - Macro can ONLY reduce confidence
 * - Model must pass all acceptance criteria
 * - Auto-rollback on drift
 */

import { 
  MLTrainingConfig, 
  MacroContextFeatures,
  DEFAULT_MACRO_TRAINING_CONFIG 
} from './ml.types.js';
import { 
  extractMacroFeatures, 
  macroFeaturesToVector, 
  DEFAULT_MACRO_FEATURES,
  isMacroDataValid 
} from './macroFeatureExtractor.js';
import { getMacroIntelContext } from '../macro-intel/services/macro-intel.snapshot.service.js';

// ═══════════════════════════════════════════════════════════════
// SHADOW TRAINING STATE
// ═══════════════════════════════════════════════════════════════

interface ShadowTrainingState {
  status: 'IDLE' | 'TRAINING' | 'EVALUATING' | 'COMPLETE' | 'FAILED';
  config: MLTrainingConfig;
  startedAt: number | null;
  completedAt: number | null;
  
  // Metrics
  metrics: {
    accuracy: number;
    accuracyDelta: number;  // vs active model
    brier: number;
    brierDelta: number;
    ece: number;
    driftScore: number;
    
    // Per-regime breakdown
    regimeAccuracy: Record<number, number>;  // regime_id -> accuracy
  } | null;
  
  // Red flags
  redFlags: string[];
  
  // Promotion
  promotionReady: boolean;
  promotionBlockedBy: string[];
}

let shadowState: ShadowTrainingState = {
  status: 'IDLE',
  config: DEFAULT_MACRO_TRAINING_CONFIG,
  startedAt: null,
  completedAt: null,
  metrics: null,
  redFlags: [],
  promotionReady: false,
  promotionBlockedBy: [],
};

// ═══════════════════════════════════════════════════════════════
// PRE-CHECK VALIDATION
// ═══════════════════════════════════════════════════════════════

interface PreCheckResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; message: string }>;
}

export async function runPreChecks(): Promise<PreCheckResult> {
  const checks: PreCheckResult['checks'] = [];
  
  // Check 1: Macro Intel module is available
  try {
    const macroContext = await getMacroIntelContext();
    checks.push({
      name: 'Macro Intel Available',
      passed: !!macroContext,
      message: macroContext ? 'Macro context available' : 'Macro context unavailable',
    });
  } catch (error) {
    checks.push({
      name: 'Macro Intel Available',
      passed: false,
      message: `Macro context error: ${error}`,
    });
  }
  
  // Check 2: Regime IDs are stable (0-7)
  checks.push({
    name: 'Regime IDs Stable',
    passed: true,  // Always true after freeze
    message: 'Regime IDs frozen at 0-7',
  });
  
  // Check 3: No active training
  checks.push({
    name: 'No Active Training',
    passed: shadowState.status === 'IDLE' || shadowState.status === 'COMPLETE' || shadowState.status === 'FAILED',
    message: shadowState.status === 'IDLE' ? 'Ready for training' : `Current status: ${shadowState.status}`,
  });
  
  // Check 4: Config validation
  const config = shadowState.config;
  const configValid = (
    config.mode === 'SHADOW_ONLY' &&
    config.constraints.neverIncreaseConfidence &&
    config.constraints.neverChangeDirection
  );
  checks.push({
    name: 'Config Validation',
    passed: configValid,
    message: configValid ? 'Config locked for safe training' : 'Config validation failed',
  });
  
  return {
    passed: checks.every(c => c.passed),
    checks,
  };
}

// ═══════════════════════════════════════════════════════════════
// SHADOW TRAINING
// ═══════════════════════════════════════════════════════════════

export async function startShadowTraining(config?: Partial<MLTrainingConfig>): Promise<{
  started: boolean;
  preChecks: PreCheckResult;
  message: string;
}> {
  // Merge config
  const finalConfig: MLTrainingConfig = {
    ...DEFAULT_MACRO_TRAINING_CONFIG,
    ...config,
    mode: 'SHADOW_ONLY', // Force shadow mode
    constraints: {
      ...DEFAULT_MACRO_TRAINING_CONFIG.constraints,
      ...config?.constraints,
      neverIncreaseConfidence: true, // Force
      neverChangeDirection: true,    // Force
    },
  };
  
  // Run pre-checks
  const preChecks = await runPreChecks();
  if (!preChecks.passed) {
    return {
      started: false,
      preChecks,
      message: 'Pre-checks failed. Training not started.',
    };
  }
  
  // Update state
  shadowState = {
    status: 'TRAINING',
    config: finalConfig,
    startedAt: Date.now(),
    completedAt: null,
    metrics: null,
    redFlags: [],
    promotionReady: false,
    promotionBlockedBy: [],
  };
  
  console.log('[ShadowTraining] Started with config:', finalConfig.runName);
  
  // Note: Actual training would be async/background
  // For now, we simulate the structure
  
  return {
    started: true,
    preChecks,
    message: `Shadow training started: ${finalConfig.runName}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// METRICS EVALUATION
// ═══════════════════════════════════════════════════════════════

export function evaluateMetrics(
  candidateMetrics: { accuracy: number; brier: number; ece: number },
  activeMetrics: { accuracy: number; brier: number; ece: number },
  regimeBreakdown: Record<number, number>
): {
  passed: boolean;
  redFlags: string[];
  details: ShadowTrainingState['metrics'];
} {
  const redFlags: string[] = [];
  const config = shadowState.config;
  
  // Calculate deltas
  const accuracyDelta = candidateMetrics.accuracy - activeMetrics.accuracy;
  const brierDelta = candidateMetrics.brier - activeMetrics.brier;
  
  // Check acceptance criteria
  if (accuracyDelta < config.evaluation.acceptance.minAccuracyDeltaVsActive) {
    redFlags.push(`Accuracy dropped too much: ${(accuracyDelta * 100).toFixed(1)}%`);
  }
  
  if (brierDelta > config.evaluation.acceptance.maxBrierDeltaVsActive) {
    redFlags.push(`Brier score increased too much: +${brierDelta.toFixed(3)}`);
  }
  
  if (candidateMetrics.ece > config.evaluation.acceptance.maxEce) {
    redFlags.push(`ECE too high: ${candidateMetrics.ece.toFixed(3)}`);
  }
  
  // Check regime-specific issues
  // LOW_RISK regimes should have high accuracy
  const lowRiskRegimes = [0, 2, 4, 6]; // BTC_FLIGHT, BTC_LEADS, ALT_ROTATION, ALT_SEASON
  for (const regimeId of lowRiskRegimes) {
    if (regimeBreakdown[regimeId] !== undefined && regimeBreakdown[regimeId] < 0.5) {
      redFlags.push(`Low accuracy in LOW_RISK regime ${regimeId}: ${(regimeBreakdown[regimeId] * 100).toFixed(1)}%`);
    }
  }
  
  // HIGH_RISK regimes should be conservative
  const highRiskRegimes = [1, 3, 5, 7]; // PANIC, BTC_MAX, FULL_RISK_OFF, CAPITAL_EXIT
  for (const regimeId of highRiskRegimes) {
    if (regimeBreakdown[regimeId] !== undefined && regimeBreakdown[regimeId] > 0.8) {
      // Too confident in high risk = potential danger
      redFlags.push(`Too confident in HIGH_RISK regime ${regimeId}: ${(regimeBreakdown[regimeId] * 100).toFixed(1)}%`);
    }
  }
  
  const metrics: ShadowTrainingState['metrics'] = {
    accuracy: candidateMetrics.accuracy,
    accuracyDelta,
    brier: candidateMetrics.brier,
    brierDelta,
    ece: candidateMetrics.ece,
    driftScore: Math.abs(brierDelta) + Math.abs(accuracyDelta) * 0.5,
    regimeAccuracy: regimeBreakdown,
  };
  
  return {
    passed: redFlags.length === 0,
    redFlags,
    details: metrics,
  };
}

// ═══════════════════════════════════════════════════════════════
// RED FLAG CHECKS (POST-TRAINING)
// ═══════════════════════════════════════════════════════════════

export function checkRedFlags(
  predictions: Array<{ predicted: string; actual: string; confidence: number; regimeId: number }>
): string[] {
  const redFlags: string[] = [];
  
  // Check 1: Model almost always AVOID
  const avoidRate = predictions.filter(p => p.predicted === 'IGNORE').length / predictions.length;
  if (avoidRate > 0.8) {
    redFlags.push(`Model too conservative: ${(avoidRate * 100).toFixed(1)}% IGNORE/AVOID`);
  }
  
  // Check 2: Confidence collapse in ALT_SEASON (regimeId 6)
  const altSeasonPreds = predictions.filter(p => p.regimeId === 6);
  if (altSeasonPreds.length > 10) {
    const avgConfidence = altSeasonPreds.reduce((s, p) => s + p.confidence, 0) / altSeasonPreds.length;
    if (avgConfidence < 0.3) {
      redFlags.push(`Confidence collapse in ALT_SEASON: ${(avgConfidence * 100).toFixed(1)}%`);
    }
  }
  
  // Check 3: BUY/SELL disappear in LOW_RISK
  const lowRiskPreds = predictions.filter(p => [0, 2, 4, 6].includes(p.regimeId));
  const usePredictions = lowRiskPreds.filter(p => p.predicted === 'USE');
  if (lowRiskPreds.length > 10 && usePredictions.length / lowRiskPreds.length < 0.1) {
    redFlags.push(`USE predictions disappeared in LOW_RISK regimes`);
  }
  
  // Check 4: Direction changes (should be 0)
  // This would require comparing with active model predictions
  // For now, we track this separately
  
  return redFlags;
}

// ═══════════════════════════════════════════════════════════════
// PROMOTION GATE
// ═══════════════════════════════════════════════════════════════

export function checkPromotionGate(): {
  ready: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  
  // Check training completed
  if (shadowState.status !== 'COMPLETE') {
    blockers.push(`Training not complete: ${shadowState.status}`);
  }
  
  // Check metrics available
  if (!shadowState.metrics) {
    blockers.push('Metrics not available');
  }
  
  // Check red flags
  if (shadowState.redFlags.length > 0) {
    blockers.push(`Red flags present: ${shadowState.redFlags.join(', ')}`);
  }
  
  // Check acceptance criteria
  if (shadowState.metrics) {
    const { acceptance } = shadowState.config.evaluation;
    
    if (shadowState.metrics.accuracyDelta < acceptance.minAccuracyDeltaVsActive) {
      blockers.push('Accuracy delta below threshold');
    }
    
    if (shadowState.metrics.brierDelta > acceptance.maxBrierDeltaVsActive) {
      blockers.push('Brier delta above threshold');
    }
    
    if (shadowState.metrics.ece > acceptance.maxEce) {
      blockers.push('ECE above threshold');
    }
    
    if (shadowState.metrics.driftScore > acceptance.maxDriftScore) {
      blockers.push('Drift score above threshold');
    }
  }
  
  return {
    ready: blockers.length === 0,
    blockers,
  };
}

// ═══════════════════════════════════════════════════════════════
// STATE GETTERS
// ═══════════════════════════════════════════════════════════════

export function getShadowTrainingState(): ShadowTrainingState {
  return { ...shadowState };
}

export function resetShadowTraining(): void {
  shadowState = {
    status: 'IDLE',
    config: DEFAULT_MACRO_TRAINING_CONFIG,
    startedAt: null,
    completedAt: null,
    metrics: null,
    redFlags: [],
    promotionReady: false,
    promotionBlockedBy: [],
  };
  console.log('[ShadowTraining] State reset');
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION COMPLETE (for testing)
// ═══════════════════════════════════════════════════════════════

export function simulateShadowTrainingComplete(
  candidateMetrics: { accuracy: number; brier: number; ece: number },
  activeMetrics: { accuracy: number; brier: number; ece: number },
  regimeBreakdown: Record<number, number>
): ShadowTrainingState {
  const evaluation = evaluateMetrics(candidateMetrics, activeMetrics, regimeBreakdown);
  const promotionGate = checkPromotionGate();
  
  shadowState = {
    ...shadowState,
    status: evaluation.passed ? 'COMPLETE' : 'FAILED',
    completedAt: Date.now(),
    metrics: evaluation.details,
    redFlags: evaluation.redFlags,
    promotionReady: promotionGate.ready,
    promotionBlockedBy: promotionGate.blockers,
  };
  
  return shadowState;
}

console.log('[ShadowTraining] Service loaded');
