/**
 * BLOCK 77.2 — Proposal Rules
 * 
 * Deterministic rules for policy tuning suggestions.
 * All rules are evidence-based and conservative.
 * 
 * Categories:
 * - Tier weight adjustments
 * - Divergence penalty calibration
 * - Phase multiplier recalibration
 * - Threshold tuning
 */

import { LearningVector, TierPerformance, TierName } from './learning.types.js';
import { PolicyDelta, PROPOSAL_LIMITS } from './proposal.types.js';

// ═══════════════════════════════════════════════════════════════
// TIER WEIGHT RULES
// ═══════════════════════════════════════════════════════════════

export function generateTierWeightDeltas(
  learning: LearningVector,
  currentWeights: Record<TierName, number>
): PolicyDelta[] {
  const deltas: PolicyDelta[] = [];
  const { tier } = learning;
  
  // Rule 1: TIMING underperforms STRUCTURE
  if (
    tier.TIMING.samples >= 10 &&
    tier.STRUCTURE.samples >= 10 &&
    tier.TIMING.hitRate < tier.STRUCTURE.hitRate - 0.08 &&
    tier.TIMING.sharpe < tier.STRUCTURE.sharpe - 0.25
  ) {
    const shift = Math.min(0.05, currentWeights.TIMING - 0.10);
    if (shift > 0.02) {
      deltas.push({
        path: 'tierWeights.TIMING',
        from: currentWeights.TIMING,
        to: currentWeights.TIMING - shift,
        reason: 'TIMING underperforms STRUCTURE in forward truth',
        evidence: [
          `TIMING hitRate: ${(tier.TIMING.hitRate * 100).toFixed(0)}% vs STRUCTURE: ${(tier.STRUCTURE.hitRate * 100).toFixed(0)}%`,
          `TIMING Sharpe: ${tier.TIMING.sharpe.toFixed(2)} vs STRUCTURE: ${tier.STRUCTURE.sharpe.toFixed(2)}`,
        ],
        confidence: Math.min(0.9, 0.5 + tier.STRUCTURE.samples / 100),
        category: 'TIER_WEIGHT',
      });
      
      // Redistribute to STRUCTURE
      deltas.push({
        path: 'tierWeights.STRUCTURE',
        from: currentWeights.STRUCTURE,
        to: Math.min(0.60, currentWeights.STRUCTURE + shift * 0.7),
        reason: 'Reallocate from underperforming TIMING to outperforming STRUCTURE',
        evidence: ['Rebalance from TIMING reduction'],
        confidence: Math.min(0.9, 0.5 + tier.STRUCTURE.samples / 100),
        category: 'TIER_WEIGHT',
      });
    }
  }
  
  // Rule 2: TACTICAL dominance in EXPANSION regime
  if (
    learning.dominantRegime === 'EXPANSION' &&
    tier.TACTICAL.samples >= 10 &&
    tier.TACTICAL.sharpe > Math.max(tier.STRUCTURE.sharpe, tier.TIMING.sharpe) + 0.15
  ) {
    const shift = Math.min(0.05, PROPOSAL_LIMITS.maxTierWeightDelta);
    if (currentWeights.TACTICAL < 0.45) {
      deltas.push({
        path: 'tierWeights.TACTICAL',
        from: currentWeights.TACTICAL,
        to: currentWeights.TACTICAL + shift,
        reason: 'TACTICAL outperforms in EXPANSION regime',
        evidence: [
          `TACTICAL Sharpe in EXPANSION: ${tier.TACTICAL.sharpe.toFixed(2)}`,
          `Regime distribution: ${(learning.regimeDistribution.EXPANSION * 100).toFixed(0)}% EXPANSION`,
        ],
        confidence: 0.65,
        category: 'TIER_WEIGHT',
      });
    }
  }
  
  // Rule 3: STRUCTURE underweight when dominant
  if (
    learning.dominantTier === 'STRUCTURE' &&
    currentWeights.STRUCTURE < 0.50 &&
    tier.STRUCTURE.sharpe > 0.5 &&
    tier.STRUCTURE.samples >= 15
  ) {
    deltas.push({
      path: 'tierWeights.STRUCTURE',
      from: currentWeights.STRUCTURE,
      to: Math.min(0.55, currentWeights.STRUCTURE + 0.05),
      reason: 'STRUCTURE is dominant performer but underweighted',
      evidence: [
        `STRUCTURE Sharpe: ${tier.STRUCTURE.sharpe.toFixed(2)}`,
        `STRUCTURE hitRate: ${(tier.STRUCTURE.hitRate * 100).toFixed(0)}%`,
      ],
      confidence: 0.70,
      category: 'TIER_WEIGHT',
    });
  }
  
  return deltas;
}

