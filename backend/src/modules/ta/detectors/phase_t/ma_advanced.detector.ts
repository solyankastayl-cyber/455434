/**
 * Phase T: Advanced MA Pattern Detector
 * 
 * Patterns:
 * - MA_REJECTION_BULL: Price tests MA from above, bounces (support)
 * - MA_REJECTION_BEAR: Price tests MA from below, rejects (resistance)
 * - MA_SQUEEZE: Multiple MAs converging (low volatility before expansion)
 */

import { Detector, TAContext, CandidatePattern } from '../../domain/types.js';
import { getRNG } from '../../infra/rng.js';

export interface MAAdvancedConfig {
  maPeriods: number[];         // MA periods to check [20, 50, 200]
  rejectionTolerance: number;  // % tolerance for MA touch
  squeezeTolerance: number;    // % max distance between MAs for squeeze
  minSqueezeBars: number;      // Minimum bars in squeeze
}

export const DEFAULT_MA_ADVANCED_CONFIG: MAAdvancedConfig = {
  maPeriods: [20, 50, 200],
  rejectionTolerance: 1.0,
  squeezeTolerance: 2.0,
  minSqueezeBars: 5,
};

export class MAAdvancedDetector implements Detector {
  id = 'phase_t_ma_advanced';
  name = 'Advanced MA Pattern Detector';
  version = '1.0.0';
  types = ['MA_REJECTION_BULL', 'MA_REJECTION_BEAR', 'MA_SQUEEZE'];

