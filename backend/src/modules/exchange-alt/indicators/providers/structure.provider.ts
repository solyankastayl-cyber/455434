/**
 * STRUCTURE INDICATOR PROVIDER
 * =============================
 * 
 * Breakout/Breakdown, Support/Resistance, Market Structure
 */

import type {
  IIndicatorProvider,
  IndicatorInput,
  IndicatorOutput,
  IndicatorCategory,
} from '../indicator.types.js';

export class StructureIndicatorProvider implements IIndicatorProvider {
  readonly id = 'STRUCTURE';
  readonly category: IndicatorCategory = 'STRUCTURE';
  readonly requiredCandles = 50;
  readonly indicators = [
    'breakout_score', 'breakdown_score', 'sr_distance',
    'resistance_proximity', 'support_proximity',
    'higher_high', 'lower_low', 'range_position',
    'mean_reversion_score', 'structure_trend'
  ];

  async calculate(input: IndicatorInput): Promise<IndicatorOutput[]> {
    const outputs: IndicatorOutput[] = [];
    const { candles } = input;
    
    if (candles.length < this.requiredCandles) {
      return outputs;
    }

    const closes = candles.map((c: { close: number }) => c.close);
    const highs = candles.map((c: { high: number }) => c.high);
    const lows = candles.map((c: { low: number }) => c.low);
    const lastPrice = closes[closes.length - 1];

    try {
      // ═══════════════════════════════════════════════════════════
      // SUPPORT & RESISTANCE LEVELS
      // ═══════════════════════════════════════════════════════════
      
      const { support, resistance } = this.findSRLevels(highs, lows, closes);
      
      // Distance to S/R as percentage
      const resistanceDistance = resistance > 0 
        ? ((resistance - lastPrice) / lastPrice) * 100 
        : 100;
      const supportDistance = support > 0 
        ? ((lastPrice - support) / lastPrice) * 100 
        : 100;

      outputs.push({
        key: 'resistance_proximity',
        value: Math.max(0, Math.min(100, 100 - resistanceDistance * 10)),
        normalized: Math.max(0, 1 - resistanceDistance / 10),
        confidence: 0.75,
      });
      
      outputs.push({
        key: 'support_proximity',
        value: Math.max(0, Math.min(100, 100 - supportDistance * 10)),
        normalized: Math.max(0, 1 - supportDistance / 10),
        confidence: 0.75,
      });

      outputs.push({
        key: 'sr_distance',
        value: resistanceDistance - supportDistance,
        normalized: Math.tanh((resistanceDistance - supportDistance) / 5),
        confidence: 0.7,
      });

      // ═══════════════════════════════════════════════════════════
      // BREAKOUT / BREAKDOWN SCORES
      // ═══════════════════════════════════════════════════════════
      
      const recentHigh = Math.max(...highs.slice(-20));
      const recentLow = Math.min(...lows.slice(-20));
      const range = recentHigh - recentLow;
      
      // Breakout score: how close to breaking recent high
      const breakoutScore = range > 0 
        ? (lastPrice - recentLow) / range 
        : 0.5;
      
      // Breakdown score: how close to breaking recent low
      const breakdownScore = range > 0 
        ? (recentHigh - lastPrice) / range 
        : 0.5;

      outputs.push({
        key: 'breakout_score',
        value: breakoutScore,
        normalized: breakoutScore,
        confidence: 0.8,
      });
      
      outputs.push({
        key: 'breakdown_score',
        value: breakdownScore,
        normalized: breakdownScore,
        confidence: 0.8,
      });

      // ═══════════════════════════════════════════════════════════
      // HIGHER HIGHS / LOWER LOWS
      // ═══════════════════════════════════════════════════════════
      
      const swingPoints = this.findSwingPoints(highs, lows, 5);
      const hhCount = swingPoints.higherHighs;
      const llCount = swingPoints.lowerLows;
      const hlCount = swingPoints.higherLows;
      const lhCount = swingPoints.lowerHighs;

      outputs.push({
        key: 'higher_high',
        value: hhCount,
        normalized: Math.min(1, hhCount / 3),
        confidence: 0.8,
      });
      
      outputs.push({
        key: 'lower_low',
        value: llCount,
        normalized: Math.min(1, llCount / 3),
        confidence: 0.8,
      });

      // Structure trend: positive = uptrend, negative = downtrend
      const structureTrend = ((hhCount + hlCount) - (llCount + lhCount)) / 
        Math.max(1, hhCount + hlCount + llCount + lhCount);

      outputs.push({
        key: 'structure_trend',
        value: structureTrend,
        normalized: structureTrend,
        confidence: 0.85,
      });

      // ═══════════════════════════════════════════════════════════
      // RANGE POSITION
      // ═══════════════════════════════════════════════════════════
      
      const range50High = Math.max(...highs.slice(-50));
      const range50Low = Math.min(...lows.slice(-50));
      const range50 = range50High - range50Low;
      
      const rangePosition = range50 > 0 
        ? (lastPrice - range50Low) / range50 
        : 0.5;

      outputs.push({
        key: 'range_position',
        value: rangePosition,
        normalized: rangePosition * 2 - 1, // 0-1 → -1 to +1
        confidence: 0.85,
      });

      // ═══════════════════════════════════════════════════════════
      // MEAN REVERSION SCORE
      // ═══════════════════════════════════════════════════════════
      
      const meanPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const deviation = (lastPrice - meanPrice) / meanPrice;
      
      // Mean reversion opportunity: high when far from mean
      const meanRevScore = Math.abs(deviation) * 10; // Scale up

      outputs.push({
        key: 'mean_reversion_score',
        value: meanRevScore,
        normalized: Math.min(1, meanRevScore),
        confidence: 0.75,
      });

      // Direction for mean reversion
      outputs.push({
        key: 'mean_reversion_direction',
        value: deviation < 0 ? 'UP' : 'DOWN',
        normalized: -Math.sign(deviation),
        confidence: 0.75,
      });

    } catch (error: any) {
      console.error('[StructureProvider] Calculation error:', error.message);
    }

    return outputs;
  }

