/**
 * Gate Check Rules
 * 
 * Applies thresholds to collected metrics
 * Returns section-level pass/fail with reasons
 */

import type { 
  SectionResult, 
  GateSection, 
  GateCheckResultDTO,
  GateStatus 
} from './gate_check.types.js';
import { GATE_THRESHOLDS } from './gate_check.types.js';
import { v4 as uuidv4 } from 'uuid';

interface CollectedMetrics {
  data: {
    tokensCount: number;
    chainsCount: number;
    timeSpanDays: number;
    signalsCount: number;
    avgCoverage: number;
    missingRate: number;
    hasUISource: boolean;
    hasMockSource: boolean;
    timestampsMonotonic: boolean;
  };
  labels: {
    labelsCount: number;
    windowsPresent: string[];
    classesCount: number;
    futureLeaks: number;
    dominantClassShare: number;
    hasFakeout: boolean;
    confidenceAsLabel: boolean;
  };
  negative: {
    negPosRatio: number;
    negativeTypes: number;
    noiseShare: number;
    exhaustionShare: number;
    structuralShare: number;
    isRandom: boolean;
    isManual: boolean;
  };
  temporal: {
    hasDeltaFeatures: boolean;
    slopeWindows: number;
    hasAcceleration: boolean;
    regimeCount: number;
    consistencyValid: boolean;
    hasRegimeFlags: boolean;
  };
  safety: {
    uiIsolation: boolean;
    readOnlyTokensWallets: boolean;
    shadowMetricsLogged: boolean;
    rollbackAvailable: boolean;
    explainabilityAvailable: boolean;
    confidenceInLoss: boolean;
  };
}

function evaluateDataReady(metrics: CollectedMetrics['data']): SectionResult {
  const t = GATE_THRESHOLDS.DATA_READY;
  const reasons: string[] = [];
  
  if (metrics.tokensCount < t.minTokens) {
    reasons.push(`Tokens ${metrics.tokensCount} < ${t.minTokens}`);
  }
  if (metrics.chainsCount < t.minChains) {
    reasons.push(`Chains ${metrics.chainsCount} < ${t.minChains}`);
  }
  if (metrics.timeSpanDays < t.minTimeSpanDays) {
    reasons.push(`Time span ${metrics.timeSpanDays}d < ${t.minTimeSpanDays}d`);
  }
  if (metrics.signalsCount < t.minSignals) {
    reasons.push(`Signals ${metrics.signalsCount} < ${t.minSignals}`);
  }
  if (metrics.avgCoverage < t.minAvgCoverage) {
    reasons.push(`Coverage ${(metrics.avgCoverage * 100).toFixed(1)}% < ${t.minAvgCoverage * 100}%`);
  }
  if (metrics.missingRate > t.maxMissingRate) {
    reasons.push(`Missing rate ${(metrics.missingRate * 100).toFixed(1)}% > ${t.maxMissingRate * 100}%`);
  }
  if (metrics.hasUISource) {
    reasons.push('Data generated from UI (forbidden)');
  }
  if (metrics.hasMockSource) {
    reasons.push('Mock data source detected (forbidden)');
  }
  if (!metrics.timestampsMonotonic) {
    reasons.push('Timestamps not monotonic');
  }
  
  return {
    section: 'DATA_READY',
    passed: reasons.length === 0,
    reasons,
    metrics: metrics as unknown as Record<string, number | string | boolean>,
  };
}

function evaluateLabelsReady(metrics: CollectedMetrics['labels']): SectionResult {
  const t = GATE_THRESHOLDS.LABELS_READY;
  const reasons: string[] = [];
  
  if (metrics.labelsCount < t.minLabels) {
    reasons.push(`Labels ${metrics.labelsCount} < ${t.minLabels}`);
  }
  
  const missingWindows = t.requiredWindows.filter(w => !metrics.windowsPresent.includes(w));
  if (missingWindows.length > 0) {
    reasons.push(`Missing windows: ${missingWindows.join(', ')}`);
  }
  
  if (metrics.classesCount < t.minClasses) {
    reasons.push(`Classes ${metrics.classesCount} < ${t.minClasses}`);
  }
  if (metrics.futureLeaks > t.maxFutureLeaks) {
    reasons.push(`Future leaks detected: ${metrics.futureLeaks}`);
  }
  if (metrics.dominantClassShare > t.maxDominantClassShare) {
    reasons.push(`Dominant class ${(metrics.dominantClassShare * 100).toFixed(1)}% > ${t.maxDominantClassShare * 100}%`);
  }
  if (t.requireFakeout && !metrics.hasFakeout) {
    reasons.push('FAKEOUT class missing (required)');
  }
  if (metrics.confidenceAsLabel) {
    reasons.push('Confidence used as label (forbidden)');
  }
  
  return {
    section: 'LABELS_READY',
    passed: reasons.length === 0,
    reasons,
    metrics: {
      labelsCount: metrics.labelsCount,
      classesCount: metrics.classesCount,
      hasFakeout: metrics.hasFakeout,
      dominantClassShare: metrics.dominantClassShare,
    },
  };
}