  constructor(private config: MAAdvancedConfig = DEFAULT_MA_ADVANCED_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const { candles, indicators } = ctx;
    if (!candles || candles.length < Math.max(...this.config.maPeriods) + 10) {
      return [];
    }

    const patterns: CandidatePattern[] = [];
    const rng = getRNG();

    // Calculate MAs if not provided
    const mas: Record<number, number[]> = {};
    for (const period of this.config.maPeriods) {
      mas[period] = indicators?.ma?.[`ma${period}`] || this.calculateSMA(candles, period);
    }

    // ═══════════════════════════════════════════════════════════════
    // MA_REJECTION Detection
    // ═══════════════════════════════════════════════════════════════
    
    const startIdx = Math.max(...this.config.maPeriods) + 5;
    
    for (let i = startIdx; i < candles.length; i++) {
      const candle = candles[i];
      const prevCandle = candles[i - 1];
      
      for (const period of this.config.maPeriods) {
        const ma = mas[period][i];
        if (!ma || ma === 0) continue;
        
        const tolerance = ma * (this.config.rejectionTolerance / 100);

        // Bullish rejection: price dips to MA and bounces
        if (
          candle.low <= ma + tolerance && 
          candle.low >= ma - tolerance &&
          candle.close > ma &&
          prevCandle.close > ma
        ) {
          // Confirm bounce (close above open or green candle)
          const isBounce = candle.close > candle.open || 
            (i + 1 < candles.length && candles[i + 1].close > candle.close);
          
          if (isBounce) {
            const score = this.calculateRejectionScore(candle, ma, period, 'bull');
            
            patterns.push({
              id: `ma_rej_bull_${period}_${i}_${rng.nextInt(1000, 9999)}`,
              type: 'MA_REJECTION_BULL',
              direction: 'BULL',
              startIndex: i - 3,
              endIndex: i,
              keyPrices: {
                maValue: ma,
                maPeriod: period,
                touchLow: candle.low,
                bounceClose: candle.close,
              },
              metrics: {
                maPeriod: period,
                touchDistance: Math.abs(candle.low - ma) / ma * 100,
                totalScore: score,
                geometryScore: score,
              },
            });
          }
        }

        // Bearish rejection: price rallies to MA and rejects
        if (
          candle.high >= ma - tolerance && 
          candle.high <= ma + tolerance &&
          candle.close < ma &&
          prevCandle.close < ma
        ) {
          const isReject = candle.close < candle.open || 
            (i + 1 < candles.length && candles[i + 1].close < candle.close);
          
          if (isReject) {
            const score = this.calculateRejectionScore(candle, ma, period, 'bear');
            
            patterns.push({
              id: `ma_rej_bear_${period}_${i}_${rng.nextInt(1000, 9999)}`,
              type: 'MA_REJECTION_BEAR',
              direction: 'BEAR',
              startIndex: i - 3,
              endIndex: i,
              keyPrices: {
                maValue: ma,
                maPeriod: period,
                touchHigh: candle.high,
                rejectClose: candle.close,
              },
              metrics: {
                maPeriod: period,
                touchDistance: Math.abs(candle.high - ma) / ma * 100,
                totalScore: score,
                geometryScore: score,
              },
            });
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // MA_SQUEEZE Detection
    // ═══════════════════════════════════════════════════════════════
    
    const squeezes = this.detectSqueeze(candles, mas);
    for (const sq of squeezes) {
      patterns.push({
        id: `ma_squeeze_${sq.endIndex}_${rng.nextInt(1000, 9999)}`,
        type: 'MA_SQUEEZE',
        direction: 'BOTH',
        startIndex: sq.startIndex,
        endIndex: sq.endIndex,
        keyPrices: {
          ma20: sq.ma20,
          ma50: sq.ma50,
          ma200: sq.ma200,
          spreadPercent: sq.spread,
        },
        metrics: {
          squeezeBars: sq.endIndex - sq.startIndex,
          minSpread: sq.minSpread,
          totalScore: sq.score,
          geometryScore: sq.score,
        },
      });
    }

    return patterns;
  }

  private calculateRejectionScore(candle: any, ma: number, period: number, direction: 'bull' | 'bear'): number {
    let score = 0.65;
    
    // Higher period MA = stronger support/resistance
    if (period >= 200) score += 0.12;
    else if (period >= 50) score += 0.08;
    else score += 0.04;
    
    // Clean touch bonus
    const touchPrice = direction === 'bull' ? candle.low : candle.high;
    const touchPrecision = 1 - Math.abs(touchPrice - ma) / ma;
    score += touchPrecision * 0.05;
    
    // Strong rejection candle bonus
    const bodySize = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    if (bodySize / range > 0.5) {
      score += 0.05;
    }
    
    return Math.min(score, 0.90);
  }

  private detectSqueeze(candles: any[], mas: Record<number, number[]>): any[] {
    const results: any[] = [];
    const periods = this.config.maPeriods;
    if (periods.length < 2) return results;

    let squeezeStart: number | null = null;
    
    for (let i = Math.max(...periods) + 5; i < candles.length; i++) {
      // Get all MA values at this index
      const maValues = periods.map(p => mas[p][i]).filter(v => v && v > 0);
      if (maValues.length < 2) continue;

      // Calculate max spread between MAs
      const maxMA = Math.max(...maValues);
      const minMA = Math.min(...maValues);
      const spread = (maxMA - minMA) / minMA * 100;

      if (spread <= this.config.squeezeTolerance) {
        if (squeezeStart === null) {
          squeezeStart = i;
        }
      } else {
        // Squeeze ended
        if (squeezeStart !== null) {
          const squeezeBars = i - squeezeStart;
          
          if (squeezeBars >= this.config.minSqueezeBars) {
            const score = 0.60 + Math.min(squeezeBars * 0.01, 0.15);
            
            results.push({
              startIndex: squeezeStart,
              endIndex: i - 1,
              ma20: mas[20]?.[i - 1],
              ma50: mas[50]?.[i - 1],
              ma200: mas[200]?.[i - 1],
              spread,
              minSpread: spread,
              score: Math.min(score, 0.82),
            });
          }
          squeezeStart = null;
        }
      }
    }

    // Handle ongoing squeeze
    if (squeezeStart !== null) {
      const squeezeBars = candles.length - 1 - squeezeStart;
      if (squeezeBars >= this.config.minSqueezeBars) {
        const lastIdx = candles.length - 1;
        const maValues = periods.map(p => mas[p][lastIdx]).filter(v => v && v > 0);
        const spread = maValues.length > 1 
          ? (Math.max(...maValues) - Math.min(...maValues)) / Math.min(...maValues) * 100 
          : 0;
        
        results.push({
          startIndex: squeezeStart,
          endIndex: lastIdx,
          ma20: mas[20]?.[lastIdx],
          ma50: mas[50]?.[lastIdx],
          ma200: mas[200]?.[lastIdx],
          spread,
          minSpread: spread,
          score: 0.68,
        });
      }
    }

    return results;
  }

  private calculateSMA(candles: any[], period: number): number[] {
    const sma: number[] = new Array(candles.length).fill(0);
    
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += candles[j].close;
      }
      sma[i] = sum / period;
    }
    
    return sma;
  }
}

export const MA_ADVANCED_DETECTOR = new MAAdvancedDetector();
