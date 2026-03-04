/**
 * S10.3 — Market Regime Detector
 * 
 * Determines the structural state of the market.
 * Uses data from S10.1 (facts) and S10.2 (behavior).
 * 
 * NO signals, NO predictions — only structure description.
 */

import {
  MarketRegime,
  MarketRegimeState,
  RegimeMetrics,
  RegimeThresholds,
  DEFAULT_THRESHOLDS,
} from './regime.types.js';

/**
 * Main regime detection function
 */
export function detectMarketRegime(
  metrics: RegimeMetrics,
  thresholds: RegimeThresholds = DEFAULT_THRESHOLDS
): { regime: MarketRegime; confidence: number; drivers: string[] } {
  const {
    volumeDelta,
    oiDelta,
    priceDelta,
    priceDirection,
    orderFlowBias,
    absorptionActive,
    liquidationPressure,
  } = metrics;

  const candidates: Array<{ regime: MarketRegime; score: number; drivers: string[] }> = [];

  // ─────────────────────────────────────────────────────────────────
  // LONG SQUEEZE: OI ↓, Price ↓, Longs being liquidated
  // ─────────────────────────────────────────────────────────────────
  if (oiDelta < -thresholds.oiSignificantDelta && priceDirection === 'DOWN') {
    let score = 0.5;
    const drivers: string[] = ['OI ↓ (longs closing)', 'Price ↓'];
    
    if (liquidationPressure > 30) {
      score += 0.25;
      drivers.push(`Liquidation pressure ${liquidationPressure.toFixed(0)}%`);
    }
    if (orderFlowBias === 'SELL') {
      score += 0.15;
      drivers.push('Sellers aggressive');
    }
    candidates.push({ regime: 'LONG_SQUEEZE', score: Math.min(score, 1), drivers });
  }

  // ─────────────────────────────────────────────────────────────────
  // SHORT SQUEEZE: OI ↓, Price ↑, Shorts being liquidated
  // ─────────────────────────────────────────────────────────────────
  if (oiDelta < -thresholds.oiSignificantDelta && priceDirection === 'UP') {
    let score = 0.5;
    const drivers: string[] = ['OI ↓ (shorts closing)', 'Price ↑'];
    
    if (liquidationPressure > 30) {
      score += 0.25;
      drivers.push(`Liquidation pressure ${liquidationPressure.toFixed(0)}%`);
    }
    if (orderFlowBias === 'BUY') {
      score += 0.15;
      drivers.push('Buyers aggressive');
    }
    candidates.push({ regime: 'SHORT_SQUEEZE', score: Math.min(score, 1), drivers });
  }

  // ─────────────────────────────────────────────────────────────────
  // ACCUMULATION: Volume ↑, OI ↑, Price flat
  // ─────────────────────────────────────────────────────────────────
  if (
    volumeDelta > thresholds.volumeHighDelta &&
    oiDelta > thresholds.oiSignificantDelta &&
    Math.abs(priceDelta) < thresholds.priceFlat
  ) {
    let score = 0.6;
    const drivers: string[] = ['Volume ↑', 'OI ↑', 'Price stable'];
    
    if (absorptionActive) {
      score += 0.2;
      drivers.push('Absorption detected');
    }
    candidates.push({ regime: 'ACCUMULATION', score: Math.min(score, 1), drivers });
  }

  // ─────────────────────────────────────────────────────────────────
  // DISTRIBUTION: Volume ↑, OI ↓, Price flat
  // ─────────────────────────────────────────────────────────────────
  if (
    volumeDelta > thresholds.volumeHighDelta &&
    oiDelta < -thresholds.oiSignificantDelta &&
    Math.abs(priceDelta) < thresholds.priceFlat
  ) {
    let score = 0.6;
    const drivers: string[] = ['Volume ↑', 'OI ↓', 'Price stable'];
    
    if (absorptionActive) {
      score += 0.15;
      drivers.push('Absorption detected');
    }
    candidates.push({ regime: 'DISTRIBUTION', score: Math.min(score, 1), drivers });
  }

  // ─────────────────────────────────────────────────────────────────
  // EXPANSION: Volume ↑, OI ↑, Price trending
  // ─────────────────────────────────────────────────────────────────
  if (
    volumeDelta > thresholds.volumeHighDelta &&
    oiDelta > thresholds.oiSignificantDelta &&
    Math.abs(priceDelta) > thresholds.priceTrend
  ) {
    let score = 0.65;
    const drivers: string[] = ['Volume ↑', 'OI ↑', `Price ${priceDirection}`];
    
    // Healthy trend: flow matches direction
    if (
      (priceDirection === 'UP' && orderFlowBias === 'BUY') ||
      (priceDirection === 'DOWN' && orderFlowBias === 'SELL')
    ) {
      score += 0.2;
      drivers.push('Order flow confirms trend');
    }
    candidates.push({ regime: 'EXPANSION', score: Math.min(score, 1), drivers });
  }

  // ─────────────────────────────────────────────────────────────────
  // EXHAUSTION: Volume ↓, OI flat/↓, trend weakening
  // ─────────────────────────────────────────────────────────────────
  if (
    volumeDelta < thresholds.volumeLowDelta &&
    oiDelta <= thresholds.oiSignificantDelta &&
    Math.abs(priceDelta) > thresholds.priceFlat // Price still moving but on low volume
  ) {
    let score = 0.5;
    const drivers: string[] = ['Volume ↓', 'OI declining/flat', 'Trend weakening'];
    
    // Divergence: price moving but flow opposite
    if (
      (priceDirection === 'UP' && orderFlowBias === 'SELL') ||
      (priceDirection === 'DOWN' && orderFlowBias === 'BUY')
    ) {
      score += 0.25;
      drivers.push('Flow divergence detected');
    }
    candidates.push({ regime: 'EXHAUSTION', score: Math.min(score, 1), drivers });
  }

  // ─────────────────────────────────────────────────────────────────
  // NEUTRAL: Default fallback
  // ─────────────────────────────────────────────────────────────────
  candidates.push({
    regime: 'NEUTRAL',
    score: 0.3,
    drivers: ['No clear regime pattern'],
  });

  // Select highest scoring regime
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  // Only declare regime if confidence above threshold
  if (winner.score < thresholds.confidenceMin && winner.regime !== 'NEUTRAL') {
    return {
      regime: 'NEUTRAL',
      confidence: winner.score,
      drivers: [`Weak signal for ${winner.regime}`, ...winner.drivers],
    };
  }

  return {
    regime: winner.regime,
    confidence: winner.score,
    drivers: winner.drivers,
  };
}

/**
 * Helper: Determine price direction
 */
export function getPriceDirection(
  priceDelta: number,
  flatThreshold: number = 0.5
): 'UP' | 'DOWN' | 'FLAT' {
  if (priceDelta > flatThreshold) return 'UP';
  if (priceDelta < -flatThreshold) return 'DOWN';
  return 'FLAT';
}

/**
 * Get all alternative regimes with their scores
 */
export function getAlternativeRegimes(
  metrics: RegimeMetrics,
  thresholds: RegimeThresholds = DEFAULT_THRESHOLDS
): Array<{ regime: MarketRegime; confidence: number }> {
  const result = detectMarketRegime(metrics, thresholds);
  // For now, return simplified alternatives
  // In production, we'd track all candidates
  return [
    { regime: result.regime, confidence: result.confidence },
    { regime: 'NEUTRAL', confidence: 0.3 },
  ];
}
