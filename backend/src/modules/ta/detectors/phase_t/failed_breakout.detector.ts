/**
 * Phase T: Failed Breakout / Trap Detector
 * 
 * Patterns:
 * - FAILED_BREAKOUT_BULL_TRAP: Price breaks above level, fails, reverses down
 * - FAILED_BREAKOUT_BEAR_TRAP: Price breaks below level, fails, reverses up
 * - GAP_FAIR_VALUE: Fair value gap (FVG) for imbalance zones
 */

import { Detector, TAContext, CandidatePattern } from '../../domain/types.js';
import { getRNG } from '../../infra/rng.js';

export interface FailedBreakoutConfig {
  minBreakPercent: number;     // Minimum break above/below level
  maxBarsToFail: number;       // Maximum bars before failure confirmation
  requireClose: boolean;       // Require close back inside range
  fvgMinSize: number;          // Minimum FVG size as % of ATR
}

export const DEFAULT_FAILED_BREAKOUT_CONFIG: FailedBreakoutConfig = {
  minBreakPercent: 0.3,
  maxBarsToFail: 5,
  requireClose: true,
  fvgMinSize: 0.5,
};

export class FailedBreakoutDetector implements Detector {
  id = 'phase_t_failed_breakout';
  name = 'Failed Breakout / Trap Detector';
  version = '1.0.0';
  types = ['FAILED_BREAKOUT_BULL_TRAP', 'FAILED_BREAKOUT_BEAR_TRAP', 'GAP_FAIR_VALUE'];

  constructor(private config: FailedBreakoutConfig = DEFAULT_FAILED_BREAKOUT_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const { candles, levels } = ctx;
    if (!candles || candles.length < 15) return [];

    const patterns: CandidatePattern[] = [];
    const rng = getRNG();

    // Calculate ATR for FVG sizing
    const atr = this.calculateATR(candles, 14);

    // ═══════════════════════════════════════════════════════════════
    // Failed Breakout Detection
    // ═══════════════════════════════════════════════════════════════
    
    if (levels && levels.length > 0) {
      for (const level of levels) {
        const levelPrice = level.price;
        const breakThreshold = levelPrice * (this.config.minBreakPercent / 100);

        for (let i = 5; i < candles.length - this.config.maxBarsToFail; i++) {
          const prev = candles[i - 1];
          const breakCandle = candles[i];

          // Bull trap: breaks above then fails
          if (prev.high < levelPrice && breakCandle.high > levelPrice + breakThreshold) {
            // Look for failure
            for (let j = i + 1; j <= i + this.config.maxBarsToFail && j < candles.length; j++) {
              const failCandle = candles[j];
              
              const failed = this.config.requireClose 
                ? failCandle.close < levelPrice
                : failCandle.low < levelPrice - breakThreshold;
              
              if (failed) {
                const score = this.calculateTrapScore(breakCandle, failCandle, level);
                
                patterns.push({
                  id: `bull_trap_${j}_${rng.nextInt(1000, 9999)}`,
                  type: 'FAILED_BREAKOUT_BULL_TRAP',
                  direction: 'BEAR',
                  startIndex: i,
                  endIndex: j,
                  keyPrices: {
                    levelPrice,
                    breakHigh: breakCandle.high,
                    failClose: failCandle.close,
                  },
                  metrics: {
                    trapDepth: (breakCandle.high - failCandle.close) / levelPrice * 100,
                    totalScore: score,
                    geometryScore: score,
                  },
                });
                break;
              }
            }
          }

          // Bear trap: breaks below then fails
          if (prev.low > levelPrice && breakCandle.low < levelPrice - breakThreshold) {
            for (let j = i + 1; j <= i + this.config.maxBarsToFail && j < candles.length; j++) {
              const failCandle = candles[j];
              
              const failed = this.config.requireClose 
                ? failCandle.close > levelPrice
                : failCandle.high > levelPrice + breakThreshold;
              
              if (failed) {
                const score = this.calculateTrapScore(breakCandle, failCandle, level);
                
                patterns.push({
                  id: `bear_trap_${j}_${rng.nextInt(1000, 9999)}`,
                  type: 'FAILED_BREAKOUT_BEAR_TRAP',
                  direction: 'BULL',
                  startIndex: i,
                  endIndex: j,
                  keyPrices: {
                    levelPrice,
                    breakLow: breakCandle.low,
                    failClose: failCandle.close,
                  },
                  metrics: {
                    trapDepth: (failCandle.close - breakCandle.low) / levelPrice * 100,
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

    // ═══════════════════════════════════════════════════════════════
    // Fair Value Gap Detection
    // ═══════════════════════════════════════════════════════════════
    
    for (let i = 2; i < candles.length; i++) {
      const candle1 = candles[i - 2];
      const candle2 = candles[i - 1]; // Middle candle (gap candle)
      const candle3 = candles[i];

      // Bullish FVG: gap between candle1.high and candle3.low
      const bullGap = candle3.low - candle1.high;
      if (bullGap > atr * this.config.fvgMinSize) {
        const score = 0.65 + Math.min(bullGap / atr * 0.1, 0.15);
        
        patterns.push({
          id: `fvg_bull_${i}_${rng.nextInt(1000, 9999)}`,
          type: 'GAP_FAIR_VALUE',
          direction: 'BULL',
          startIndex: i - 2,
          endIndex: i,
          keyPrices: {
            gapTop: candle3.low,
            gapBottom: candle1.high,
            gapMid: (candle3.low + candle1.high) / 2,
          },
          metrics: {
            gapSize: bullGap,
            gapPercent: bullGap / candle2.close * 100,
            totalScore: Math.min(score, 0.85),
            geometryScore: score,
          },
        });
      }

      // Bearish FVG: gap between candle3.high and candle1.low
      const bearGap = candle1.low - candle3.high;
      if (bearGap > atr * this.config.fvgMinSize) {
        const score = 0.65 + Math.min(bearGap / atr * 0.1, 0.15);
        
        patterns.push({
          id: `fvg_bear_${i}_${rng.nextInt(1000, 9999)}`,
          type: 'GAP_FAIR_VALUE',
          direction: 'BEAR',
          startIndex: i - 2,
          endIndex: i,
          keyPrices: {
            gapTop: candle1.low,
            gapBottom: candle3.high,
            gapMid: (candle1.low + candle3.high) / 2,
          },
          metrics: {
            gapSize: bearGap,
            gapPercent: bearGap / candle2.close * 100,
            totalScore: Math.min(score, 0.85),
            geometryScore: score,
          },
        });
      }
    }

    return patterns;
  }

  private calculateTrapScore(breakCandle: any, failCandle: any, level: any): number {
    let score = 0.7;
    
    // Faster failure = higher score
    score += 0.05;
    
    // Level strength bonus
    if (level.strength && level.strength > 0.7) {
      score += 0.08;
    }
    
    // Volume spike on failure
    if (failCandle.volume && breakCandle.volume && failCandle.volume > breakCandle.volume * 1.5) {
      score += 0.07;
    }
    
    return Math.min(score, 0.9);
  }

  private calculateATR(candles: any[], period: number): number {
    if (candles.length < period + 1) return candles[0]?.close * 0.02 || 100;
    
    let sum = 0;
    for (let i = 1; i <= period; i++) {
      const idx = candles.length - i;
      const c = candles[idx];
      const p = candles[idx - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      );
      sum += tr;
    }
    return sum / period;
  }
}

export const FAILED_BREAKOUT_DETECTOR = new FailedBreakoutDetector();
