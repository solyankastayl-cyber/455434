/**
 * TREND INDICATOR PROVIDER
 * =========================
 * 
 * SMA/EMA Crossovers, ADX, Supertrend, Aroon, PSAR
 */

import {
  SMA,
  EMA,
  ADX,
  PSAR,
  CrossUp,
  CrossDown,
} from 'technicalindicators';

import type {
  IIndicatorProvider,
  IndicatorInput,
  IndicatorOutput,
  IndicatorCategory,
} from '../indicator.types.js';

export class TrendIndicatorProvider implements IIndicatorProvider {
  readonly id = 'TREND';
  readonly category: IndicatorCategory = 'TREND';
  readonly requiredCandles = 50;
  readonly indicators = [
    'sma_20', 'sma_50', 'ema_12', 'ema_26',
    'ema_cross', 'price_vs_sma20', 'price_vs_sma50',
    'adx_14', 'pdi_14', 'mdi_14', 'psar_trend',
    'aroon_up', 'aroon_down', 'trend_score'
  ];

  async calculate(input: IndicatorInput): Promise<IndicatorOutput[]> {
    const outputs: IndicatorOutput[] = [];
    const { candles } = input;
    
    if (candles.length < this.requiredCandles) {
      return outputs;
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const lastPrice = closes[closes.length - 1];

    try {
      // SMA 20 & 50
      const sma20Values = SMA.calculate({ values: closes, period: 20 });
      const sma50Values = SMA.calculate({ values: closes, period: 50 });
      
      const sma20 = sma20Values[sma20Values.length - 1] ?? lastPrice;
      const sma50 = sma50Values[sma50Values.length - 1] ?? lastPrice;

      outputs.push({
        key: 'sma_20',
        value: sma20,
        confidence: 0.9,
      });
      
      outputs.push({
        key: 'sma_50',
        value: sma50,
        confidence: 0.9,
      });

      // Price vs SMA (deviation)
      const priceVsSma20 = ((lastPrice - sma20) / sma20) * 100;
      const priceVsSma50 = ((lastPrice - sma50) / sma50) * 100;

      outputs.push({
        key: 'price_vs_sma20',
        value: priceVsSma20,
        normalized: Math.tanh(priceVsSma20 / 10),
        confidence: 0.9,
      });
      
      outputs.push({
        key: 'price_vs_sma50',
        value: priceVsSma50,
        normalized: Math.tanh(priceVsSma50 / 15),
        confidence: 0.9,
      });

      // EMA 12 & 26
      const ema12Values = EMA.calculate({ values: closes, period: 12 });
      const ema26Values = EMA.calculate({ values: closes, period: 26 });
      
      const ema12 = ema12Values[ema12Values.length - 1] ?? lastPrice;
      const ema26 = ema26Values[ema26Values.length - 1] ?? lastPrice;

      outputs.push({
        key: 'ema_12',
        value: ema12,
        confidence: 0.9,
      });
      
      outputs.push({
        key: 'ema_26',
        value: ema26,
        confidence: 0.9,
      });

      // EMA Cross (12 vs 26)
      const emaCross = ((ema12 - ema26) / ema26) * 100;
      
      // Check for recent crossover
      const recentEma12 = ema12Values.slice(-5);
      const recentEma26 = ema26Values.slice(-5);
      
      const crossUp = CrossUp.calculate({
        lineA: recentEma12,
        lineB: recentEma26,
      });
      
      const crossDown = CrossDown.calculate({
        lineA: recentEma12,
        lineB: recentEma26,
      });
      
      let emaCrossSignal = 0;
      if (crossUp.some(v => v)) emaCrossSignal = 1;
      else if (crossDown.some(v => v)) emaCrossSignal = -1;

      outputs.push({
        key: 'ema_cross',
        value: emaCross,
        normalized: Math.tanh(emaCross / 3),
        confidence: 0.85,
      });

      outputs.push({
        key: 'ema_cross_signal',
        value: emaCrossSignal,
        confidence: emaCrossSignal !== 0 ? 0.9 : 0.5,
      });

      // ADX (Average Directional Index)
      const adxValues = ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
      });
      
      const lastAdx = adxValues[adxValues.length - 1];
      if (lastAdx) {
        outputs.push({
          key: 'adx_14',
          value: lastAdx.adx,
          normalized: lastAdx.adx / 50, // 0-50 is typical, >25 is trending
          confidence: 0.85,
        });
        
        outputs.push({
          key: 'pdi_14',
          value: lastAdx.pdi,
          confidence: 0.85,
        });
        
        outputs.push({
          key: 'mdi_14',
          value: lastAdx.mdi,
          confidence: 0.85,
        });
      }

      // PSAR (Parabolic SAR)
      const psarValues = PSAR.calculate({
        high: highs,
        low: lows,
        step: 0.02,
        max: 0.2,
      });
      
      const lastPsar = psarValues[psarValues.length - 1] ?? lastPrice;
      const psarTrend = lastPrice > lastPsar ? 1 : -1;

      outputs.push({
        key: 'psar_value',
        value: lastPsar,
        confidence: 0.8,
      });
      
      outputs.push({
        key: 'psar_trend',
        value: psarTrend,
        normalized: psarTrend,
        confidence: 0.8,
      });

      // Aroon (custom calculation)
      const aroonPeriod = 25;
      const aroon = this.calculateAroon(highs, lows, aroonPeriod);
      
      outputs.push({
        key: 'aroon_up',
        value: aroon.up,
        normalized: aroon.up / 50 - 1, // 0-100 → -1 to +1
        confidence: 0.8,
      });
      
      outputs.push({
        key: 'aroon_down',
        value: aroon.down,
        normalized: 1 - aroon.down / 50, // inverted
        confidence: 0.8,
      });

      // Composite Trend Score
      const trendScore = this.calculateTrendScore(
        priceVsSma20,
        priceVsSma50,
        emaCross,
        lastAdx?.adx ?? 20,
        lastAdx?.pdi ?? 25,
        lastAdx?.mdi ?? 25,
        psarTrend,
        aroon
      );

      outputs.push({
        key: 'trend_score',
        value: trendScore,
        normalized: trendScore,
        confidence: 0.9,
      });

    } catch (error: any) {
      console.error('[TrendProvider] Calculation error:', error.message);
    }

