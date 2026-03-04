/**
 * Phase AC1: Channel Projector
 * 
 * Implements channel continuation/breakout projections:
 * - Bounce targets at opposite channel boundary
 * - Breakout targets using channel width
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

const CHANNEL_TYPES = ['CHANNEL_UP', 'CHANNEL_DOWN', 'CHANNEL_HORIZONTAL'];

export class ChannelProjector implements Projector {
  id = 'channel_projector';
  name = 'Channel Projector';
  supportedPatterns = CHANNEL_TYPES;

  project(pattern: PatternLayer, context: ProjectorContext): Projection | null {
    if (!CHANNEL_TYPES.includes(pattern.patternType)) {
      return null;
    }

    const prior = getPatternPrior(pattern.patternType);
    if (!prior) return null;

    const { lines, zones } = pattern;
    
    // Extract channel boundaries
    let upperBoundary: number;
    let lowerBoundary: number;
    
    if (zones && zones.length >= 2) {
      upperBoundary = Math.max(...zones.map(z => z.price));
      lowerBoundary = Math.min(...zones.map(z => z.price));
    } else if (lines && lines.length >= 2) {
      const yValues = lines.flatMap(l => [l.y1, l.y2]);
      upperBoundary = Math.max(...yValues);
      lowerBoundary = Math.min(...yValues);
    } else {
      return null;
    }

    const channelWidth = upperBoundary - lowerBoundary;
    const midChannel = (upperBoundary + lowerBoundary) / 2;
    
    // Determine if near upper or lower boundary
    const distToUpper = Math.abs(context.currentPrice - upperBoundary);
    const distToLower = Math.abs(context.currentPrice - lowerBoundary);
    
    const nearUpper = distToUpper < distToLower;
    const isBullish = pattern.patternType === 'CHANNEL_UP' || 
                      (pattern.patternType === 'CHANNEL_HORIZONTAL' && !nearUpper);

    // Target: opposite boundary for bounce, channel width beyond for breakout
    const bounceTarget = nearUpper ? lowerBoundary : upperBoundary;
    const breakoutTarget = isBullish 
      ? upperBoundary + channelWidth
      : lowerBoundary - channelWidth;

    // Use bounce as primary target in channel
    const target = Math.abs(context.currentPrice - bounceTarget) > context.atr * 0.5 
      ? bounceTarget 
      : breakoutTarget;

    const target2 = breakoutTarget;

    const entry = context.currentPrice;
    const stop = nearUpper
      ? upperBoundary + context.atr * 0.3
      : lowerBoundary - context.atr * 0.3;

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const riskReward = risk > 0 ? reward / risk : 0;

    const durationBars = prior.avgDurationBars;
    const path = this.buildPath(entry, target, durationBars, prior.baseProbability, isBullish);
    const bands = this.buildBands(path, context.atr * 0.4);

    const probability = this.calculateProbability(prior.baseProbability, pattern.score, riskReward, context);

    return {
      id: uuid(),
      kind: 'CHANNEL_TARGET',
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
        `${pattern.patternType} detected`,
        `Channel width: ${channelWidth.toFixed(2)} (${(channelWidth / context.atr).toFixed(1)} ATR)`,
        `Upper boundary: ${upperBoundary.toFixed(2)}`,
        `Lower boundary: ${lowerBoundary.toFixed(2)}`,
        nearUpper ? 'Near upper boundary - expecting pullback' : 'Near lower boundary - expecting bounce',
        `Primary target: ${target.toFixed(2)}`
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
    
    // Channels have oscillating character
    for (let t = 0; t <= durationBars; t++) {
      const progress = t / durationBars;
      // Linear movement within channel
      const eased = progress;
      
      const price = currentPrice + priceMove * eased;
      const prob = baseProbability * (1 - progress * 0.15);
      
      path.push({ t, price, probability: Math.max(0.4, prob) });
    }
    
    return path;
  }

  private buildBands(path: ProjectionPath, bandwidth: number): { low: number[]; high: number[] } {
    return {
      low: path.map((p, i) => p.price - bandwidth * (1 + i / path.length * 0.2)),
      high: path.map((p, i) => p.price + bandwidth * (1 + i / path.length * 0.2))
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
    
    if (riskReward >= 1.5) prob *= 1.05;
    else if (riskReward < 0.8) prob *= 0.88;
    
    return Math.min(0.75, Math.max(0.4, prob));
  }
}

export const channelProjector = new ChannelProjector();