function evaluateNegativeReady(metrics: CollectedMetrics['negative']): SectionResult {
  const t = GATE_THRESHOLDS.NEGATIVE_READY;
  const reasons: string[] = [];
  
  if (metrics.negPosRatio < t.minNegPosRatio) {
    reasons.push(`Neg:Pos ratio ${metrics.negPosRatio.toFixed(2)} < ${t.minNegPosRatio}`);
  }
  if (metrics.negativeTypes < t.minNegativeTypes) {
    reasons.push(`Negative types ${metrics.negativeTypes} < ${t.minNegativeTypes}`);
  }
  if (metrics.noiseShare < t.minNoiseShare) {
    reasons.push(`Noise share ${(metrics.noiseShare * 100).toFixed(1)}% < ${t.minNoiseShare * 100}%`);
  }
  if (metrics.exhaustionShare < t.minExhaustionShare) {
    reasons.push(`Exhaustion share ${(metrics.exhaustionShare * 100).toFixed(1)}% < ${t.minExhaustionShare * 100}%`);
  }
  if (metrics.structuralShare < t.minStructuralShare) {
    reasons.push(`Structural share ${(metrics.structuralShare * 100).toFixed(1)}% < ${t.minStructuralShare * 100}%`);
  }
  if (metrics.isRandom) {
    reasons.push('Negatives are random (forbidden)');
  }
  if (metrics.isManual) {
    reasons.push('Negatives manually created post-factum (forbidden)');
  }
  
  return {
    section: 'NEGATIVE_READY',
    passed: reasons.length === 0,
    reasons,
    metrics: {
      negPosRatio: metrics.negPosRatio,
      negativeTypes: metrics.negativeTypes,
      noiseShare: metrics.noiseShare,
    },
  };
}

function evaluateTemporalReady(metrics: CollectedMetrics['temporal']): SectionResult {
  const t = GATE_THRESHOLDS.TEMPORAL_READY;
  const reasons: string[] = [];
  
  if (t.requiredDeltaFeatures && !metrics.hasDeltaFeatures) {
    reasons.push('Delta features not present');
  }
  if (metrics.slopeWindows < t.minSlopeWindows) {
    reasons.push(`Slope windows ${metrics.slopeWindows} < ${t.minSlopeWindows}`);
  }
  if (t.requireAcceleration && !metrics.hasAcceleration) {
    reasons.push('Acceleration not calculated');
  }
  if (metrics.regimeCount < t.minRegimes) {
    reasons.push(`Regime count ${metrics.regimeCount} < ${t.minRegimes}`);
  }
  if (!metrics.consistencyValid) {
    reasons.push('Consistency not in valid range [0,1]');
  }
  if (!metrics.hasRegimeFlags) {
    reasons.push('Regime flags missing');
  }
  
  return {
    section: 'TEMPORAL_READY',
    passed: reasons.length === 0,
    reasons,
    metrics: {
      hasDeltaFeatures: metrics.hasDeltaFeatures,
      slopeWindows: metrics.slopeWindows,
      hasAcceleration: metrics.hasAcceleration,
      regimeCount: metrics.regimeCount,
    },
  };
}

function evaluateSafetyReady(metrics: CollectedMetrics['safety']): SectionResult {
  const t = GATE_THRESHOLDS.SAFETY_READY;
  const reasons: string[] = [];
  
  if (t.uiIsolation && !metrics.uiIsolation) {
    reasons.push('UI isolation not ensured');
  }
  if (t.readOnlyTokensWallets && !metrics.readOnlyTokensWallets) {
    reasons.push('Tokens/Wallets not read-only');
  }
  if (t.shadowMetricsLogged && !metrics.shadowMetricsLogged) {
    reasons.push('Shadow metrics not logged');
  }
  if (t.rollbackAvailable && !metrics.rollbackAvailable) {
    reasons.push('Rollback not available');
  }
  if (t.explainabilityAvailable && !metrics.explainabilityAvailable) {
    reasons.push('Explainability not available');
  }
  if (metrics.confidenceInLoss) {
    reasons.push('Confidence participates in loss (forbidden)');
  }
  
  return {
    section: 'SAFETY_READY',
    passed: reasons.length === 0,
    reasons,
    metrics: {
      uiIsolation: metrics.uiIsolation,
      rollbackAvailable: metrics.rollbackAvailable,
      shadowMetricsLogged: metrics.shadowMetricsLogged,
    },
  };
}

export function evaluateSections(collected: CollectedMetrics): SectionResult[] {
  return [
    evaluateDataReady(collected.data),
    evaluateLabelsReady(collected.labels),
    evaluateNegativeReady(collected.negative),
    evaluateTemporalReady(collected.temporal),
    evaluateSafetyReady(collected.safety),
  ];
}

export function buildResult(
  horizon: '7d' | '30d',
  sections: SectionResult[]
): GateCheckResultDTO {
  const failedSections = sections.filter(s => !s.passed).map(s => s.section);
  const passedSections = sections.filter(s => s.passed).map(s => s.section);
  
  const allReasons = sections.flatMap(s => s.reasons);
  const allMetrics: Record<string, number | string | boolean> = {};
  
  for (const section of sections) {
    for (const [key, value] of Object.entries(section.metrics)) {
      allMetrics[`${section.section}.${key}`] = value;
    }
  }
  
  const gateStatus: GateStatus = failedSections.length === 0 ? 'PASSED' : 'BLOCKED';
  
  return {
    runId: uuidv4(),
    horizon,
    gate_status: gateStatus,
    trainingAllowed: gateStatus === 'PASSED',
    failed_sections: failedSections,
    passed_sections: passedSections,
    reasons: allReasons,
    metrics: allMetrics,
    sections,
    createdAt: new Date().toISOString(),
    version: '1.0.0',
  };
}

export type { CollectedMetrics };