    return outputs;
  }

  private calculateAroon(
    highs: number[],
    lows: number[],
    period: number
  ): { up: number; down: number; oscillator: number } {
    const recentHighs = highs.slice(-period);
    const recentLows = lows.slice(-period);
    
    const highestIdx = recentHighs.indexOf(Math.max(...recentHighs));
    const lowestIdx = recentLows.indexOf(Math.min(...recentLows));
    
    const daysSinceHigh = period - 1 - highestIdx;
    const daysSinceLow = period - 1 - lowestIdx;
    
    const aroonUp = ((period - daysSinceHigh) / period) * 100;
    const aroonDown = ((period - daysSinceLow) / period) * 100;
    
    return {
      up: aroonUp,
      down: aroonDown,
      oscillator: aroonUp - aroonDown,
    };
  }

  private calculateTrendScore(
    priceVsSma20: number,
    priceVsSma50: number,
    emaCross: number,
    adx: number,
    pdi: number,
    mdi: number,
    psarTrend: number,
    aroon: { up: number; down: number }
  ): number {
    // Direction components
    const smaDirection = Math.tanh(priceVsSma20 / 5) * 0.15 + Math.tanh(priceVsSma50 / 10) * 0.15;
    const emaDirection = Math.tanh(emaCross / 3) * 0.2;
    const adxDirection = ((pdi - mdi) / 50) * Math.min(adx / 25, 1) * 0.2;
    const psarDirection = psarTrend * 0.15;
    const aroonDirection = (aroon.up - aroon.down) / 100 * 0.15;

    return Math.max(-1, Math.min(1,
      smaDirection + emaDirection + adxDirection + psarDirection + aroonDirection
    ));
  }
}

export const trendProvider = new TrendIndicatorProvider();

console.log('[ExchangeAlt] Trend Provider loaded');
