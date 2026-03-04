/**
 * Structure Engine - Analyzes market structure (trend, HH/HL/LH/LL)
 * 
 * Determines:
 * - Current trend direction
 * - Trend strength
 * - Higher Highs / Higher Lows (uptrend)
 * - Lower Highs / Lower Lows (downtrend)
 */

import { OhlcvCandle, PivotPoint, MarketStructure } from '../ta.contracts.js';

export interface StructureConfig {
  minPivotsRequired: number;
  trendStrengthThreshold: number;
}

const DEFAULT_CONFIG: StructureConfig = {
  minPivotsRequired: 4,
  trendStrengthThreshold: 0.6
};

export class StructureEngine {
  private config: StructureConfig;

  constructor(config: Partial<StructureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze market structure from candles and pivots
   */
  analyze(candles: OhlcvCandle[], pivots: PivotPoint[]): MarketStructure {
    const swingHighs = pivots.filter(p => p.type === 'HIGH').slice(-10);
    const swingLows = pivots.filter(p => p.type === 'LOW').slice(-10);

    // Analyze pivot sequences
    const higherHighs = this.hasHigherHighs(swingHighs);
    const higherLows = this.hasHigherLows(swingLows);
    const lowerHighs = this.hasLowerHighs(swingHighs);
    const lowerLows = this.hasLowerLows(swingLows);

    // Determine trend
    const { trend, strength } = this.determineTrend(
      higherHighs,
      higherLows,
      lowerHighs,
      lowerLows,
      candles
    );

    return {
      trend,
      strength,
      swingHighs,
      swingLows,
      higherHighs,
      higherLows,
      lowerHighs,
      lowerLows
    };
  }

  /**
   * Check if recent swing highs form Higher Highs
   */
  private hasHigherHighs(swingHighs: PivotPoint[]): boolean {
    if (swingHighs.length < 2) return false;
    
    const recent = swingHighs.slice(-3);
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].price <= recent[i - 1].price) return false;
    }
    return true;
  }

  /**
   * Check if recent swing lows form Higher Lows
   */
  private hasHigherLows(swingLows: PivotPoint[]): boolean {
    if (swingLows.length < 2) return false;
    
    const recent = swingLows.slice(-3);
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].price <= recent[i - 1].price) return false;
    }
    return true;
  }

  /**
   * Check if recent swing highs form Lower Highs
   */
  private hasLowerHighs(swingHighs: PivotPoint[]): boolean {
    if (swingHighs.length < 2) return false;
    
    const recent = swingHighs.slice(-3);
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].price >= recent[i - 1].price) return false;
    }
    return true;
  }

  /**
   * Check if recent swing lows form Lower Lows
   */
  private hasLowerLows(swingLows: PivotPoint[]): boolean {
    if (swingLows.length < 2) return false;
    
    const recent = swingLows.slice(-3);
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].price >= recent[i - 1].price) return false;
    }
    return true;
  }

  /**
   * Determine overall trend and strength
   */
  private determineTrend(
    higherHighs: boolean,
    higherLows: boolean,
    lowerHighs: boolean,
    lowerLows: boolean,
    candles: OhlcvCandle[]
  ): { trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS'; strength: number } {
    // Calculate trend score
    let bullScore = 0;
    let bearScore = 0;

    if (higherHighs) bullScore += 2;
    if (higherLows) bullScore += 2;
    if (lowerHighs) bearScore += 2;
    if (lowerLows) bearScore += 2;

    // Add EMA-based confirmation
    const emaStrength = this.calculateEmaStrength(candles);
    if (emaStrength > 0) bullScore += emaStrength;
    else bearScore += Math.abs(emaStrength);

    // Determine trend
    const totalScore = bullScore + bearScore;
    if (totalScore === 0) {
      return { trend: 'SIDEWAYS', strength: 0 };
    }

    const netScore = bullScore - bearScore;
    const normalizedStrength = Math.min(1, Math.abs(netScore) / 5);

    if (netScore > 1) {
      return { trend: 'UPTREND', strength: normalizedStrength };
    } else if (netScore < -1) {
      return { trend: 'DOWNTREND', strength: normalizedStrength };
    } else {
      return { trend: 'SIDEWAYS', strength: normalizedStrength * 0.5 };
    }
  }

  /**
   * Calculate trend strength based on EMAs
   */
  private calculateEmaStrength(candles: OhlcvCandle[]): number {
    if (candles.length < 50) return 0;

    const closes = candles.map(c => c.close);
    const ema20 = this.calculateEma(closes, 20);
    const ema50 = this.calculateEma(closes, 50);

    if (!ema20 || !ema50) return 0;

    const currentPrice = closes[closes.length - 1];
    
    // Price above EMAs and EMA20 > EMA50 = bullish
    if (currentPrice > ema20 && ema20 > ema50) return 1;
    // Price below EMAs and EMA20 < EMA50 = bearish
    if (currentPrice < ema20 && ema20 < ema50) return -1;
    
    return 0;
  }

  /**
   * Simple EMA calculation
   */
  private calculateEma(data: number[], period: number): number | null {
    if (data.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }

    return ema;
  }
}
