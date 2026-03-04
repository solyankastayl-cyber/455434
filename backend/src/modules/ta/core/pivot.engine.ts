/**
 * Pivot Engine - Detects swing highs and lows
 * 
 * Core component for TA analysis.
 * Uses configurable lookback periods for pivot detection.
 */

import { OhlcvCandle, PivotPoint } from '../ta.contracts.js';

export interface PivotConfig {
  leftBars: number;   // Bars to the left for confirmation
  rightBars: number;  // Bars to the right for confirmation
  minStrength: number; // Minimum strength threshold
}

const DEFAULT_CONFIG: PivotConfig = {
  leftBars: 5,
  rightBars: 5,
  minStrength: 0.3
};

export class PivotEngine {
  private config: PivotConfig;

  constructor(config: Partial<PivotConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect all pivot points in candle data
   */
  detectPivots(candles: OhlcvCandle[]): PivotPoint[] {
    const pivots: PivotPoint[] = [];
    const { leftBars, rightBars } = this.config;

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      
      // Check for swing high
      if (this.isSwingHigh(candles, i, leftBars, rightBars)) {
        const strength = this.calculateStrength(candles, i, 'HIGH');
        pivots.push({
          type: 'HIGH',
          price: current.high,
          ts: current.ts,
          index: i,
          strength
        });
      }
      
      // Check for swing low
      if (this.isSwingLow(candles, i, leftBars, rightBars)) {
        const strength = this.calculateStrength(candles, i, 'LOW');
        pivots.push({
          type: 'LOW',
          price: current.low,
          ts: current.ts,
          index: i,
          strength
        });
      }
    }

    return pivots.filter(p => p.strength >= this.config.minStrength);
  }

  /**
   * Check if candle at index is a swing high
   */
  private isSwingHigh(
    candles: OhlcvCandle[],
    index: number,
    leftBars: number,
    rightBars: number
  ): boolean {
    const currentHigh = candles[index].high;
    
    // Check left bars
    for (let i = index - leftBars; i < index; i++) {
      if (candles[i].high >= currentHigh) return false;
    }
    
    // Check right bars
    for (let i = index + 1; i <= index + rightBars; i++) {
      if (candles[i].high > currentHigh) return false;
    }
    
    return true;
  }

  /**
   * Check if candle at index is a swing low
   */
  private isSwingLow(
    candles: OhlcvCandle[],
    index: number,
    leftBars: number,
    rightBars: number
  ): boolean {
    const currentLow = candles[index].low;
    
    // Check left bars
    for (let i = index - leftBars; i < index; i++) {
      if (candles[i].low <= currentLow) return false;
    }
    
    // Check right bars
    for (let i = index + 1; i <= index + rightBars; i++) {
      if (candles[i].low < currentLow) return false;
    }
    
    return true;
  }

  /**
   * Calculate pivot strength based on price movement
   */
  private calculateStrength(
    candles: OhlcvCandle[],
    index: number,
    type: 'HIGH' | 'LOW'
  ): number {
    const lookback = 20;
    const startIdx = Math.max(0, index - lookback);
    const endIdx = Math.min(candles.length - 1, index + lookback);
    
    const current = type === 'HIGH' ? candles[index].high : candles[index].low;
    
    // Calculate how significant this pivot is relative to surrounding price action
    let maxDiff = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      if (i === index) continue;
      const price = type === 'HIGH' ? candles[i].high : candles[i].low;
      maxDiff = Math.max(maxDiff, Math.abs(current - price));
    }
    
    // Normalize strength (0-1)
    const avgPrice = candles.slice(startIdx, endIdx + 1)
      .reduce((sum, c) => sum + c.close, 0) / (endIdx - startIdx + 1);
    
    const normalizedStrength = maxDiff / avgPrice;
    return Math.min(1, normalizedStrength * 10); // Scale and cap at 1
  }

  /**
   * Get recent pivots (last N)
   */
  getRecentPivots(pivots: PivotPoint[], count: number = 10): PivotPoint[] {
    return pivots.slice(-count);
  }

  /**
   * Get pivots by type
   */
  filterByType(pivots: PivotPoint[], type: 'HIGH' | 'LOW'): PivotPoint[] {
    return pivots.filter(p => p.type === type);
  }
}
