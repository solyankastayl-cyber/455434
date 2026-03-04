/**
 * DERIVATIVES INDICATOR PROVIDER
 * ===============================
 * 
 * Funding Rate, Open Interest, Long/Short Ratio, Liquidations
 */

import type {
  IIndicatorProvider,
  IndicatorInput,
  IndicatorOutput,
  IndicatorCategory,
} from '../indicator.types.js';
import { ALT_THRESHOLDS } from '../../constants.js';

export class DerivativesIndicatorProvider implements IIndicatorProvider {
  readonly id = 'DERIVATIVES';
  readonly category: IndicatorCategory = 'DERIVATIVES';
  readonly requiredCandles = 1; // Primarily uses derivatives snapshot
  readonly indicators = [
    'funding_rate', 'funding_z', 'oi_change_1h', 'oi_z',
    'long_share', 'long_bias', 'liq_imbalance', 'liq_z',
    'basis', 'crowded_trade_flag', 'funding_flip_flag'
  ];

  // Historical data for Z-score calculation (in-memory cache)
  private fundingHistory: Map<string, number[]> = new Map();
  private oiHistory: Map<string, number[]> = new Map();
  private liqHistory: Map<string, number[]> = new Map();

  async calculate(input: IndicatorInput): Promise<IndicatorOutput[]> {
    const outputs: IndicatorOutput[] = [];
    const { symbol, derivatives } = input;
    
    if (!derivatives) {
      // Return empty with low confidence
      return this.getEmptyDerivativesOutput();
    }

    try {
      // ═══════════════════════════════════════════════════════════
      // FUNDING RATE
      // ═══════════════════════════════════════════════════════════
      
      const fundingRate = derivatives.fundingRate ?? 0;
      
      // Update history for Z-score
      this.updateHistory(this.fundingHistory, symbol, fundingRate);
      const fundingZ = this.calculateZScore(this.fundingHistory, symbol, fundingRate);

      outputs.push({
        key: 'funding_rate',
        value: fundingRate,
        normalized: Math.tanh(fundingRate * 10000), // 0.01% = 0.0001 → ~0.1
        confidence: 0.9,
      });
      
      outputs.push({
        key: 'funding_z',
        value: fundingZ,
        zScore: fundingZ,
        confidence: 0.85,
      });

      // ═══════════════════════════════════════════════════════════
      // OPEN INTEREST
      // ═══════════════════════════════════════════════════════════
      
      const oiChange1h = derivatives.openInterestDelta1h ?? 0;
      const oi = derivatives.openInterest ?? 0;
      
      // Update history for Z-score
      this.updateHistory(this.oiHistory, symbol, oi);
      const oiZ = this.calculateZScore(this.oiHistory, symbol, oi);

      outputs.push({
        key: 'oi_change_1h',
        value: oiChange1h,
        normalized: Math.tanh(oiChange1h / 10), // 10% change is significant
        confidence: 0.85,
      });
      
      outputs.push({
        key: 'oi_z',
        value: oiZ,
        zScore: oiZ,
        confidence: 0.8,
      });

      // ═══════════════════════════════════════════════════════════
      // LONG/SHORT RATIO
      // ═══════════════════════════════════════════════════════════
      
      const longShortRatio = derivatives.longShortRatio ?? 0.5;
      // Normalize: ratio could be 0.3-0.7 for share, or 0.5-2.0 for ratio
      // Assuming share format (0-1 where 0.5 is neutral)
      const longShare = longShortRatio > 1 ? longShortRatio / (1 + longShortRatio) : longShortRatio;
      const longBias = (longShare - 0.5) * 2; // -1 to +1

      outputs.push({
        key: 'long_share',
        value: longShare,
        normalized: longShare,
        confidence: 0.85,
      });
      
      outputs.push({
        key: 'long_bias',
        value: longBias,
        normalized: longBias,
        confidence: 0.85,
      });

      // ═══════════════════════════════════════════════════════════
      // LIQUIDATIONS
      // ═══════════════════════════════════════════════════════════
      
      const liqBuyUsd = derivatives.liquidationBuyUsd ?? 0;
      const liqSellUsd = derivatives.liquidationSellUsd ?? 0;
      const totalLiq = liqBuyUsd + liqSellUsd;
      
      // Imbalance: positive = more shorts liquidated (bullish)
      const liqImbalance = totalLiq > 0 
        ? (liqBuyUsd - liqSellUsd) / totalLiq 
        : 0;

      // Update history for Z-score
      this.updateHistory(this.liqHistory, symbol, totalLiq);
      const liqZ = this.calculateZScore(this.liqHistory, symbol, totalLiq);

      outputs.push({
        key: 'liq_imbalance',
        value: liqImbalance,
        normalized: liqImbalance,
        confidence: 0.8,
      });
      
      outputs.push({
        key: 'liq_z',
        value: liqZ,
        zScore: liqZ,
        confidence: 0.75,
      });

      // ═══════════════════════════════════════════════════════════
      // BASIS (Futures vs Spot premium)
      // ═══════════════════════════════════════════════════════════
      
      const basis = derivatives.basis ?? 0;

      outputs.push({
        key: 'basis',
        value: basis,
        normalized: Math.tanh(basis * 500), // 0.2% basis = 0.002 → ~0.7
        confidence: 0.85,
      });

      // ═══════════════════════════════════════════════════════════
      // DERIVED FLAGS
      // ═══════════════════════════════════════════════════════════
      
      // Crowded Trade (extreme positioning)
      const crowdedTrade = longShare > ALT_THRESHOLDS.crowdedLongShare || 
                          longShare < ALT_THRESHOLDS.crowdedShortShare;

      outputs.push({
        key: 'crowded_trade_flag',
        value: crowdedTrade,
        confidence: 0.85,
      });

      // Funding Flip (funding opposite to position bias)
      const fundingFlip = (fundingZ > ALT_THRESHOLDS.highFundingZ && longBias < 0) ||
                         (fundingZ < ALT_THRESHOLDS.lowFundingZ && longBias > 0);

      outputs.push({
        key: 'funding_flip_flag',
        value: fundingFlip,
        confidence: 0.8,
      });

      // Cascade Risk (high liquidations + extreme positioning)
      const cascadeRisk = Math.min(1, (Math.abs(liqZ) / 3) * (crowdedTrade ? 1.5 : 1));

      outputs.push({
        key: 'cascade_risk',
        value: cascadeRisk,
        normalized: cascadeRisk,
        confidence: 0.75,
      });

    } catch (error: any) {
      console.error('[DerivativesProvider] Calculation error:', error.message);
    }

    return outputs;
  }

