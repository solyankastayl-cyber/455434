/**
 * Phase AC1: Harmonic Pattern Projector
 * 
 * Implements D-point reversal projection:
 * - Target at C level (BC retrace)
 * - Extended target at A level
 */

import { 
  Projector, 
  ProjectorContext, 
  Projection, 
  PatternLayer,
  ProjectionPath,
  getPatternPrior
} from '../projection_types.js';
import { v4 as uuid } from 'uuid';

const HARMONIC_TYPES = [
  'HARMONIC_GARTLEY_BULL', 'HARMONIC_GARTLEY_BEAR',
  'HARMONIC_BAT_BULL', 'HARMONIC_BAT_BEAR',
  'HARMONIC_BUTTERFLY_BULL', 'HARMONIC_BUTTERFLY_BEAR',
  'HARMONIC_CRAB_BULL', 'HARMONIC_CRAB_BEAR',
  'HARMONIC_SHARK_BULL', 'HARMONIC_SHARK_BEAR',
  'HARMONIC_ABCD_BULL', 'HARMONIC_ABCD_BEAR',
  'HARMONIC_THREE_DRIVES_BULL', 'HARMONIC_THREE_DRIVES_BEAR'
];

export class HarmonicProjector implements Projector {
  id = 'harmonic_projector';
  name = 'Harmonic Pattern Projector';
  supportedPatterns = HARMONIC_TYPES;

  project(pattern: PatternLayer, context: ProjectorContext): Projection | null {
    if (!HARMONIC_TYPES.includes(pattern.patternType)) {
      return null;
    }

    const prior = getPatternPrior(pattern.patternType);
    if (!prior) return null;

    const { points } = pattern;
    if (!points || points.length < 4) return null;

    // Harmonic patterns: A, B, C, D points
    // D is the completion/entry point
    const isBullish = pattern.patternType.endsWith('_BULL');
    
    // Sort points to get ABCD structure
    const sortedByX = [...points].sort((a, b) => a.x - b.x);
    const A = sortedByX[0];
    const B = sortedByX[1];
    const C = sortedByX[2];
    const D = sortedByX[3];

    if (!A || !B || !C || !D) return null;

    // Entry at D point
    const entry = D.y;
    
    // First target at C level (BC retrace)
    const target = C.y;
    
    // Extended target at A level
    const target2 = A.y;

    // Stop beyond D
    const adRange = Math.abs(A.y - D.y);
    const stop = isBullish
      ? D.y - adRange * 0.236 // 23.6% beyond D
      : D.y + adRange * 0.236;

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    // Build path
    const durationBars = prior.avgDurationBars;
    const path = this.buildPath(context.currentPrice, target, durationBars, prior.baseProbability, isBullish);
    const bands = this.buildBands(path, context.atr * 0.5);

    const probability = this.calculateProbability(prior.baseProbability, pattern.score, riskReward, context);

    return {
      id: uuid(),
      kind: 'HARMONIC_REVERSAL',
      direction: isBullish ? 'BULLISH' : 'BEARISH',
      path,
      bands,
      entry,
      target,
      target2,
      stop,
      riskReward,
      probability,
      rationale: this.buildRationale(pattern, A, B, C, D, context),
      sourcePatterns: [pattern.id]
    };
  }

  private buildPath(
    currentPrice: number,
    target: number,
    durationBars: number,
    baseProbability: number,
    isBullish: boolean
  ): ProjectionPath {
    const path: ProjectionPath = [];
    const priceMove = target - currentPrice;
    
    // Harmonics often have quick initial move then consolidation
    for (let t = 0; t <= durationBars; t++) {
      const progress = t / durationBars;
      
      // Two-phase move: quick impulse then slower continuation
      let eased: number;
      if (progress < 0.4) {
        // Fast initial move (60% of distance in 40% of time)
        eased = progress / 0.4 * 0.6;
      } else {
        // Slower continuation
        const remainingProgress = (progress - 0.4) / 0.6;
        eased = 0.6 + 0.4 * (1 - Math.pow(1 - remainingProgress, 2));
      }
      
      const price = currentPrice + priceMove * eased;
      const prob = baseProbability * (1 - progress * 0.22);
      
      path.push({ t, price, probability: Math.max(0.38, prob) });
    }
    
    return path;
  }

  private buildBands(path: ProjectionPath, bandwidth: number): { low: number[]; high: number[] } {
    return {
      low: path.map((p, i) => p.price - bandwidth * (1 + i / path.length * 0.35)),
      high: path.map((p, i) => p.price + bandwidth * (1 + i / path.length * 0.35))
    };
  }

  private calculateProbability(
    baseProbability: number,
    patternScore: number,
    riskReward: number,
    context: ProjectorContext
  ): number {
    let prob = baseProbability;
    
    prob *= 0.7 + patternScore * 0.3;
    
    // Harmonics with good R:R are more reliable
    if (riskReward >= 3) prob *= 1.15;
    else if (riskReward >= 2) prob *= 1.08;
    else if (riskReward < 1.5) prob *= 0.85;
    
    return Math.min(0.78, Math.max(0.35, prob));
  }

  private buildRationale(
    pattern: PatternLayer,
    A: { x: number; y: number; label?: string },
    B: { x: number; y: number; label?: string },
    C: { x: number; y: number; label?: string },
    D: { x: number; y: number; label?: string },
    context: ProjectorContext
  ): string[] {
    const patternName = pattern.patternType
      .replace('HARMONIC_', '')
      .replace('_BULL', ' (Bullish)')
      .replace('_BEAR', ' (Bearish)');
    
    return [
      `${patternName} pattern completed at D`,
      `Entry zone: ${D.y.toFixed(2)}`,
      `Target 1 (C level): ${C.y.toFixed(2)}`,
      `Target 2 (A level): ${A.y.toFixed(2)}`,
      `Harmonic ratios validated`
    ];
  }
}

export const harmonicProjector = new HarmonicProjector();
