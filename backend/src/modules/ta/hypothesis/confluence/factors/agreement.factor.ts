/**
 * Agreement Factor - Signal confirmations
 * 
 * Multiple signals agreeing = higher confidence
 * Divergences, candles, breakouts confirming pattern
 */

import { FactorResult, PatternInput, MarketContext } from '../confluence_types.js';
import { CONFLUENCE_WEIGHTS } from '../confluence_weights.js';

export function agreementFactor(pattern: PatternInput, context: MarketContext): FactorResult {
  const direction = pattern.direction;
  const reasons: string[] = [];
  
  let confirmations = 0;
  
  // RSI Divergence
  if (context.rsiDivergence) {
    confirmations++;
    reasons.push('rsi_divergence_confirm');
  }
  
  // MACD Divergence
  if (context.macdDivergence) {
    confirmations++;
    reasons.push('macd_divergence_confirm');
  }
  
  // Candle signal
  if (context.candleSignal) {
    // Check if candle aligns with pattern direction
    const bullCandles = ['HAMMER', 'ENGULFING_BULL', 'MORNING_STAR'];
    const bearCandles = ['SHOOTING_STAR', 'ENGULFING_BEAR', 'EVENING_STAR'];
    
    if ((direction === 'BULL' || direction === 'BOTH') && 
        bullCandles.some(c => context.candleSignal?.includes(c))) {
      confirmations++;
      reasons.push(`candle_bull:${context.candleSignal}`);
    } else if ((direction === 'BEAR' || direction === 'BOTH') && 
               bearCandles.some(c => context.candleSignal?.includes(c))) {
      confirmations++;
      reasons.push(`candle_bear:${context.candleSignal}`);
    }
  }
  
  // Breakout
  if (context.breakout) {
    confirmations++;
    reasons.push('breakout_confirm');
  }
  
  // Retest
  if (context.retest) {
    confirmations++;
    reasons.push('retest_confirm');
  }
  
  // Normalize: 3+ confirmations = perfect
  const value = Math.min(confirmations / 3, 1);
  
  if (confirmations === 0) {
    reasons.push('no_confirmations');
  }
  
  reasons.push(`total_confirmations=${confirmations}`);
  
  return {
    name: 'agreement',
    value,
    weight: CONFLUENCE_WEIGHTS.agreement,
    reason: reasons
  };
}
