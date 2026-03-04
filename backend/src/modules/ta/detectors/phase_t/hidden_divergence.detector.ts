/**
 * Phase T: Hidden Divergence Detector
 * 
 * Patterns:
 * - HIDDEN_DIVERGENCE_BULL: Price makes higher low, oscillator makes lower low (continuation)
 * - HIDDEN_DIVERGENCE_BEAR: Price makes lower high, oscillator makes higher high (continuation)
 */

import { Detector, TAContext, CandidatePattern, Pivot } from '../../domain/types.js';
import { getRNG } from '../../infra/rng.js';

export interface HiddenDivergenceConfig {
  minBarsApart: number;        // Minimum bars between divergence points
  maxBarsApart: number;        // Maximum bars to look back
  rsiOverbought: number;       // RSI overbought level
  rsiOversold: number;         // RSI oversold level
  priceTolerance: number;      // % tolerance for price comparison
}

export const DEFAULT_HIDDEN_DIVERGENCE_CONFIG: HiddenDivergenceConfig = {
  minBarsApart: 5,
  maxBarsApart: 30,
  rsiOverbought: 70,
  rsiOversold: 30,
  priceTolerance: 0.5,
};

export class HiddenDivergenceDetector implements Detector {
  id = 'phase_t_hidden_divergence';
  name = 'Hidden Divergence Detector';
  version = '1.0.0';
  types = ['HIDDEN_DIVERGENCE_BULL', 'HIDDEN_DIVERGENCE_BEAR'];

  constructor(private config: HiddenDivergenceConfig = DEFAULT_HIDDEN_DIVERGENCE_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const { candles, pivots, indicators } = ctx;
    if (!candles || candles.length < 30) return [];

    const patterns: CandidatePattern[] = [];
    const rng = getRNG();

    // Get RSI or calculate if not provided
    const rsi = indicators?.rsi || this.calculateRSI(candles, 14);
    if (!rsi || rsi.length < candles.length) return [];

    // Get pivot highs and lows
    const priceLows = pivots?.filter(p => p.type === 'L' || p.type === 'low') || 
                      this.findPricePivots(candles, 'low');
    const priceHighs = pivots?.filter(p => p.type === 'H' || p.type === 'high') || 
                       this.findPricePivots(candles, 'high');

    // ═══════════════════════════════════════════════════════════════
    // Hidden Bullish Divergence
    // Price: Higher Low, RSI: Lower Low
    // ═══════════════════════════════════════════════════════════════
    
    for (let i = 1; i < priceLows.length; i++) {
      const currentLow = priceLows[i];
      const prevLow = priceLows[i - 1];
      
      // Check bars apart constraint
      const barsApart = currentLow.index - prevLow.index;
      if (barsApart < this.config.minBarsApart || barsApart > this.config.maxBarsApart) {
        continue;
      }

      // Price making higher low
      if (currentLow.price > prevLow.price * (1 + this.config.priceTolerance / 100)) {
        // RSI making lower low
        const prevRSI = rsi[prevLow.index];
        const currentRSI = rsi[currentLow.index];
        
        if (currentRSI < prevRSI && currentRSI < this.config.rsiOversold + 20) {
          const strength = (currentLow.price / prevLow.price - 1) * 100;
          const rsiDiff = prevRSI - currentRSI;
          const score = 0.65 + Math.min(strength * 0.02, 0.1) + Math.min(rsiDiff / 100 * 0.15, 0.1);
          
          patterns.push({
            id: `hidden_div_bull_${currentLow.index}_${rng.nextInt(1000, 9999)}`,
            type: 'HIDDEN_DIVERGENCE_BULL',
            direction: 'BULL',
            startIndex: prevLow.index,
            endIndex: currentLow.index,
            keyPrices: {
              prevLow: prevLow.price,
              currentLow: currentLow.price,
              prevRSI,
              currentRSI,
            },
            metrics: {
              priceDivergence: strength,
              rsiDivergence: rsiDiff,
              barsApart,
              totalScore: Math.min(score, 0.88),
              geometryScore: score,
            },
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Hidden Bearish Divergence
    // Price: Lower High, RSI: Higher High
    // ═══════════════════════════════════════════════════════════════
    
    for (let i = 1; i < priceHighs.length; i++) {
      const currentHigh = priceHighs[i];
      const prevHigh = priceHighs[i - 1];
      
      const barsApart = currentHigh.index - prevHigh.index;
      if (barsApart < this.config.minBarsApart || barsApart > this.config.maxBarsApart) {
        continue;
      }

      // Price making lower high
      if (currentHigh.price < prevHigh.price * (1 - this.config.priceTolerance / 100)) {
        // RSI making higher high
        const prevRSI = rsi[prevHigh.index];
        const currentRSI = rsi[currentHigh.index];
        
        if (currentRSI > prevRSI && currentRSI > this.config.rsiOverbought - 20) {
          const strength = (1 - currentHigh.price / prevHigh.price) * 100;
          const rsiDiff = currentRSI - prevRSI;
          const score = 0.65 + Math.min(strength * 0.02, 0.1) + Math.min(rsiDiff / 100 * 0.15, 0.1);
          
          patterns.push({
            id: `hidden_div_bear_${currentHigh.index}_${rng.nextInt(1000, 9999)}`,
            type: 'HIDDEN_DIVERGENCE_BEAR',
            direction: 'BEAR',
            startIndex: prevHigh.index,
            endIndex: currentHigh.index,
            keyPrices: {
              prevHigh: prevHigh.price,
              currentHigh: currentHigh.price,
              prevRSI,
              currentRSI,
            },
            metrics: {
              priceDivergence: strength,
              rsiDivergence: rsiDiff,
              barsApart,
              totalScore: Math.min(score, 0.88),
              geometryScore: score,
            },
          });
        }
      }
    }

    return patterns;
  }

  private calculateRSI(candles: any[], period: number): number[] {
    const rsi: number[] = new Array(candles.length).fill(50);
    if (candles.length < period + 1) return rsi;

    let gains = 0;
    let losses = 0;

    // First RSI calculation
    for (let i = 1; i <= period; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) gains += change;
      else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    // Subsequent RSI values
    for (let i = period + 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? -change : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

      rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }

    return rsi;
  }

  private findPricePivots(candles: any[], type: 'high' | 'low'): Pivot[] {
    const pivots: Pivot[] = [];
    const lookback = 3;

    for (let i = lookback; i < candles.length - lookback; i++) {
      let isPivot = true;
      const current = type === 'high' ? candles[i].high : candles[i].low;

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        const compare = type === 'high' ? candles[j].high : candles[j].low;
        
        if (type === 'high' && compare > current) isPivot = false;
        if (type === 'low' && compare < current) isPivot = false;
      }

      if (isPivot) {
        pivots.push({
          index: i,
          price: current,
          type: type === 'high' ? 'H' : 'L',
        });
      }
    }

    return pivots;
  }
}

export const HIDDEN_DIVERGENCE_DETECTOR = new HiddenDivergenceDetector();
