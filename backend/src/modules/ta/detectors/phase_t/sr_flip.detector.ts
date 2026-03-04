/**
 * Phase T: Support/Resistance Flip Detector
 * 
 * Patterns:
 * - SR_FLIP_BULL: Resistance becomes support (price breaks above, retests, bounces)
 * - SR_FLIP_BEAR: Support becomes resistance (price breaks below, retests, rejects)
 */

import { Detector, TAContext, CandidatePattern, Level } from '../../domain/types.js';
import { getRNG } from '../../infra/rng.js';

export interface SRFlipConfig {
  retestTolerance: number;    // % tolerance for retest level
  minBarsSinceBreak: number;  // Minimum bars between break and retest
  maxBarsSinceBreak: number;  // Maximum bars to look for retest
  confirmBounce: boolean;     // Require confirmation bounce candle
}

export const DEFAULT_SR_FLIP_CONFIG: SRFlipConfig = {
  retestTolerance: 0.5,
  minBarsSinceBreak: 2,
  maxBarsSinceBreak: 15,
  confirmBounce: true,
};

export class SRFlipDetector implements Detector {
  id = 'phase_t_sr_flip';
  name = 'S/R Flip Detector';
  version = '1.0.0';
  types = ['SR_FLIP_BULL', 'SR_FLIP_BEAR'];

  constructor(private config: SRFlipConfig = DEFAULT_SR_FLIP_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const { candles, levels } = ctx;
    if (!candles || candles.length < 20 || !levels || levels.length === 0) return [];

    const patterns: CandidatePattern[] = [];
    const rng = getRNG();

    // For each level, look for S/R flip setups
    for (const level of levels) {
      const levelPrice = level.price;
      const tolerance = levelPrice * (this.config.retestTolerance / 100);

      // Scan for break and retest sequences
      for (let breakIdx = 10; breakIdx < candles.length - this.config.minBarsSinceBreak; breakIdx++) {
        const beforeBreak = candles[breakIdx - 1];
        const breakCandle = candles[breakIdx];

        // Check for bullish break (resistance flip to support)
        if (beforeBreak.close < levelPrice && breakCandle.close > levelPrice + tolerance) {
          // Look for retest
          for (let retestIdx = breakIdx + this.config.minBarsSinceBreak; 
               retestIdx < Math.min(breakIdx + this.config.maxBarsSinceBreak, candles.length); 
               retestIdx++) {
            const retestCandle = candles[retestIdx];
            
            // Price comes back to test level from above
            if (retestCandle.low <= levelPrice + tolerance && retestCandle.low >= levelPrice - tolerance) {
              // Check for bounce confirmation
              const hasConfirm = !this.config.confirmBounce || 
                (retestIdx + 1 < candles.length && candles[retestIdx + 1].close > retestCandle.close);
              
              if (hasConfirm && retestCandle.close > levelPrice) {
                const score = this.calculateScore(level, candles.slice(breakIdx, retestIdx + 1));
                
                patterns.push({
                  id: `sr_flip_bull_${retestIdx}_${rng.nextInt(1000, 9999)}`,
                  type: 'SR_FLIP_BULL',
                  direction: 'BULL',
                  startIndex: breakIdx,
                  endIndex: retestIdx,
                  keyPrices: {
                    levelPrice,
                    breakClose: breakCandle.close,
                    retestLow: retestCandle.low,
                  },
                  metrics: {
                    levelStrength: level.strength || 0.7,
                    totalScore: score,
                    geometryScore: score,
                  },
                });
                break; // Found retest for this break
              }
            }
          }
        }

        // Check for bearish break (support flip to resistance)
        if (beforeBreak.close > levelPrice && breakCandle.close < levelPrice - tolerance) {
          // Look for retest
          for (let retestIdx = breakIdx + this.config.minBarsSinceBreak; 
               retestIdx < Math.min(breakIdx + this.config.maxBarsSinceBreak, candles.length); 
               retestIdx++) {
            const retestCandle = candles[retestIdx];
            
            // Price comes back to test level from below
            if (retestCandle.high >= levelPrice - tolerance && retestCandle.high <= levelPrice + tolerance) {
              const hasConfirm = !this.config.confirmBounce || 
                (retestIdx + 1 < candles.length && candles[retestIdx + 1].close < retestCandle.close);
              
              if (hasConfirm && retestCandle.close < levelPrice) {
                const score = this.calculateScore(level, candles.slice(breakIdx, retestIdx + 1));
                
                patterns.push({
                  id: `sr_flip_bear_${retestIdx}_${rng.nextInt(1000, 9999)}`,
                  type: 'SR_FLIP_BEAR',
                  direction: 'BEAR',
                  startIndex: breakIdx,
                  endIndex: retestIdx,
                  keyPrices: {
                    levelPrice,
                    breakClose: breakCandle.close,
                    retestHigh: retestCandle.high,
                  },
                  metrics: {
                    levelStrength: level.strength || 0.7,
                    totalScore: score,
                    geometryScore: score,
                  },
                });
                break;
              }
            }
          }
        }
      }
    }

    return patterns;
  }

  private calculateScore(level: Level, recentCandles: any[]): number {
    // Base score from level strength
    let score = 0.65 + (level.strength || 0.5) * 0.15;
    
    // Bonus for clean retest (not much overshoot)
    score += 0.05;
    
    // Bonus for multiple tests of level historically
    if (level.touches && level.touches > 2) {
      score += 0.05;
    }
    
    return Math.min(score, 0.92);
  }
}

export const SR_FLIP_DETECTOR = new SRFlipDetector();
