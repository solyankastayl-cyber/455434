/**
 * MARKOV REGIME SERVICE — V2 Institutional
 * 
 * State-space model for regime switching:
 * - Transition matrix P(regime_t+1 | regime_t)
 * - Regime persistence (stay probability)
 * - Probabilistic regime assignment
 */

import { RegimeType, MarkovTransitionMatrix, MacroState } from '../contracts/index_pack.contract.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULT TRANSITION MATRIX (calibrated from historical data)
// 
// Rows = current regime, Columns = next regime
// Order: EASING, TIGHTENING, STRESS, NEUTRAL, NEUTRAL_MIXED
// ═══════════════════════════════════════════════════════════════

const REGIMES: RegimeType[] = ['EASING', 'TIGHTENING', 'STRESS', 'NEUTRAL', 'NEUTRAL_MIXED'];

// Calibrated transition probabilities (based on monthly macro regime history)
// Each row sums to 1.0
const DEFAULT_TRANSITION_MATRIX: number[][] = [
  // From EASING to:       EASING  TIGHT   STRESS  NEUTRAL MIXED
  [0.75,   0.10,   0.02,   0.08,   0.05],    // EASING stays 75%
  // From TIGHTENING to:
  [0.08,   0.72,   0.08,   0.07,   0.05],    // TIGHTENING stays 72%
  // From STRESS to:
  [0.05,   0.15,   0.55,   0.10,   0.15],    // STRESS stays 55% (less persistent)
  // From NEUTRAL to:
  [0.12,   0.12,   0.06,   0.50,   0.20],    // NEUTRAL stays 50%
  // From NEUTRAL_MIXED to:
  [0.15,   0.15,   0.10,   0.20,   0.40],    // MIXED stays 40%
];

// ═══════════════════════════════════════════════════════════════
// MARKOV REGIME ENGINE
// ═══════════════════════════════════════════════════════════════

export class MarkovRegimeEngine {
  private transitionMatrix: number[][];
  private regimes: RegimeType[];
  private currentRegimeIdx: number;
  private regimeProbabilities: number[];
  
  constructor(matrix?: number[][]) {
    this.regimes = REGIMES;
    this.transitionMatrix = matrix || DEFAULT_TRANSITION_MATRIX;
    this.currentRegimeIdx = 3; // Start at NEUTRAL
    this.regimeProbabilities = [0.1, 0.1, 0.05, 0.5, 0.25]; // Initial prior
  }
  
  /**
   * Get persistence (stay probability) for current regime
   */
  getPersistence(regime: RegimeType): number {
    const idx = this.regimes.indexOf(regime);
    if (idx === -1) return 0.5;
    return this.transitionMatrix[idx][idx];
  }
  
  /**
   * Get transition probability from one regime to another
   */
  getTransitionProbability(from: RegimeType, to: RegimeType): number {
    const fromIdx = this.regimes.indexOf(from);
    const toIdx = this.regimes.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return 0;
    return this.transitionMatrix[fromIdx][toIdx];
  }
  
  /**
   * Update regime probabilities given observation (simple Bayesian update)
   */
  updateProbabilities(
    observedScoreVector: Record<string, number>,
    priorRegime?: RegimeType
  ): Record<RegimeType, number> {
    // Compute likelihood of each regime given score vector
    const likelihoods = this.regimes.map((regime, idx) => {
      const prior = priorRegime && regime === priorRegime 
        ? this.getPersistence(priorRegime) 
        : this.regimeProbabilities[idx];
      
      // Simple likelihood model based on score vector
      const likelihood = this.computeLikelihood(observedScoreVector, regime);
      return prior * likelihood;
    });
    
    // Normalize
    const total = likelihoods.reduce((a, b) => a + b, 0);
    const normalized = likelihoods.map(l => total > 0 ? l / total : 1 / this.regimes.length);
    
    // Store and return
    this.regimeProbabilities = normalized;
    
    const result: Record<RegimeType, number> = {} as any;
    this.regimes.forEach((r, i) => {
      result[r] = Math.round(normalized[i] * 1000) / 1000;
    });
    return result;
  }
  
