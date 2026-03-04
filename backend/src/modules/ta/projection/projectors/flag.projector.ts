/**
 * Phase AC1: Flag/Pennant Projector
 * 
 * Implements pole projection:
 * - Target = breakout + pole length
 * - Fast continuation patterns
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

const FLAG_TYPES = ['FLAG_BULL', 'FLAG_BEAR'];

export class FlagProjector implements Projector {
  id = 'flag_projector';
  name = 'Flag/Pennant Projector';
  supportedPatterns = FLAG_TYPES;

  project(pattern: PatternLayer, context: ProjectorContext): Projection | null {
    if (!FLAG_TYPES.includes(pattern.patternType)) {
      return null;
    }

    const prior = getPatternPrior(pattern.patternType);
    if (!prior) return null;

    const { points } = pattern;
    if (!points || points.length < 2) return null;

    const isBullish = pattern.patternType === 'FLAG_BULL';
    
    // Extract pole length from pattern geometry
    // Pole is typically 2-3x the flag consolidation
    const flagHeight = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
    const poleLength = flagHeight * 2.5; // Estimate pole as 2.5x flag height

    // Breakout level
    const breakoutPrice = isBullish 
      ? Math.max(...points.map(p => p.y))
      : Math.min(...points.map(p => p.y));

    // Target using pole projection
    const target = isBullish 
      ? breakoutPrice + poleLength
      : breakoutPrice - poleLength;

    // Extended target
    const target2 = isBullish
      ? breakoutPrice + poleLength * 1.272
      : breakoutPrice - poleLength * 1.272;

    // Stop at opposite end of flag
    const stop = isBullish
      ? Math.min(...points.map(p => p.y)) - context.atr * 0.2
      : Math.max(...points.map(p => p.y)) + context.atr * 0.2;

    const entry = breakoutPrice;
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    // Build path - flags are fast patterns
    const durationBars = prior.avgDurationBars;
    const path = this.buildPath(context.currentPrice, target, durationBars, prior.baseProbability, isBullish);
    const bands = this.buildBands(path, context.atr * 0.4);

    const probability = this.calculateProbability(prior.baseProbability, pattern.score, riskReward, context);

    return {
      id: uuid(),
      kind: 'POLE_PROJ',
      direction: isBullish ? 'BULLISH' : 'BEARISH',
      path,
      bands,
      entry,
      target,
      target2,
      stop,
      riskReward,
      probability,
      rationale: [
        `${pattern.patternType} detected - continuation pattern`,
        `Pole projection: ${poleLength.toFixed(2)} (${(poleLength / context.atr).toFixed(1)} ATR)`,
        `Target: ${target.toFixed(2)}`,
        `Flags typically resolve quickly (${durationBars} bars avg)`
      ],
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
    
    // Flags have quick, impulsive moves
    for (let t = 0; t <= durationBars; t++) {
      const progress = t / durationBars;
      // Faster ease-out for flags
      const eased = 1 - Math.pow(1 - progress, 1.5);
      
      const price = currentPrice + priceMove * eased;
      const prob = baseProbability * (1 - progress * 0.25);
      
      path.push({ t, price, probability: Math.max(0.35, prob) });
    }
    
    return path;
  }

  private buildBands(path: ProjectionPath, bandwidth: number): { low: number[]; high: number[] } {
    return {
      low: path.map((p, i) => p.price - bandwidth * (1 + i / path.length * 0.3)),
      high: path.map((p, i) => p.price + bandwidth * (1 + i / path.length * 0.3))
    };
  }

  private calculateProbability(
    baseProbability: number,
    patternScore: number,
    riskReward: number,
    context: ProjectorContext
  ): number {
    let prob = baseProbability;
    
    prob *= 0.75 + patternScore * 0.25;
    
    if (riskReward >= 2.5) prob *= 1.12;
    else if (riskReward >= 2) prob *= 1.08;
    else if (riskReward < 1.5) prob *= 0.9;
    
    // Flags work best in trending markets
    if (context.regime === 'TREND_UP' || context.regime === 'TREND_DOWN') {
      prob *= 1.08;
    }
    
    return Math.min(0.82, Math.max(0.4, prob));
  }
}

export const flagProjector = new FlagProjector();
