/**
 * BLOCK 6.6 & 6.7 — Pattern Confidence & Guards
 * ===============================================
 * 
 * Computes final opportunity score with ML overlay and safety guards.
 */

import type {
  PatternStats,
  PatternWeight,
  ClusterPrediction,
} from './ml.types.js';
import { ML_GUARDS } from './ml.types.js';

// ═══════════════════════════════════════════════════════════════
// PATTERN CONFIDENCE CALCULATOR
// ═══════════════════════════════════════════════════════════════

export class PatternConfidenceService {
  private patternWeights: Map<string, PatternWeight> = new Map();
  private patternStats: Map<string, PatternStats> = new Map();

  /**
   * Calculate final opportunity score with ML overlay
   * 
   * FinalScore = OpportunityScore × ML_Prob_UP × PatternConfidence
   */
  calculateFinalScore(
    baseScore: number,
    mlPrediction: ClusterPrediction,
    patternId: string,
    direction: 'UP' | 'DOWN' | 'FLAT'
  ): {
    finalScore: number;
    mlBoost: number;
    patternConfidence: number;
    guards: { passed: boolean; reasons: string[] };
  } {
    const guards = this.checkGuards(mlPrediction, patternId);
    
    if (!guards.passed) {
      return {
        finalScore: baseScore * 0.5, // Penalize
        mlBoost: 0,
        patternConfidence: 0,
        guards,
      };
    }

    // Get ML probability for direction
    const mlProb = direction === 'UP' ? mlPrediction.probUP :
                   direction === 'DOWN' ? mlPrediction.probDOWN :
                   mlPrediction.probFLAT;

    // Pattern confidence from sample count
    const patternConfidence = this.getPatternConfidence(patternId);

    // Weight boost/penalty
    const weight = this.getPatternWeight(patternId);

    // Final calculation
    // FinalScore = Base × (0.7 + 0.3 × mlProb) × patternConfidence × weight
    const mlBoost = 0.7 + 0.3 * mlProb;
    const finalScore = baseScore * mlBoost * patternConfidence * weight;

    return {
      finalScore: Math.min(100, Math.max(0, finalScore)),
      mlBoost,
      patternConfidence,
      guards,
    };
  }

  /**
   * Get pattern confidence based on sample count
   * 
   * patternConfidence = min(1, log(samples_count + 1) / 3)
   */
  getPatternConfidence(patternId: string): number {
    const stats = this.patternStats.get(patternId);
    if (!stats) return 0.5; // Default for unknown patterns

    const samples = stats.totalSamples;
    return Math.min(1, Math.log(samples + 1) / 3);
  }

  /**
   * Get pattern weight (default 1.0)
   */
  getPatternWeight(patternId: string): number {
    const weight = this.patternWeights.get(patternId);
    if (!weight || weight.frozen) return 1.0;
    return weight.weight;
  }

  /**
   * Check ML guards
   */
  checkGuards(
    prediction: ClusterPrediction,
    patternId: string
  ): { passed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let passed = true;

    // Guard 1: Minimum ML confidence
    if (prediction.confidence < 0.3) {
      reasons.push('ML confidence too low');
      passed = false;
    }

    // Guard 2: Check if pattern has enough samples
    const stats = this.patternStats.get(patternId);
    if (stats && stats.totalSamples < ML_GUARDS.minSamplesPerCluster) {
      reasons.push(`Pattern needs ${ML_GUARDS.minSamplesPerCluster} samples, has ${stats.totalSamples}`);
      passed = false;
    }

    // Guard 3: Check pattern weight status
    const weight = this.patternWeights.get(patternId);
    if (weight?.frozen) {
      reasons.push(`Pattern frozen: ${weight.freezeReason}`);
      passed = false;
    }

    // Guard 4: Minimum probability threshold
    const maxProb = Math.max(prediction.probUP, prediction.probDOWN, prediction.probFLAT);
    if (maxProb < 0.4) {
      reasons.push('No clear direction from ML');
      passed = false;
    }

    return { passed, reasons };
  }

  // ═══════════════════════════════════════════════════════════════
  // PATTERN STATS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  updatePatternStats(stats: PatternStats): void {
    this.patternStats.set(stats.patternId, stats);
  }

  updatePatternWeight(weight: PatternWeight): void {
    this.patternWeights.set(weight.patternId, weight);
  }

  getPatternStats(patternId: string): PatternStats | undefined {
    return this.patternStats.get(patternId);
  }

  getAllPatternStats(): PatternStats[] {
    return Array.from(this.patternStats.values());
  }

  getAllPatternWeights(): PatternWeight[] {
    return Array.from(this.patternWeights.values());
  }

  /**
   * Freeze pattern if accuracy drops
   */
  freezePatternIfNeeded(
    patternId: string,
    currentAccuracy: number,
    historicalAccuracy: number
  ): boolean {
    const drop = historicalAccuracy - currentAccuracy;
    
    if (drop > ML_GUARDS.maxAccuracyDrop) {
      const weight = this.patternWeights.get(patternId) ?? {
        patternId,
        patternLabel: patternId,
        weight: 1.0,
        confidence: 0,
        byRegime: {},
        sampleCount: 0,
        frozen: false,
        lastUpdated: Date.now(),
      };
      
      weight.frozen = true;
      weight.freezeReason = `Accuracy drop: ${(drop * 100).toFixed(1)}%`;
      this.patternWeights.set(patternId, weight);
      
      console.log(`[PatternConfidence] Frozen pattern ${patternId}: accuracy dropped ${(drop * 100).toFixed(1)}%`);
      return true;
    }
    
    return false;
  }

  /**
   * Update weight based on performance
   */
  updateWeightFromPerformance(
    patternId: string,
    hitRate: number,
    avgReturn: number,
    baseline: number = 0.02
  ): void {
    const current = this.patternWeights.get(patternId);
    const oldWeight = current?.weight ?? 1.0;

    // delta = (hitRate - 0.5) × 0.8 + (avgReturn - baseline) × 0.5
    const delta = (hitRate - 0.5) * 0.8 + (avgReturn - baseline) * 0.5;
    
    // newWeight = clamp(oldWeight × (1 + delta), 0.5, 2.0)
    const newWeight = Math.max(0.5, Math.min(2.0, oldWeight * (1 + delta)));

    const updated: PatternWeight = {
      patternId,
      patternLabel: current?.patternLabel ?? patternId,
      weight: newWeight,
      confidence: Math.min(1, (hitRate - 0.5) * 2),
      byRegime: current?.byRegime ?? {},
      sampleCount: current?.sampleCount ?? 0,
      frozen: current?.frozen ?? false,
      lastUpdated: Date.now(),
    };

    this.patternWeights.set(patternId, updated);
    console.log(`[PatternConfidence] Updated weight for ${patternId}: ${oldWeight.toFixed(2)} → ${newWeight.toFixed(2)}`);
  }
}

export const patternConfidenceService = new PatternConfidenceService();

console.log('[Block6] Pattern Confidence Service loaded');
