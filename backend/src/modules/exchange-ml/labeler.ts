/**
 * S10.7.1 — Labeler
 * 
 * Deterministic rules-based labeling for training data.
 * 
 * Labels:
 * - WARNING: Dangerous market environment
 * - USE: Readable, structured market
 * - IGNORE: Everything else (noise, uncertainty)
 * 
 * NOT "buy/sell". This classifies ENVIRONMENT, not direction.
 */

import { MLLabel, LabelingResult, LabelingThresholds, DEFAULT_THRESHOLDS, MLFeatures } from './ml.types.js';
import { ExchangeObservationRow } from '../exchange/observation/observation.types.js';
import { extractFeatures } from './featureExtractor.js';

// ═══════════════════════════════════════════════════════════════
// MAIN LABELING FUNCTION
// ═══════════════════════════════════════════════════════════════

export function labelObservation(
  row: ExchangeObservationRow,
  thresholds: LabelingThresholds = DEFAULT_THRESHOLDS
): LabelingResult {
  const features = extractFeatures(row);
  
  // Check WARNING triggers first (highest priority)
  const warningResult = checkWarningTriggers(row, features, thresholds);
  if (warningResult) {
    return warningResult;
  }
  
  // Check USE conditions
  const useResult = checkUseConditions(row, features, thresholds);
  if (useResult) {
    return useResult;
  }
  
  // Default to IGNORE
  return {
    label: 'IGNORE',
    reason: 'No clear market structure',
    triggers: ['Default: insufficient confidence or structure'],
  };
}

// ═══════════════════════════════════════════════════════════════
// WARNING CHECK
// ═══════════════════════════════════════════════════════════════