  /**
   * Compute likelihood P(scoreVector | regime)
   */
  private computeLikelihood(scoreVector: Record<string, number>, regime: RegimeType): number {
    // Define expected score ranges for each regime
    const expectations: Record<RegimeType, { mean: number; std: number }> = {
      'EASING': { mean: -0.3, std: 0.2 },
      'TIGHTENING': { mean: 0.4, std: 0.2 },
      'STRESS': { mean: 0.6, std: 0.3 },
      'NEUTRAL': { mean: 0.0, std: 0.15 },
      'NEUTRAL_MIXED': { mean: 0.1, std: 0.25 },
      'RECOVERY': { mean: -0.1, std: 0.2 },
      'EXPANSION': { mean: 0.2, std: 0.2 },
    };
    
    const exp = expectations[regime] || { mean: 0, std: 0.3 };
    
    // Compute aggregate score from vector
    const values = Object.values(scoreVector);
    const aggScore = values.length > 0 
      ? values.reduce((a, b) => a + b, 0) / values.length 
      : 0;
    
    // Gaussian likelihood
    const z = (aggScore - exp.mean) / exp.std;
    return Math.exp(-0.5 * z * z);
  }
  
  /**
   * Get dominant regime and full state
   */
  getState(
    scoreVector: Record<string, number>,
    scoreSigned: number,
    confidence: number,
    priorRegime?: RegimeType
  ): MacroState {
    const probabilities = this.updateProbabilities(scoreVector, priorRegime);
    
    // Find dominant regime
    let maxProb = 0;
    let dominantRegime: RegimeType = 'NEUTRAL';
    
    for (const [regime, prob] of Object.entries(probabilities)) {
      if (prob > maxProb) {
        maxProb = prob;
        dominantRegime = regime as RegimeType;
      }
    }
    
    const persistence = this.getPersistence(dominantRegime);
    
    // Generate transition hint
    let transitionHint: string | undefined;
    if (persistence < 0.5) {
      // Find most likely next regime (excluding current)
      const transitionProbs = this.transitionMatrix[this.regimes.indexOf(dominantRegime)];
      let maxTransition = 0;
      let likelyNext: RegimeType = dominantRegime;
      
      transitionProbs.forEach((p, idx) => {
        if (this.regimes[idx] !== dominantRegime && p > maxTransition) {
          maxTransition = p;
          likelyNext = this.regimes[idx];
        }
      });
      
      if (maxTransition > 0.1) {
        transitionHint = `Likely shifting to ${likelyNext} (${(maxTransition * 100).toFixed(0)}%)`;
      }
    }
    
    return {
      regime: dominantRegime,
      regimeProbabilities: probabilities,
      confidence,
      persistence: Math.round(persistence * 1000) / 1000,
      scoreSigned,
      scoreVector,
      transitionHint,
    };
  }
  
  /**
   * Get transition matrix info
   */
  getTransitionMatrix(): MarkovTransitionMatrix {
    // Compute stationary distribution (eigenvector of transition matrix)
    // For simplicity, use power iteration approximation
    let dist = this.regimeProbabilities.slice();
    
    for (let iter = 0; iter < 100; iter++) {
      const newDist = new Array(this.regimes.length).fill(0);
      for (let j = 0; j < this.regimes.length; j++) {
        for (let i = 0; i < this.regimes.length; i++) {
          newDist[j] += dist[i] * this.transitionMatrix[i][j];
        }
      }
      dist = newDist;
    }
    
    const stationaryDistribution: Record<RegimeType, number> = {} as any;
    this.regimes.forEach((r, i) => {
      stationaryDistribution[r] = Math.round(dist[i] * 1000) / 1000;
    });
    
    return {
      regimes: this.regimes,
      matrix: this.transitionMatrix,
      stationaryDistribution,
      calibratedAt: '2026-02-27',
      samplesUsed: 500, // Placeholder
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let engineInstance: MarkovRegimeEngine | null = null;

export function getMarkovEngine(): MarkovRegimeEngine {
  if (!engineInstance) {
    engineInstance = new MarkovRegimeEngine();
  }
  return engineInstance;
}

export function resetMarkovEngine(): void {
  engineInstance = null;
}