// ═══════════════════════════════════════════════════════════════
// DIVERGENCE PENALTY RULES
// ═══════════════════════════════════════════════════════════════

export function generateDivergencePenaltyDeltas(
  learning: LearningVector,
  currentPenalties: Record<string, number>
): PolicyDelta[] {
  const deltas: PolicyDelta[] = [];
  const { divergenceImpact } = learning;
  
  // Rule 1: D/F grades have negative expectancy → increase penalty
  const gradeD = divergenceImpact.D;
  const gradeF = divergenceImpact.F;
  
  if (gradeD.samples >= 5 && (gradeD.expectancy < 0 || gradeD.hitRate < 0.45)) {
    const currentPenalty = currentPenalties['D'] || 0.10;
    const newPenalty = Math.min(0.20, currentPenalty + 0.03);
    if (newPenalty > currentPenalty) {
      deltas.push({
        path: 'divergencePenalties.D',
        from: currentPenalty,
        to: newPenalty,
        reason: 'Grade D signals show negative forward performance',
        evidence: [
          `Grade D expectancy: ${(gradeD.expectancy * 100).toFixed(1)}%`,
          `Grade D hitRate: ${(gradeD.hitRate * 100).toFixed(0)}%`,
        ],
        confidence: 0.75,
        category: 'DIVERGENCE_PENALTY',
      });
    }
  }
  
  if (gradeF.samples >= 5 && (gradeF.expectancy < 0 || gradeF.hitRate < 0.40)) {
    const currentPenalty = currentPenalties['F'] || 0.20;
    const newPenalty = Math.min(0.30, currentPenalty + 0.05);
    if (newPenalty > currentPenalty) {
      deltas.push({
        path: 'divergencePenalties.F',
        from: currentPenalty,
        to: newPenalty,
        reason: 'Grade F signals show poor forward performance',
        evidence: [
          `Grade F expectancy: ${(gradeF.expectancy * 100).toFixed(1)}%`,
          `Grade F hitRate: ${(gradeF.hitRate * 100).toFixed(0)}%`,
        ],
        confidence: 0.80,
        category: 'DIVERGENCE_PENALTY',
      });
    }
  }
  
  // Rule 2: A/B grades strongly outperform → slightly reduce penalty
  const gradeA = divergenceImpact.A;
  const gradeB = divergenceImpact.B;
  
  if (gradeA.samples >= 5 && gradeA.hitRate > 0.65 && gradeA.expectancy > 0.02) {
    const currentPenalty = currentPenalties['A'] || 0;
    if (currentPenalty > 0) {
      deltas.push({
        path: 'divergencePenalties.A',
        from: currentPenalty,
        to: Math.max(0, currentPenalty - 0.02),
        reason: 'Grade A signals strongly outperform - reduce penalty',
        evidence: [
          `Grade A hitRate: ${(gradeA.hitRate * 100).toFixed(0)}%`,
          `Grade A expectancy: ${(gradeA.expectancy * 100).toFixed(1)}%`,
        ],
        confidence: 0.65,
        category: 'DIVERGENCE_PENALTY',
      });
    }
  }
  
  return deltas;
}

// ═══════════════════════════════════════════════════════════════
// PHASE MULTIPLIER RULES
// ═══════════════════════════════════════════════════════════════

