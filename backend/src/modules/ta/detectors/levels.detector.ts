/**
 * Levels Detector - Identifies Support and Resistance levels
 * 
 * Uses pivot points and price clustering to identify
 * key support and resistance zones.
 */

import { OhlcvCandle, PivotPoint, Level } from '../ta.contracts.js';

export interface LevelsConfig {
  clusterThreshold: number;  // % threshold for price clustering
  minTouches: number;        // Minimum touches to form a level
  maxLevels: number;         // Maximum levels to return
}

const DEFAULT_CONFIG: LevelsConfig = {
  clusterThreshold: 0.5,  // 0.5% price tolerance
  minTouches: 2,
  maxLevels: 10
};

export class LevelsDetector {
  private config: LevelsConfig;

  constructor(config: Partial<LevelsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect support and resistance levels
   */
  detect(candles: OhlcvCandle[], pivots: PivotPoint[]): Level[] {
    const levels: Level[] = [];
    
    // Group pivots by type
    const swingHighs = pivots.filter(p => p.type === 'HIGH');
    const swingLows = pivots.filter(p => p.type === 'LOW');

    // Find resistance levels from swing highs
    const resistanceLevels = this.clusterPivots(swingHighs, candles, 'RESISTANCE');
    
    // Find support levels from swing lows
    const supportLevels = this.clusterPivots(swingLows, candles, 'SUPPORT');

    levels.push(...resistanceLevels, ...supportLevels);

    // Sort by strength and limit
    return levels
      .sort((a, b) => b.strength - a.strength)
      .slice(0, this.config.maxLevels);
  }

  /**
   * Cluster pivots into levels
   */
  private clusterPivots(
    pivots: PivotPoint[],
    candles: OhlcvCandle[],
    type: 'SUPPORT' | 'RESISTANCE'
  ): Level[] {
    if (pivots.length === 0) return [];

    const levels: Level[] = [];
    const used = new Set<number>();
    const currentPrice = candles[candles.length - 1].close;
    const threshold = currentPrice * (this.config.clusterThreshold / 100);

    for (let i = 0; i < pivots.length; i++) {
      if (used.has(i)) continue;

      const cluster: PivotPoint[] = [pivots[i]];
      used.add(i);

      // Find nearby pivots
      for (let j = i + 1; j < pivots.length; j++) {
        if (used.has(j)) continue;
        
        if (Math.abs(pivots[j].price - pivots[i].price) <= threshold) {
          cluster.push(pivots[j]);
          used.add(j);
        }
      }

      if (cluster.length >= this.config.minTouches) {
        levels.push(this.createLevel(cluster, candles, type));
      }
    }

    return levels;
  }

  /**
   * Create a level from clustered pivots
   */
  private createLevel(
    cluster: PivotPoint[],
    candles: OhlcvCandle[],
    type: 'SUPPORT' | 'RESISTANCE'
  ): Level {
    // Calculate average price of cluster
    const avgPrice = cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;
    
    // Calculate strength based on:
    // 1. Number of touches
    // 2. Recency
    // 3. Average pivot strength
    const touchCount = cluster.length;
    const avgPivotStrength = cluster.reduce((sum, p) => sum + p.strength, 0) / cluster.length;
    
    const timestamps = cluster.map(p => p.ts).sort();
    const firstTouch = timestamps[0];
    const lastTouch = timestamps[timestamps.length - 1];
    
    // Check if level has been broken
    const currentPrice = candles[candles.length - 1].close;
    const broken = type === 'RESISTANCE' 
      ? currentPrice > avgPrice
      : currentPrice < avgPrice;

    // Calculate final strength
    const touchFactor = Math.min(1, touchCount / 5);
    const recencyFactor = this.calculateRecencyFactor(lastTouch, candles);
    const strength = (avgPivotStrength * 0.3 + touchFactor * 0.4 + recencyFactor * 0.3);

    return {
      price: Math.round(avgPrice * 100) / 100,
      type,
      strength: Math.round(strength * 100) / 100,
      touchCount,
      firstTouch,
      lastTouch,
      broken
    };
  }

  /**
   * Calculate recency factor (more recent = stronger)
   */
  private calculateRecencyFactor(lastTouch: number, candles: OhlcvCandle[]): number {
    const now = candles[candles.length - 1].ts;
    const age = now - lastTouch;
    const maxAge = candles[candles.length - 1].ts - candles[0].ts;
    
    if (maxAge === 0) return 1;
    
    // More recent touches get higher factor
    return 1 - (age / maxAge) * 0.5;
  }

  /**
   * Find nearest level to current price
   */
  findNearestLevel(levels: Level[], currentPrice: number): {
    nearestSupport: Level | null;
    nearestResistance: Level | null;
  } {
    let nearestSupport: Level | null = null;
    let nearestResistance: Level | null = null;
    
    for (const level of levels) {
      if (level.type === 'SUPPORT' && level.price < currentPrice) {
        if (!nearestSupport || level.price > nearestSupport.price) {
          nearestSupport = level;
        }
      }
      if (level.type === 'RESISTANCE' && level.price > currentPrice) {
        if (!nearestResistance || level.price < nearestResistance.price) {
          nearestResistance = level;
        }
      }
    }

    return { nearestSupport, nearestResistance };
  }
}
