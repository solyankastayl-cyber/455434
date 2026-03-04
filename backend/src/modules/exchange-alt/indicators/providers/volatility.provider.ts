/**
 * VOLATILITY INDICATOR PROVIDER
 * ==============================
 * 
 * ATR, Bollinger Bands, Keltner Channels, Historical Volatility
 */

import {
  ATR,
  BollingerBands,
} from 'technicalindicators';

import type {
  IIndicatorProvider,
  IndicatorInput,
  IndicatorOutput,
  IndicatorCategory,
} from '../indicator.types.js';

export class VolatilityIndicatorProvider implements IIndicatorProvider {
  readonly id = 'VOLATILITY';
  readonly category: IndicatorCategory = 'VOLATILITY';
  readonly requiredCandles = 30;
  readonly indicators = [
    'atr_14', 'atr_pct', 'bb_upper', 'bb_lower', 'bb_middle',
    'bb_width', 'bb_percent', 'keltner_upper', 'keltner_lower',
    'hist_vol_20', 'volatility_z', 'vol_regime', 'squeeze_score'
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
      // ATR 14
      const atrValues = ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
      });
      
      const atr14 = atrValues[atrValues.length - 1] ?? 0;
      const atrPct = (atr14 / lastPrice) * 100;

      outputs.push({
        key: 'atr_14',
        value: atr14,
        confidence: 0.9,
      });
      
      outputs.push({
        key: 'atr_pct',
        value: atrPct,
        normalized: Math.tanh(atrPct / 5), // 5% ATR is relatively high
        confidence: 0.9,
      });

      // Bollinger Bands
      const bbValues = BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2,
      });
      
      const lastBB = bbValues[bbValues.length - 1];
      if (lastBB) {
        const bbWidth = ((lastBB.upper - lastBB.lower) / lastBB.middle) * 100;
        const bbPercent = (lastPrice - lastBB.lower) / (lastBB.upper - lastBB.lower);

        outputs.push({
          key: 'bb_upper',
          value: lastBB.upper,
          confidence: 0.9,
        });
        
        outputs.push({
          key: 'bb_lower',
          value: lastBB.lower,
          confidence: 0.9,
        });
        
        outputs.push({
          key: 'bb_middle',
          value: lastBB.middle,
          confidence: 0.9,
        });
        
        outputs.push({
          key: 'bb_width',
          value: bbWidth,
          normalized: Math.tanh(bbWidth / 20), // 20% width is wide
          confidence: 0.9,
        });
        
        outputs.push({
          key: 'bb_percent',
          value: bbPercent,
          normalized: bbPercent * 2 - 1, // 0-1 → -1 to +1
          confidence: 0.9,
        });
      }

      // Keltner Channels (EMA 20 ± 2*ATR)
      const ema20 = this.calculateEMA(closes, 20);
      const keltnerUpper = ema20 + 2 * atr14;
      const keltnerLower = ema20 - 2 * atr14;
      const keltnerWidth = ((keltnerUpper - keltnerLower) / ema20) * 100;

      outputs.push({
        key: 'keltner_upper',
        value: keltnerUpper,
        confidence: 0.85,
      });
      
      outputs.push({
        key: 'keltner_lower',
        value: keltnerLower,
        confidence: 0.85,
      });
      
      outputs.push({
        key: 'keltner_width',
        value: keltnerWidth,
        confidence: 0.85,
      });

      // Historical Volatility (20-period)
      const returns = this.calculateReturns(closes);
      const histVol20 = this.calculateStdDev(returns.slice(-20)) * Math.sqrt(252) * 100;
      
      outputs.push({
        key: 'hist_vol_20',
        value: histVol20,
        normalized: Math.tanh(histVol20 / 100), // 100% annualized vol is high
        confidence: 0.85,
      });

      // Volatility Z-Score (current vol vs 50-period average)
      const recentVol = this.calculateStdDev(returns.slice(-14)) * Math.sqrt(252) * 100;
      const avgVol = histVol20;
      const volStd = this.calculateVolatilityOfVolatility(returns, 50);
      const volatilityZ = volStd > 0 ? (recentVol - avgVol) / volStd : 0;

      outputs.push({
        key: 'volatility_z',
        value: volatilityZ,
        zScore: volatilityZ,
        confidence: 0.8,
      });

      // Volatility Regime
      let volRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
      if (volatilityZ < -1) volRegime = 'LOW';
      else if (volatilityZ < 1) volRegime = 'NORMAL';
      else if (volatilityZ < 2) volRegime = 'HIGH';
      else volRegime = 'EXTREME';

      outputs.push({
        key: 'vol_regime',
        value: volRegime,
        normalized: volatilityZ / 2, // -1 to +1 approximately
        confidence: 0.85,
      });

      // Squeeze Detection (Bollinger inside Keltner)
      let squeezeScore = 0;
      if (lastBB) {
        const bbInsideKeltner = lastBB.upper < keltnerUpper && lastBB.lower > keltnerLower;
        if (bbInsideKeltner) {
          // Squeeze intensity based on how tight BBs are relative to Keltner
          const bbRatio = (lastBB.upper - lastBB.lower) / (keltnerUpper - keltnerLower);
          squeezeScore = 1 - bbRatio; // Tighter = higher score
        }
      }

      outputs.push({
        key: 'squeeze_score',
        value: squeezeScore,
        normalized: squeezeScore,
        confidence: 0.9,
      });

      outputs.push({
        key: 'squeeze_flag',
        value: squeezeScore > 0.3,
        confidence: 0.9,
      });

    } catch (error: any) {
      console.error('[VolatilityProvider] Calculation error:', error.message);
    }

    return outputs;
  }

  private calculateEMA(values: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    return returns;
  }

  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateVolatilityOfVolatility(returns: number[], window: number): number {
    const vols: number[] = [];
    for (let i = 20; i <= returns.length; i++) {
      const windowReturns = returns.slice(i - 20, i);
      const vol = this.calculateStdDev(windowReturns);
      vols.push(vol);
    }
    return this.calculateStdDev(vols.slice(-window));
  }
}

export const volatilityProvider = new VolatilityIndicatorProvider();

console.log('[ExchangeAlt] Volatility Provider loaded');
