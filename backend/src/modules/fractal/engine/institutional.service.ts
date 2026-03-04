/**
 * BLOCK 39.x — Unified Institutional Service
 * 
 * Combines all institutional components:
 * - 39.1: Horizon Budget Control
 * - 39.2: Smooth Exposure Mapping
 * - 39.3: Tail-Aware Objective
 * - 39.4: Institutional Score
 * - 39.5: Phase Risk Multiplier
 */

import {
  InstitutionalConfig,
  DEFAULT_INSTITUTIONAL_CONFIG,
  HorizonKey,
  MarketPhase,
} from '../contracts/institutional.contracts.js';
import { assembleWithBudget, HorizonScore } from './horizon-budget.service.js';
import { computeFinalExposure, applyAntiFlipFriction } from './exposure-map.service.js';
import { computeInstitutionalScore, quickInstitutionalScore } from './institutional-score.service.js';
import { applyPhaseAdjustment, getPhaseHorizonPolicy } from './phase-risk.service.js';
import { computeTailAwareObjective, certifyWeights, ObjectiveInputs } from './tail-objective.service.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface InstitutionalSignalInput {
  horizonScores: HorizonScore[];
  entropyScale: number;
  reliability: number;
  phase: MarketPhase;
  currentDirection?: 'LONG' | 'SHORT' | 'NEUTRAL';
}

