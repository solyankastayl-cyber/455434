/**
 * VOLUME INDICATOR PROVIDER
 * ==========================
 * 
 * OBV, Volume Z-Score, VWAP Deviation, Accumulation/Distribution, Volume Profile
 */

import {
  OBV,
  ADL,
  VWAP,
  ForceIndex,
} from 'technicalindicators';

import type {
  IIndicatorProvider,
  IndicatorInput,
  IndicatorOutput,
  IndicatorCategory,
} from '../indicator.types.js';

export class VolumeIndicatorProvider implements IIndicatorProvider {
  readonly id = 'VOLUME';
  readonly category: IndicatorCategory = 'VOLUME';
  readonly requiredCandles = 30;
  readonly indicators = [
    'obv', 'obv_trend', 'adl', 'adl_trend',
    'vwap', 'vwap_deviation', 'volume_z',
    'volume_sma_ratio', 'force_index', 'volume_trend'
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
    const volumes = candles.map(c => c.volume);
    const lastPrice = closes[closes.length - 1];
    const lastVolume = volumes[volumes.length - 1];

    try {
      // OBV (On Balance Volume)
      const obvValues = OBV.calculate({
        close: closes,
        volume: volumes,
      });
      
      const lastObv = obvValues[obvValues.length - 1] ?? 0;
      const obvChange = obvValues.length > 10 
        ? (lastObv - obvValues[obvValues.length - 10]) / Math.abs(obvValues[obvValues.length - 10] || 1)
        : 0;

      outputs.push({
        key: 'obv',
        value: lastObv,
        confidence: 0.85,
      });
      
      outputs.push({
        key: 'obv_trend',
        value: obvChange,
        normalized: Math.tanh(obvChange * 5),
        confidence: 0.8,
      });

      // ADL (Accumulation/Distribution Line)
      const adlValues = ADL.calculate({
        high: highs,
        low: lows,
        close: closes,
        volume: volumes,
      });
      
      const lastAdl = adlValues[adlValues.length - 1] ?? 0;
      const adlChange = adlValues.length > 10
        ? (lastAdl - adlValues[adlValues.length - 10]) / Math.abs(adlValues[adlValues.length - 10] || 1)
        : 0;

      outputs.push({
        key: 'adl',
        value: lastAdl,
        confidence: 0.85,
      });
      
      outputs.push({
        key: 'adl_trend',
        value: adlChange,
        normalized: Math.tanh(adlChange * 5),
        confidence: 0.8,
      });

      // VWAP (Volume Weighted Average Price) - for intraday
      const vwapValues = VWAP.calculate({
        high: highs,
        low: lows,
        close: closes,
        volume: volumes,
      });
      
      const lastVwap = vwapValues[vwapValues.length - 1] ?? lastPrice;
      const vwapDeviation = ((lastPrice - lastVwap) / lastVwap) * 100;

      outputs.push({
        key: 'vwap',
        value: lastVwap,
        confidence: 0.85,
      });
      
      outputs.push({
        key: 'vwap_deviation',
        value: vwapDeviation,
        normalized: Math.tanh(vwapDeviation / 3), // 3% deviation is significant
        confidence: 0.85,
      });

      // Volume Z-Score
      const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const volStd = Math.sqrt(
        volumes.slice(-20).reduce((a, b) => a + Math.pow(b - avgVolume, 2), 0) / 20
      ) || 1;
      const volumeZ = (lastVolume - avgVolume) / volStd;

      outputs.push({
        key: 'volume_z',
        value: volumeZ,
        zScore: volumeZ,
        confidence: 0.9,
      });

      // Volume SMA Ratio (current vs 20-period average)
      const volumeSmaRatio = lastVolume / avgVolume;

      outputs.push({
        key: 'volume_sma_ratio',
        value: volumeSmaRatio,
        normalized: Math.tanh((volumeSmaRatio - 1) * 2), // 1 = normal, 2+ = high
        confidence: 0.9,
      });

      // Force Index (price change × volume)
      const forceIndexValues = ForceIndex.calculate({
        close: closes,
        volume: volumes,
        period: 13,
      });
      
      const lastForceIndex = forceIndexValues[forceIndexValues.length - 1] ?? 0;
      
      // Normalize force index
      const forceIndexMean = forceIndexValues.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const forceIndexStd = Math.sqrt(
        forceIndexValues.slice(-20).reduce((a, b) => a + Math.pow(b - forceIndexMean, 2), 0) / 20
      ) || 1;
      const forceIndexNorm = (lastForceIndex - forceIndexMean) / forceIndexStd;

      outputs.push({
        key: 'force_index',
        value: lastForceIndex,
        normalized: Math.tanh(forceIndexNorm),
        confidence: 0.8,
      });

      // Volume Trend (accumulation vs distribution)
      const volumeTrend = this.calculateVolumeTrend(candles.slice(-20));

      outputs.push({
        key: 'volume_trend',
        value: volumeTrend,
        normalized: volumeTrend,
        confidence: 0.85,
      });

      // Volume Anomaly Flag
      const volumeAnomaly = volumeZ > 2 || volumeZ < -1.5;
      
      outputs.push({
        key: 'volume_anomaly_flag',
        value: volumeAnomaly,
        confidence: 0.85,
      });

    } catch (error: any) {
      console.error('[VolumeProvider] Calculation error:', error.message);
    }

    return outputs;
  }

  private calculateVolumeTrend(
    candles: Array<{ open: number; close: number; volume: number }>
  ): number {
    let upVolume = 0;
    let downVolume = 0;
    
    for (const candle of candles) {
      if (candle.close >= candle.open) {
        upVolume += candle.volume;
      } else {
        downVolume += candle.volume;
      }
    }
    
    const totalVolume = upVolume + downVolume;
    if (totalVolume === 0) return 0;
    
    // -1 to +1 scale
    return (upVolume - downVolume) / totalVolume;
  }
}

export const volumeProvider = new VolumeIndicatorProvider();

console.log('[ExchangeAlt] Volume Provider loaded');