export function generatePhaseMultiplierDeltas(
  learning: LearningVector,
  currentMultipliers: Record<string, number>
): PolicyDelta[] {
  const deltas: PolicyDelta[] = [];
  const { phase } = learning;
  
  const MIN_SAMPLES = 8;
  
  for (const p of phase) {
    const currentMult = currentMultipliers[p.phase] || 1.0;
    
    // Rule 1: Strong phase (A/B grade, high Sharpe) → boost multiplier
    if (
      p.samples >= MIN_SAMPLES &&
      ['A', 'B'].includes(p.grade) &&
      p.sharpe > 0.5 &&
      p.hitRate > 0.55
    ) {
      const newMult = Math.min(PROPOSAL_LIMITS.maxPhaseMultiplier, currentMult + 0.05);
      if (newMult > currentMult) {
        deltas.push({
          path: `phaseMultipliers.${p.phase}`,
          from: currentMult,
          to: newMult,
          reason: `${p.phase} phase shows strong forward performance`,
          evidence: [
            `${p.phase} grade: ${p.grade}`,
            `${p.phase} Sharpe: ${p.sharpe.toFixed(2)}`,
            `${p.phase} hitRate: ${(p.hitRate * 100).toFixed(0)}%`,
          ],
          confidence: 0.70,
          category: 'PHASE_MULTIPLIER',
        });
      }
    }
    
    // Rule 2: Weak phase (D/F grade, negative expectancy) → reduce multiplier
    if (
      p.samples >= MIN_SAMPLES &&
      ['D', 'F'].includes(p.grade) &&
      (p.expectancy < 0 || p.hitRate < 0.45)
    ) {
      const newMult = Math.max(PROPOSAL_LIMITS.minPhaseMultiplier, currentMult - 0.08);
      if (newMult < currentMult) {
        deltas.push({
          path: `phaseMultipliers.${p.phase}`,
          from: currentMult,
          to: newMult,
          reason: `${p.phase} phase shows poor forward performance`,
          evidence: [
            `${p.phase} grade: ${p.grade}`,
            `${p.phase} expectancy: ${(p.expectancy * 100).toFixed(1)}%`,
            `${p.phase} hitRate: ${(p.hitRate * 100).toFixed(0)}%`,
          ],
          confidence: 0.75,
          category: 'PHASE_MULTIPLIER',
        });
      }
    }
  }
  
  return deltas;
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLD RULES
// ═══════════════════════════════════════════════════════════════

export function generateThresholdDeltas(
  learning: LearningVector,
  currentThresholds: Record<string, number>
): PolicyDelta[] {
  const deltas: PolicyDelta[] = [];
  
  // Rule 1: High calibration error → tighten confidence threshold
  if (learning.calibrationError > 0.15 && learning.resolvedSamples >= 20) {
    const currentMinConf = currentThresholds['minConfidence'] || 0.55;
    if (currentMinConf < 0.60) {
      deltas.push({
        path: 'thresholds.minConfidence',
        from: currentMinConf,
        to: Math.min(0.65, currentMinConf + 0.02),
        reason: 'High calibration error suggests tightening confidence filter',
        evidence: [
          `Calibration error: ${(learning.calibrationError * 100).toFixed(0)}%`,
        ],
        confidence: 0.60,
        category: 'THRESHOLD',
      });
    }
  }
  
  // Rule 2: Equity drift negative → tighten entropy threshold
  if (learning.equityDrift.deltaSharpe < -0.05 && learning.resolvedSamples >= 20) {
    const currentMaxEntropy = currentThresholds['maxEntropy'] || 0.75;
    if (currentMaxEntropy > 0.65) {
      deltas.push({
        path: 'thresholds.maxEntropy',
        from: currentMaxEntropy,
        to: Math.max(0.60, currentMaxEntropy - 0.03),
        reason: 'Negative equity drift suggests tightening entropy filter',
        evidence: [
          `Sharpe drift: ${learning.equityDrift.deltaSharpe.toFixed(2)}`,
        ],
        confidence: 0.55,
        category: 'THRESHOLD',
      });
    }
  }
  
  return deltas;
}

// ═══════════════════════════════════════════════════════════════
// MAIN RULE GENERATOR
// ═══════════════════════════════════════════════════════════════

export interface CurrentPolicy {
  tierWeights: Record<TierName, number>;
  divergencePenalties: Record<string, number>;
  phaseMultipliers: Record<string, number>;
  thresholds: Record<string, number>;
}

export function generateAllDeltas(
  learning: LearningVector,
  currentPolicy: CurrentPolicy
): PolicyDelta[] {
  const allDeltas: PolicyDelta[] = [];
  
  // Generate tier weight deltas
  allDeltas.push(...generateTierWeightDeltas(learning, currentPolicy.tierWeights));
  
  // Generate divergence penalty deltas
  allDeltas.push(...generateDivergencePenaltyDeltas(learning, currentPolicy.divergencePenalties));
  
  // Generate phase multiplier deltas
  allDeltas.push(...generatePhaseMultiplierDeltas(learning, currentPolicy.phaseMultipliers));
  
  // Generate threshold deltas
  allDeltas.push(...generateThresholdDeltas(learning, currentPolicy.thresholds));
  
  // Sort by confidence (highest first)
  return allDeltas.sort((a, b) => b.confidence - a.confidence);
}

export default {
  generateAllDeltas,
  generateTierWeightDeltas,
  generateDivergencePenaltyDeltas,
  generatePhaseMultiplierDeltas,
  generateThresholdDeltas,
};