  private findSRLevels(
    highs: number[],
    lows: number[],
    closes: number[]
  ): { support: number; resistance: number } {
    // Simple pivot-based S/R
    const pivotHighs: number[] = [];
    const pivotLows: number[] = [];
    
    for (let i = 2; i < highs.length - 2; i++) {
      // Pivot high
      if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] &&
          highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
        pivotHighs.push(highs[i]);
      }
      // Pivot low
      if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] &&
          lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
        pivotLows.push(lows[i]);
      }
    }
    
    const lastPrice = closes[closes.length - 1];
    
    // Find nearest resistance (pivot high above current price)
    const resistance = pivotHighs
      .filter(p => p > lastPrice)
      .sort((a, b) => a - b)[0] ?? Math.max(...highs.slice(-20));
    
    // Find nearest support (pivot low below current price)
    const support = pivotLows
      .filter(p => p < lastPrice)
      .sort((a, b) => b - a)[0] ?? Math.min(...lows.slice(-20));
    
    return { support, resistance };
  }

  private findSwingPoints(
    highs: number[],
    lows: number[],
    lookback: number
  ): {
    higherHighs: number;
    lowerLows: number;
    higherLows: number;
    lowerHighs: number;
  } {
    const swingHighs: number[] = [];
    const swingLows: number[] = [];
    
    for (let i = lookback; i < highs.length - lookback; i++) {
      // Check for swing high
      let isSwingHigh = true;
      let isSwingLow = true;
      
      for (let j = 1; j <= lookback; j++) {
        if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) {
          isSwingHigh = false;
        }
        if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) {
          isSwingLow = false;
        }
      }
      
      if (isSwingHigh) swingHighs.push(highs[i]);
      if (isSwingLow) swingLows.push(lows[i]);
    }
    
    // Count patterns
    let higherHighs = 0;
    let lowerHighs = 0;
    let higherLows = 0;
    let lowerLows = 0;
    
    for (let i = 1; i < swingHighs.length; i++) {
      if (swingHighs[i] > swingHighs[i - 1]) higherHighs++;
      else lowerHighs++;
    }
    
    for (let i = 1; i < swingLows.length; i++) {
      if (swingLows[i] > swingLows[i - 1]) higherLows++;
      else lowerLows++;
    }
    
    return { higherHighs, lowerLows, higherLows, lowerHighs };
  }
}

export const structureProvider = new StructureIndicatorProvider();

console.log('[ExchangeAlt] Structure Provider loaded');
