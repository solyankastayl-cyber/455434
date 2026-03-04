/**
 * Phase AC1: Head & Shoulders Projector
 * 
 * Implements neckline break projection:
 * - Target = neckline break ± head-to-neckline distance
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

const HS_TYPES = ['HNS', 'IHNS', 'DOUBLE_TOP', 'DOUBLE_BOTTOM', 'TRIPLE_TOP', 'TRIPLE_BOTTOM'];

export class HeadShouldersProjector implements Projector {
  id = 'hs_projector';
  name = 'Head & Shoulders / Double/Triple Projector';
  supportedPatterns = HS_TYPES;

  project(pattern: PatternLayer, context: ProjectorContext): Projection | null {
    if (!HS_TYPES.includes(pattern.patternType)) {
      return null;
    }

    const prior = getPatternPrior(pattern.patternType);
    if (!prior) return null;

    const { points, zones } = pattern;
    if (!points || points.length < 3) return null;

    // Determine if bullish or bearish
    const isBullish = ['IHNS', 'DOUBLE_BOTTOM', 'TRIPLE_BOTTOM'].includes(pattern.patternType);
    
    // Calculate pattern height
    const prices = points.map(p => p.y);
    const patternHeight = Math.max(...prices) - Math.min(...prices);
    
    // Neckline level
    const neckline = isBullish ? Math.max(...prices) : Math.min(...prices);
    
    // Target using measured move from neckline
    const target = isBullish 
      ? neckline + patternHeight
      : neckline - patternHeight;

    // Extended target
    const target2 = isBullish
      ? neckline + patternHeight * 1.618
      : neckline - patternHeight * 1.618;

    // Stop beyond pattern extreme
    const stop = isBullish
      ? Math.min(...prices) - context.atr * 0.3
      : Math.max(...prices) + context.atr * 0.3;

    const entry = neckline;
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    // Build path - H&S patterns are slower
    const durationBars = prior.avgDurationBars;
    const path = this.buildPath(context.currentPrice, target, durationBars, prior.baseProbability, isBullish);
    const bands = this.buildBands(path, context.atr * 0.6);

    const probability = this.calculateProbability(prior.baseProbability, pattern.score, riskReward, context);

    return {
      id: uuid(),
      kind: 'NECKLINE_BREAK',
      direction: isBullish ? 'BULLISH' : 'BEARISH',
      path,
      bands,
      entry,
      target,
      target2,
      stop,
      riskReward,
      probability,
      rationale: this.buildRationale(pattern, patternHeight, neckline, target, context),
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
    
    // H&S patterns often have retest before continuation
    for (let t = 0; t <= durationBars; t++) {
      const progress = t / durationBars;
      
      let eased: number;
      // Add retest dip/spike in first third
      if (progress < 0.2) {
        // Initial move
        eased = progress * 2.5;
      } else if (progress < 0.35) {
        // Retest phase - slight pullback
        const retestProgress = (progress - 0.2) / 0.15;
        eased = 0.5 - 0.15 * retestProgress;
      } else {
        // Main move
        const mainProgress = (progress - 0.35) / 0.65;
        eased = 0.35 + 0.65 * (1 - Math.pow(1 - mainProgress, 2));
      }
      
      const price = currentPrice + priceMove * eased;
      const prob = baseProbability * (1 - progress * 0.2);
      
      path.push({ t, price, probability: Math.max(0.4, prob) });
    }
    
    return path;
  }

  private buildBands(path: ProjectionPath, bandwidth: number): { low: number[]; high: number[] } {
    return {
      low: path.map((p, i) => p.price - bandwidth * (1 + i / path.length * 0.4)),
      high: path.map((p, i) => p.price + bandwidth * (1 + i / path.length * 0.4))
    };
  }

  private calculateProbability(
    baseProbability: number,
    patternScore: number,
    riskReward: number,
    context: ProjectorContext
  ): number {
    let prob = baseProbability;
    
    // H&S are high-probability patterns
    prob *= 0.8 + patternScore * 0.2;
    
    if (riskReward >= 2) prob *= 1.08;
    else if (riskReward >= 1.5) prob *= 1.04;
    else if (riskReward < 1) prob *= 0.88;
    
    return Math.min(0.85, Math.max(0.45, prob));
  }

  private buildRationale(
    pattern: PatternLayer,
    height: number,
    neckline: number,
    target: number,
    context: ProjectorContext
  ): string[] {
    const reasons: string[] = [];
    
    const patternNames: Record<string, string> = {
      'HNS': 'Head & Shoulders',
      'IHNS': 'Inverse Head & Shoulders',
      'DOUBLE_TOP': 'Double Top',
      'DOUBLE_BOTTOM': 'Double Bottom',
      'TRIPLE_TOP': 'Triple Top',
      'TRIPLE_BOTTOM': 'Triple Bottom'
    };
    
    reasons.push(`${patternNames[pattern.patternType] || pattern.patternType} detected`);
    reasons.push(`Neckline at ${neckline.toFixed(2)}`);
    reasons.push(`Pattern height: ${height.toFixed(2)} (${(height / context.atr).toFixed(1)} ATR)`);
    reasons.push(`Measured move target: ${target.toFixed(2)}`);
    reasons.push(`High-probability reversal pattern`);
    
    return reasons;
  }
}

export const hsShouldersProjector = new HeadShouldersProjector();
