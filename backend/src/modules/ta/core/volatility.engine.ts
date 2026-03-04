/**
 * Volatility Engine - Calculates market volatility metrics
 * 
 * Provides:
 * - ATR (Average True Range)
 * - Historical volatility
 * - Volatility regime classification
 */

import { OhlcvCandle } from '../ta.contracts.js';

export interface VolatilityMetrics {
  atr: number;           // Average True Range (absolute)
  atrPct: number;        // ATR as percentage of price
  historicalVol: number; // Historical volatility (std dev)
  regime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  percentile: number;    // Current vol percentile (0-100)
}

export interface VolatilityConfig {
  atrPeriod: number;
  volPeriod: number;
  lowThreshold: number;    // percentile
  highThreshold: number;   // percentile
  extremeThreshold: number; // percentile
}

const DEFAULT_CONFIG: VolatilityConfig = {
  atrPeriod: 14,
  volPeriod: 20,
  lowThreshold: 25,
  highThreshold: 75,
  extremeThreshold: 90
};

export class VolatilityEngine {
  private config: VolatilityConfig;

  constructor(config: Partial<VolatilityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate all volatility metrics
   */
  calculate(candles: OhlcvCandle[]): VolatilityMetrics {
    if (candles.length < this.config.atrPeriod + 1) {
      return this.getDefaultMetrics();
    }

    const atr = this.calculateATR(candles);
    const currentPrice = candles[candles.length - 1].close;
    const atrPct = (atr / currentPrice) * 100;
    
    const historicalVol = this.calculateHistoricalVol(candles);
    const percentile = this.calculateVolPercentile(candles, atrPct);
    const regime = this.classifyRegime(percentile);

    return {
      atr: Math.round(atr * 100) / 100,
      atrPct: Math.round(atrPct * 100) / 100,
      historicalVol: Math.round(historicalVol * 100) / 100,
      regime,
      percentile: Math.round(percentile)
    };
  }

  /**
   * Calculate Average True Range
   */
  private calculateATR(candles: OhlcvCandle[]): number {
    const trueRanges: number[] = [];
    
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];
      
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );
      
      trueRanges.push(tr);
    }

    // Calculate simple average for initial ATR
    const period = this.config.atrPeriod;
    if (trueRanges.length < period) {
      return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
    }

    // Use exponential smoothing for ATR
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < trueRanges.length; i++) {
      atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    }

    return atr;
  }

  /**
   * Calculate historical volatility (annualized)
   */
  private calculateHistoricalVol(candles: OhlcvCandle[]): number {
    const period = this.config.volPeriod;
    if (candles.length < period + 1) {
      return 0;
    }

    // Calculate log returns
    const returns: number[] = [];
    const recent = candles.slice(-period - 1);
    
    for (let i = 1; i < recent.length; i++) {
      const ret = Math.log(recent[i].close / recent[i - 1].close);
      returns.push(ret);
    }

    // Calculate standard deviation
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Annualize (assuming daily data, 252 trading days)
    return stdDev * Math.sqrt(252) * 100;
  }

  /**
   * Calculate volatility percentile relative to history
   */
  private calculateVolPercentile(candles: OhlcvCandle[], currentAtrPct: number): number {
    const lookback = Math.min(252, candles.length - this.config.atrPeriod);
    if (lookback < 20) return 50;

    // Calculate historical ATR percentages
    const historicalAtrPcts: number[] = [];
    
    for (let i = this.config.atrPeriod; i < candles.length - 1; i++) {
      const subset = candles.slice(0, i + 1);
      const atr = this.calculateATR(subset);
      const price = subset[subset.length - 1].close;
      historicalAtrPcts.push((atr / price) * 100);
    }

    // Calculate percentile
    const below = historicalAtrPcts.filter(v => v < currentAtrPct).length;
    return (below / historicalAtrPcts.length) * 100;
  }

  /**
   * Classify volatility regime
   */
  private classifyRegime(percentile: number): 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' {
    if (percentile >= this.config.extremeThreshold) return 'EXTREME';
    if (percentile >= this.config.highThreshold) return 'HIGH';
    if (percentile <= this.config.lowThreshold) return 'LOW';
    return 'NORMAL';
  }

  /**
   * Get default metrics for insufficient data
   */
  private getDefaultMetrics(): VolatilityMetrics {
    return {
      atr: 0,
      atrPct: 0,
      historicalVol: 0,
      regime: 'NORMAL',
      percentile: 50
    };
  }
}