  private getEmptyDerivativesOutput(): IndicatorOutput[] {
    return [
      { key: 'funding_rate', value: 0, normalized: 0, confidence: 0.1 },
      { key: 'funding_z', value: 0, zScore: 0, confidence: 0.1 },
      { key: 'oi_change_1h', value: 0, normalized: 0, confidence: 0.1 },
      { key: 'oi_z', value: 0, zScore: 0, confidence: 0.1 },
      { key: 'long_share', value: 0.5, normalized: 0.5, confidence: 0.1 },
      { key: 'long_bias', value: 0, normalized: 0, confidence: 0.1 },
      { key: 'liq_imbalance', value: 0, normalized: 0, confidence: 0.1 },
      { key: 'liq_z', value: 0, zScore: 0, confidence: 0.1 },
      { key: 'basis', value: 0, normalized: 0, confidence: 0.1 },
      { key: 'crowded_trade_flag', value: false, confidence: 0.1 },
      { key: 'funding_flip_flag', value: false, confidence: 0.1 },
      { key: 'cascade_risk', value: 0, normalized: 0, confidence: 0.1 },
    ];
  }

  private updateHistory(
    historyMap: Map<string, number[]>,
    symbol: string,
    value: number,
    maxLength = 100
  ): void {
    const history = historyMap.get(symbol) ?? [];
    history.push(value);
    if (history.length > maxLength) {
      history.shift();
    }
    historyMap.set(symbol, history);
  }

  private calculateZScore(
    historyMap: Map<string, number[]>,
    symbol: string,
    currentValue: number
  ): number {
    const history = historyMap.get(symbol) ?? [];
    if (history.length < 10) return 0;
    
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const std = Math.sqrt(
      history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length
    ) || 1;
    
    return (currentValue - mean) / std;
  }

  // Clear history (for testing or reset)
  clearHistory(): void {
    this.fundingHistory.clear();
    this.oiHistory.clear();
    this.liqHistory.clear();
  }
}

export const derivativesProvider = new DerivativesIndicatorProvider();

console.log('[ExchangeAlt] Derivatives Provider loaded');