function checkWarningTriggers(
  row: ExchangeObservationRow,
  features: MLFeatures,
  thresholds: LabelingThresholds
): LabelingResult | null {
  const triggers: string[] = [];
  
  // 1. Active liquidation cascade
  if (row.liquidations?.cascadeActive) {
    triggers.push('cascade_active');
  }
  
  // 2. High liquidation intensity
  if (features.liquidationIntensity >= thresholds.liquidationIntensityWarning) {
    triggers.push(`liquidation_intensity=${features.liquidationIntensity.toFixed(2)}`);
  }
  
  // 3. Multiple conflicting patterns
  if (features.conflictCount >= thresholds.conflictCountWarning) {
    triggers.push(`conflict_count=${features.conflictCount}`);
  }
  
  // 4. Squeeze regimes with high confidence (dangerous for one side)
  const regime = row.regime?.type || 'NEUTRAL';
  const regimeConf = row.regime?.confidence || 0;
  if (
    (regime === 'LONG_SQUEEZE' || regime === 'SHORT_SQUEEZE' || regime === 'EXHAUSTION') &&
    regimeConf >= thresholds.regimeConfidenceWarning
  ) {
    triggers.push(`regime=${regime} (conf=${regimeConf.toFixed(2)})`);
  }
  
  // 5. High market stress composite
  if (features.marketStress >= 0.7) {
    triggers.push(`market_stress=${features.marketStress.toFixed(2)}`);
  }
  
  // Return WARNING if any trigger fired
  if (triggers.length > 0) {
    return {
      label: 'WARNING',
      reason: buildWarningReason(triggers),
      triggers,
    };
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// USE CHECK
// ═══════════════════════════════════════════════════════════════

function checkUseConditions(
  row: ExchangeObservationRow,
  features: MLFeatures,
  thresholds: LabelingThresholds
): LabelingResult | null {
  const reasons: string[] = [];
  const failures: string[] = [];
  
  // 1. Regime confidence must be high
  if (features.regimeConfidence >= thresholds.regimeConfidenceUse) {
    reasons.push(`regime_conf=${features.regimeConfidence.toFixed(2)}`);
  } else {
    failures.push(`regime_conf=${features.regimeConfidence.toFixed(2)} < ${thresholds.regimeConfidenceUse}`);
  }
  
  // 2. No conflicts
  if (features.conflictCount <= thresholds.maxConflictsUse) {
    reasons.push('no_conflicts');
  } else {
    failures.push(`conflicts=${features.conflictCount}`);
  }
  
  // 3. Readability must be sufficient
  if (features.readability >= thresholds.minReadabilityUse) {
    reasons.push(`readability=${features.readability.toFixed(2)}`);
  } else {
    failures.push(`readability=${features.readability.toFixed(2)} < ${thresholds.minReadabilityUse}`);
  }
  
  // 4. Not in stress state
  if (features.marketStress < 0.5) {
    reasons.push('low_stress');
  } else {
    failures.push(`stress=${features.marketStress.toFixed(2)}`);
  }
  
  // 5. Regime should be constructive (EXPANSION, ACCUMULATION, or confident NEUTRAL)
  const regime = row.regime?.type || 'NEUTRAL';
  const constructiveRegimes = ['EXPANSION', 'ACCUMULATION', 'NEUTRAL'];
  if (constructiveRegimes.includes(regime)) {
    reasons.push(`regime=${regime}`);
  }
  
  // USE requires most conditions to pass
  if (failures.length === 0 && reasons.length >= 4) {
    return {
      label: 'USE',
      reason: 'Market is readable and structured',
      triggers: reasons,
    };
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function buildWarningReason(triggers: string[]): string {
  if (triggers.includes('cascade_active')) {
    return 'Active liquidation cascade - dangerous environment';
  }
  if (triggers.some(t => t.startsWith('regime=LONG_SQUEEZE'))) {
    return 'Long squeeze in progress - risk of continued liquidations';
  }
  if (triggers.some(t => t.startsWith('regime=SHORT_SQUEEZE'))) {
    return 'Short squeeze in progress - volatile environment';
  }
  if (triggers.some(t => t.startsWith('conflict_count'))) {
    return 'Conflicting signals - market indecision';
  }
  if (triggers.some(t => t.startsWith('market_stress'))) {
    return 'High market stress - elevated risk';
  }
  return 'Dangerous market conditions detected';
}

// ═══════════════════════════════════════════════════════════════
// BATCH LABELING
// ═══════════════════════════════════════════════════════════════

export function labelBatch(
  rows: ExchangeObservationRow[],
  thresholds: LabelingThresholds = DEFAULT_THRESHOLDS
): Array<{ id: string; result: LabelingResult }> {
  return rows.map(row => ({
    id: row.id,
    result: labelObservation(row, thresholds),
  }));
}

// ═══════════════════════════════════════════════════════════════
// LABEL FROM FEATURES (for predictions)
// ═══════════════════════════════════════════════════════════════

export function labelFromFeatures(
  features: MLFeatures,
  thresholds: LabelingThresholds = DEFAULT_THRESHOLDS
): LabelingResult {
  const triggers: string[] = [];
  
  // WARNING checks
  if (features.cascadeActive >= 0.5) {
    triggers.push('cascade_active');
    return { label: 'WARNING', reason: 'Active cascade', triggers };
  }
  
  if (features.liquidationIntensity >= thresholds.liquidationIntensityWarning) {
    triggers.push(`liquidation_intensity=${features.liquidationIntensity.toFixed(2)}`);
    return { label: 'WARNING', reason: 'High liquidation intensity', triggers };
  }
  
  if (features.conflictCount >= thresholds.conflictCountWarning) {
    triggers.push(`conflicts=${features.conflictCount}`);
    return { label: 'WARNING', reason: 'Conflicting signals', triggers };
  }
  
  if (features.marketStress >= 0.7) {
    triggers.push(`stress=${features.marketStress.toFixed(2)}`);
    return { label: 'WARNING', reason: 'High market stress', triggers };
  }
  
  if (features.regimeIsSqueeze >= 0.5 && features.regimeConfidence >= 0.6) {
    triggers.push('squeeze_regime');
    return { label: 'WARNING', reason: 'Squeeze regime active', triggers };
  }
  
  // USE checks
  if (
    features.regimeConfidence >= thresholds.regimeConfidenceUse &&
    features.conflictCount <= thresholds.maxConflictsUse &&
    features.readability >= thresholds.minReadabilityUse &&
    features.marketStress < 0.5
  ) {
    return {
      label: 'USE',
      reason: 'Market is readable',
      triggers: ['high_confidence', 'no_conflicts', 'good_readability'],
    };
  }
  
  // IGNORE default
  return {
    label: 'IGNORE',
    reason: 'Insufficient structure',
    triggers: ['default'],
  };
}

console.log('[S10.7] Labeler loaded');
