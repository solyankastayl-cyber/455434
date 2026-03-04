/**
 * Phase AC1: Triangle/Wedge Projector
 * 
 * Implements classical measured move projection:
 * - Target = breakout ± triangle height
 * - Path built with ATR-based speed
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

const TRIANGLE_TYPES = [
  'TRIANGLE_ASC',
  'TRIANGLE_DESC', 
  'TRIANGLE_SYM',
  'WEDGE_RISING',
  'WEDGE_FALLING'
];

export class TriangleProjector implements Projector {
  id = 'triangle_projector';
  name = 'Triangle/Wedge Projector';
  supportedPatterns = TRIANGLE_TYPES;

  project(pattern: PatternLayer, context: ProjectorContext): Projection | null {
    if (!TRIANGLE_TYPES.includes(pattern.patternType)) {
      return null;
    }

    const prior = getPatternPrior(pattern.patternType);
    if (!prior) return null;

    // Extract geometry from pattern
    const { points, lines } = pattern;
    if (!points || points.length < 3) return null;

    // Calculate triangle height (max - min of points)
    const prices = points.map(p => p.y);
    const triangleHeight = Math.max(...prices) - Math.min(...prices);
    
    // Determine breakout direction
    const isBullish = pattern.direction === 'BULLISH';
    const breakoutPrice = isBullish 
      ? Math.max(...prices)  // upside breakout
      : Math.min(...prices); // downside breakout

    // Calculate target using measured move
    const targetDistance = triangleHeight;
    const target = isBullish 
      ? breakoutPrice + targetDistance
      : breakoutPrice - targetDistance;

    // Extended target (1.618 extension)
    const target2 = isBullish
      ? breakoutPrice + targetDistance * 1.618
      : breakoutPrice - targetDistance * 1.618;

    // Stop loss at opposite side of triangle
    const stop = isBullish
      ? Math.min(...prices) - context.atr * 0.3
      : Math.max(...prices) + context.atr * 0.3;

    // Entry at breakout level
    const entry = breakoutPrice;

    // Risk reward
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    // Build projection path
    const durationBars = prior.avgDurationBars;
    const path = this.buildPath(
      context.currentPrice,
      target,
      durationBars,
      prior.baseProbability,
      isBullish
    );

    // Build confidence bands (±0.5 ATR)
    const bands = this.buildBands(path, context.atr * 0.5);

    // Calculate final probability
    const probability = this.calculateProbability(
      prior.baseProbability,
      pattern.score,
      riskReward,
      context
    );

    return {
      id: uuid(),
      kind: 'MEASURED_MOVE',
      direction: isBullish ? 'BULLISH' : 'BEARISH',
      path,
      bands,
      entry,
      target,
      target2,
      stop,
      riskReward,
      probability,
      rationale: this.buildRationale(pattern, triangleHeight, target, context),
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
    
    // Use ease-out curve for natural price movement
    for (let t = 0; t <= durationBars; t++) {
      const progress = t / durationBars;
      // Ease-out: fast start, slow finish
      const eased = 1 - Math.pow(1 - progress, 2);
      
      const price = currentPrice + priceMove * eased;
      // Probability decreases over time
      const prob = baseProbability * (1 - progress * 0.3);
      
      path.push({ t, price, probability: Math.max(0.3, prob) });
    }
    
    return path;
  }

  private buildBands(path: ProjectionPath, bandwidth: number): { low: number[]; high: number[] } {
    const low: number[] = [];
    const high: number[] = [];
    
    for (let i = 0; i < path.length; i++) {
      // Bands widen over time
      const widthFactor = 1 + (i / path.length) * 0.5;
      const width = bandwidth * widthFactor;
      
      low.push(path[i].price - width);
      high.push(path[i].price + width);
    }
    
    return { low, high };
  }

  private calculateProbability(
    baseProbability: number,
    patternScore: number,
    riskReward: number,
    context: ProjectorContext
  ): number {
    let prob = baseProbability;
    
    // Pattern quality factor
    prob *= 0.7 + patternScore * 0.3;
    
    // Risk/reward factor
    if (riskReward >= 2) prob *= 1.1;
    else if (riskReward >= 1.5) prob *= 1.05;
    else if (riskReward < 1) prob *= 0.85;
    
    // Regime alignment
    if (context.regime === 'TREND_UP' && this.supportedPatterns.some(p => p.includes('ASC') || p.includes('FALLING'))) {
      prob *= 1.05;
    } else if (context.regime === 'TREND_DOWN' && this.supportedPatterns.some(p => p.includes('DESC') || p.includes('RISING'))) {
      prob *= 1.05;
    }
    
    return Math.min(0.85, Math.max(0.35, prob));
  }

  private buildRationale(
    pattern: PatternLayer,
    height: number,
    target: number,
    context: ProjectorContext
  ): string[] {
    const reasons: string[] = [];
    
    reasons.push(`${pattern.patternType} detected with score ${(pattern.score * 100).toFixed(0)}%`);
    reasons.push(`Measured move: ${pattern.direction === 'BULLISH' ? 'height added to breakout' : 'height subtracted from breakdown'}`);
    reasons.push(`Triangle height: ${height.toFixed(2)} (${(height / context.atr).toFixed(1)} ATR)`);
    reasons.push(`Target: ${target.toFixed(2)}`);
    
    if (context.regime) {
      reasons.push(`Market regime: ${context.regime}`);
    }
    
    return reasons;
  }
}

export const triangleProjector = new TriangleProjector();
