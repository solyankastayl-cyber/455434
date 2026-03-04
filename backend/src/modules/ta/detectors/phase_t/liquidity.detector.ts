/**
 * Phase T: Liquidity Sweep Detector
 * 
 * Patterns:
 * - LIQUIDITY_SWEEP_HIGH: Price sweeps above previous high then closes below
 * - LIQUIDITY_SWEEP_LOW: Price sweeps below previous low then closes above
 */

import { Detector, TAContext, CandidatePattern, OhlcvCandle } from '../../domain/types.js';
import { getRNG } from '../../infra/rng.js';

export interface LiquidityConfig {
  minSweepPercent: number;    // Minimum sweep distance as % of range
  lookbackBars: number;       // Bars to look for previous high/low
  confirmClose: boolean;      // Require close back inside range
}

export const DEFAULT_LIQUIDITY_CONFIG: LiquidityConfig = {
  minSweepPercent: 0.1,
  lookbackBars: 10,
  confirmClose: true,
};

export class LiquidityDetector implements Detector {
  id = 'phase_t_liquidity';
  name = 'Liquidity Sweep Detector';
  version = '1.0.0';
  types = ['LIQUIDITY_SWEEP_HIGH', 'LIQUIDITY_SWEEP_LOW'];

  constructor(private config: LiquidityConfig = DEFAULT_LIQUIDITY_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const { candles } = ctx;
    if (!candles || candles.length < this.config.lookbackBars + 2) return [];

    const patterns: CandidatePattern[] = [];
    const rng = getRNG();

    for (let i = this.config.lookbackBars; i < candles.length; i++) {
      const current = candles[i];
      
      // Find highest high in lookback period
      let highestHigh = 0;
      let highestIdx = i;
      for (let j = i - this.config.lookbackBars; j < i; j++) {
        if (candles[j].high > highestHigh) {
          highestHigh = candles[j].high;
          highestIdx = j;
        }
      }
      
      // Find lowest low in lookback period
      let lowestLow = Infinity;
      let lowestIdx = i;
      for (let j = i - this.config.lookbackBars; j < i; j++) {
        if (candles[j].low < lowestLow) {
          lowestLow = candles[j].low;
          lowestIdx = j;
        }
      }

      // Check for liquidity sweep high (bearish)
      if (current.high > highestHigh) {
        const sweepAmount = (current.high - highestHigh) / highestHigh;
        
        if (sweepAmount >= this.config.minSweepPercent / 100) {
          // If confirmClose, check that we close below the previous high
          const confirmed = !this.config.confirmClose || current.close < highestHigh;
          
          if (confirmed) {
            const score = this.calculateScore(sweepAmount, current, candles.slice(i - this.config.lookbackBars, i));
            
            patterns.push({
              id: `liq_sweep_high_${i}_${rng.nextInt(1000, 9999)}`,
              type: 'LIQUIDITY_SWEEP_HIGH',
              direction: 'BEAR',
              startIndex: highestIdx,
              endIndex: i,
              keyPrices: {
                sweepHigh: current.high,
                previousHigh: highestHigh,
                close: current.close,
              },
              metrics: {
                sweepPercent: sweepAmount * 100,
                totalScore: score,
                geometryScore: score,
              },
            });
          }
        }
      }

      // Check for liquidity sweep low (bullish)
      if (current.low < lowestLow) {
        const sweepAmount = (lowestLow - current.low) / lowestLow;
        
        if (sweepAmount >= this.config.minSweepPercent / 100) {
          const confirmed = !this.config.confirmClose || current.close > lowestLow;
          
          if (confirmed) {
            const score = this.calculateScore(sweepAmount, current, candles.slice(i - this.config.lookbackBars, i));
            
            patterns.push({
              id: `liq_sweep_low_${i}_${rng.nextInt(1000, 9999)}`,
              type: 'LIQUIDITY_SWEEP_LOW',
              direction: 'BULL',
              startIndex: lowestIdx,
              endIndex: i,
              keyPrices: {
                sweepLow: current.low,
                previousLow: lowestLow,
                close: current.close,
              },
              metrics: {
                sweepPercent: sweepAmount * 100,
                totalScore: score,
                geometryScore: score,
              },
            });
          }
        }
      }
    }

    return patterns;
  }

  private calculateScore(sweepAmount: number, current: OhlcvCandle, lookbackCandles: OhlcvCandle[]): number {
    // Base score from sweep magnitude
    let score = 0.65 + Math.min(sweepAmount * 10, 0.15);
    
    // Volume confirmation bonus
    const avgVolume = lookbackCandles.reduce((s, c) => s + (c.volume || 0), 0) / lookbackCandles.length;
    if (current.volume && current.volume > avgVolume * 1.5) {
      score += 0.1;
    }
    
    // Rejection wick bonus (close far from sweep extreme)
    const candleRange = current.high - current.low;
    const rejectionRatio = Math.abs(current.close - (current.high + current.low) / 2) / candleRange;
    score += rejectionRatio * 0.1;
    
    return Math.min(score, 0.95);
  }
}

export const LIQUIDITY_DETECTOR = new LiquidityDetector();
