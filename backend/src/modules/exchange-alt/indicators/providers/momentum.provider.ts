/**
 * MOMENTUM INDICATOR PROVIDER
 * ============================
 * 
 * RSI, MACD, Stochastic, ROC, Williams %R, CCI, MFI
 */

import {
  RSI,
  MACD,
  Stochastic,
  ROC,
  WilliamsR,
  CCI,
  MFI,
  StochasticRSI,
} from 'technicalindicators';

import type {
  IIndicatorProvider,
  IndicatorInput,
  IndicatorOutput,
  IndicatorCategory,
} from '../indicator.types.js';

export class MomentumIndicatorProvider implements IIndicatorProvider {
  readonly id = 'MOMENTUM';
  readonly category: IndicatorCategory = 'MOMENTUM';
  readonly requiredCandles = 50;
  readonly indicators = [
    'rsi_14', 'rsi_z', 'macd_histogram', 'macd_signal',
    'stoch_k', 'stoch_d', 'stoch_rsi', 'roc_10',
    'williams_r', 'cci_20', 'mfi_14', 'momentum_score'
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
    const volumes = candles.map((c: { volume: number }) => c.volume);

    try {
      // RSI 14
      const rsiValues = RSI.calculate({ values: closes, period: 14 });
      const rsi14 = rsiValues[rsiValues.length - 1] ?? 50;
      
      // RSI Z-Score (relative to recent values)
      const rsiMean = rsiValues.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const rsiStd = Math.sqrt(
        rsiValues.slice(-20).reduce((a, b) => a + Math.pow(b - rsiMean, 2), 0) / 20
      ) || 1;
      const rsiZ = (rsi14 - rsiMean) / rsiStd;

      outputs.push({
        key: 'rsi_14',
        value: rsi14,
        normalized: (rsi14 - 50) / 50, // -1 to +1
        confidence: 0.9,
      });
      
      outputs.push({
        key: 'rsi_z',
        value: rsiZ,
        zScore: rsiZ,
        confidence: 0.85,
      });

      // MACD
      const macdValues = MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      
      const lastMacd = macdValues[macdValues.length - 1];
      if (lastMacd) {
        outputs.push({
          key: 'macd_histogram',
          value: lastMacd.histogram ?? 0,
          normalized: Math.tanh((lastMacd.histogram ?? 0) / (closes[closes.length - 1] * 0.01)),
          confidence: 0.85,
        });
        
        outputs.push({
          key: 'macd_signal',
          value: lastMacd.signal ?? 0,
          confidence: 0.85,
        });
      }

      // Stochastic
      const stochValues = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
        signalPeriod: 3,
      });
      
      const lastStoch = stochValues[stochValues.length - 1];
      if (lastStoch) {
        outputs.push({
          key: 'stoch_k',
          value: lastStoch.k,
          normalized: (lastStoch.k - 50) / 50,
          confidence: 0.85,
        });
        
        outputs.push({
          key: 'stoch_d',
          value: lastStoch.d,
          normalized: (lastStoch.d - 50) / 50,
          confidence: 0.85,
        });
      }

      // Stochastic RSI
      const stochRsiValues = StochasticRSI.calculate({
        values: closes,
        rsiPeriod: 14,
        stochasticPeriod: 14,
        kPeriod: 3,
        dPeriod: 3,
      });
      
      const lastStochRsi = stochRsiValues[stochRsiValues.length - 1];
      if (lastStochRsi) {
        outputs.push({
          key: 'stoch_rsi',
          value: lastStochRsi.k,
          normalized: (lastStochRsi.k - 50) / 50,
          confidence: 0.8,
        });
      }

      // ROC (Rate of Change) 10
      const rocValues = ROC.calculate({ values: closes, period: 10 });
      const roc10 = rocValues[rocValues.length - 1] ?? 0;
      
      outputs.push({
        key: 'roc_10',
        value: roc10,
        normalized: Math.tanh(roc10 / 10), // scale to -1 to +1
        confidence: 0.85,
      });

      // Williams %R
      const willRValues = WilliamsR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
      });
      
      const willR = willRValues[willRValues.length - 1] ?? -50;
      outputs.push({
        key: 'williams_r',
        value: willR,
        normalized: (willR + 50) / 50, // -100 to 0 → -1 to +1
        confidence: 0.85,
      });

      // CCI 20
      const cciValues = CCI.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 20,
      });
      
      const cci20 = cciValues[cciValues.length - 1] ?? 0;
      outputs.push({
        key: 'cci_20',
        value: cci20,
        normalized: Math.tanh(cci20 / 200), // typical range -200 to +200
        confidence: 0.8,
      });

      // MFI 14 (Money Flow Index)
      const mfiValues = MFI.calculate({
        high: highs,
        low: lows,
        close: closes,
        volume: volumes,
        period: 14,
      });
      
      const mfi14 = mfiValues[mfiValues.length - 1] ?? 50;
      outputs.push({
        key: 'mfi_14',
        value: mfi14,
        normalized: (mfi14 - 50) / 50,
        confidence: 0.85,
      });

      // Composite Momentum Score
      const momentumScore = this.calculateMomentumScore(
        rsi14, lastStoch?.k ?? 50, roc10, willR, mfi14
      );
      
      outputs.push({
        key: 'momentum_score',
        value: momentumScore,
        normalized: momentumScore,
        confidence: 0.9,
      });

    } catch (error: any) {
      console.error('[MomentumProvider] Calculation error:', error.message);
    }

    return outputs;
  }

  private calculateMomentumScore(
    rsi: number,
    stochK: number,
    roc: number,
    willR: number,
    mfi: number
  ): number {
    // Normalize each to -1 to +1
    const rsiNorm = (rsi - 50) / 50;
    const stochNorm = (stochK - 50) / 50;
    const rocNorm = Math.tanh(roc / 10);
    const willNorm = (willR + 50) / 50;
    const mfiNorm = (mfi - 50) / 50;

    // Weighted average
    return (
      rsiNorm * 0.25 +
      stochNorm * 0.2 +
      rocNorm * 0.2 +
      willNorm * 0.15 +
      mfiNorm * 0.2
    );
  }
}

export const momentumProvider = new MomentumIndicatorProvider();

console.log('[ExchangeAlt] Momentum Provider loaded');