export interface InstitutionalSignalResult {
  signal: 'LONG' | 'SHORT' | 'NEUTRAL';
  assembledScore: number;
  exposure: {
    base: number;
    afterEntropy: number;
    afterReliability: number;
    afterPhase: number;
    final: number;
  };
  budget: {
    original: Record<HorizonKey, number>;
    redistributed: Record<HorizonKey, number>;
    dominantHorizon: HorizonKey | null;
    dominancePct: number;
    wasCapped: boolean;
  };
  phase: {
    current: MarketPhase;
    multiplier: number;
    horizonPolicy: ReturnType<typeof getPhaseHorizonPolicy>;
  };
  institutionalScore?: {
    score: number;
    riskProfile: string;
    maxExposure: number;
  };
  antiFlip?: {
    flipped: boolean;
    friction: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Main Institutional Signal Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Compute institutional-grade signal with all protections
 */
export function computeInstitutionalSignal(
  input: InstitutionalSignalInput,
  cfg: InstitutionalConfig = DEFAULT_INSTITUTIONAL_CONFIG
): InstitutionalSignalResult {
  // 39.1: Apply horizon budget
  const { assembledScore, direction, budgetResult } = assembleWithBudget(
    input.horizonScores,
    cfg.horizonBudget
  );
  
  // 39.5: Get phase policy and multiplier
  const phaseMultiplier = applyPhaseAdjustment(
    1.0, // base exposure
    input.phase,
    input.reliability,
    cfg.phaseRisk
  ).phaseMultiplier;
  const horizonPolicy = getPhaseHorizonPolicy(input.phase);
  
  // 39.2: Smooth exposure mapping
  const exposureResult = computeFinalExposure({
    absScore: Math.abs(assembledScore),
    entropyScale: input.entropyScale,
    reliabilityModifier: input.reliability,
    phaseMultiplier,
    direction,
  }, cfg.exposureMap);
  
  // Anti-flip friction (if previous direction known)
  let antiFlip: { flipped: boolean; friction: number } | undefined;
  let finalDirection = direction;
  
  if (input.currentDirection) {
    const flipResult = applyAntiFlipFriction(
      input.currentDirection,
      assembledScore,
      0.05 // flip threshold
    );
    finalDirection = flipResult.direction;
    antiFlip = {
      flipped: flipResult.flipped,
      friction: flipResult.friction,
    };
  }
  
  // 39.4: Compute institutional score (if we have the data)
  const instScore = quickInstitutionalScore({
    reliability: input.reliability,
    stability: 0.7, // default
  });
  
  return {
    signal: finalDirection,
    assembledScore,
    exposure: {
      base: exposureResult.baseExposure,
      afterEntropy: exposureResult.baseExposure * input.entropyScale,
      afterReliability: exposureResult.baseExposure * input.entropyScale * input.reliability,
      afterPhase: exposureResult.finalExposure,
      final: exposureResult.sizeMultiplier,
    },
    budget: {
      original: budgetResult.original,
      redistributed: budgetResult.redistributed,
      dominantHorizon: budgetResult.dominantHorizon,
      dominancePct: budgetResult.dominancePct,
      wasCapped: budgetResult.wasCapped,
    },
    phase: {
      current: input.phase,
      multiplier: phaseMultiplier,
      horizonPolicy,
    },
    institutionalScore: {
      score: instScore.score,
      riskProfile: instScore.riskProfile,
      maxExposure: instScore.score >= 0.75 ? 1.0 : instScore.score >= 0.55 ? 0.7 : 0.4,
    },
    antiFlip,
  };
}

// ═══════════════════════════════════════════════════════════════
// Institutional Summary
// ═══════════════════════════════════════════════════════════════

export interface InstitutionalSummary {
  version: string;
  modules: {
    horizonBudget: boolean;
    smoothExposure: boolean;
    tailObjective: boolean;
    institutionalScore: boolean;
    phaseRisk: boolean;
    antiFlip: boolean;
  };
  config: InstitutionalConfig;
  status: 'ACTIVE' | 'DEGRADED' | 'DISABLED';
}

export function getInstitutionalSummary(): InstitutionalSummary {
  return {
    version: '2.1',
    modules: {
      horizonBudget: true,
      smoothExposure: true,
      tailObjective: true,
      institutionalScore: true,
      phaseRisk: true,
      antiFlip: true,
    },
    config: DEFAULT_INSTITUTIONAL_CONFIG,
    status: 'ACTIVE',
  };
}

// ═══════════════════════════════════════════════════════════════
// Weight Optimization Interface
// ═══════════════════════════════════════════════════════════════

export interface WeightOptimizationResult {
  weights: Record<HorizonKey, number>;
  objective: ReturnType<typeof computeTailAwareObjective>;
  certification: ReturnType<typeof certifyWeights>;
  iterations: number;
}

/**
 * Simple grid-based weight optimization
 * In production, use more sophisticated optimization
 */
export function optimizeWeights(
  evaluator: (weights: Record<HorizonKey, number>) => ObjectiveInputs & { passRate: number },
  gridSize: number = 5
): WeightOptimizationResult {
  let bestWeights: Record<HorizonKey, number> = { 7: 0.15, 14: 0.25, 30: 0.30, 60: 0.30 };
  let bestScore = -Infinity;
  let bestCert: ReturnType<typeof certifyWeights> | null = null;
  let bestObj: ReturnType<typeof computeTailAwareObjective> | null = null;
  let iterations = 0;
  
  // Simple grid search (in production, use gradient-based or evolutionary)
  const steps = Array.from({ length: gridSize }, (_, i) => 0.1 + (i / gridSize) * 0.3);
  
  for (const w7 of steps) {
    for (const w14 of steps) {
      for (const w30 of steps) {
        const remaining = 1 - w7 - w14 - w30;
        if (remaining < 0.05 || remaining > 0.5) continue;
        
        const weights: Record<HorizonKey, number> = {
          7: w7,
          14: w14,
          30: w30,
          60: remaining,
        };
        
        iterations++;
        
        const inputs = evaluator(weights);
        const obj = computeTailAwareObjective(inputs);
        const cert = certifyWeights(inputs);
        
        // Prefer certified weights, then highest score
        const effectiveScore = cert.certified ? obj.score + 10 : obj.score;
        
        if (effectiveScore > bestScore) {
          bestScore = effectiveScore;
          bestWeights = weights;
          bestObj = obj;
          bestCert = cert;
        }
      }
    }
  }
  
  return {
    weights: bestWeights,
    objective: bestObj ?? computeTailAwareObjective({
      sharpe: 0, cagr: 0, p95dd: 0.5, worstdd: 0.6, dominance: 0.5, stability: 0.5, tradeCount: 0
    }),
    certification: bestCert ?? { certified: false, failures: ['NO_EVALUATION'], score: 0 },
    iterations,
  };
}
