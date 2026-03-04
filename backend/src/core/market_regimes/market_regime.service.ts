/**
 * Market Regime Service (Phase 14C.2)
 * 
 * Detects and tracks market regimes for assets.
 */
import { MarketRegimeModel, IMarketRegime, MarketRegime, RegimeTimeframe, REGIME_THRESHOLDS, getTimeframeMs } from './market_regime.model.js';
import { PricePointModel, parsePrice } from '../market/price_points.model.js';
import { calculateVolatility, calculateTrend, calculateMaxDrawdown } from '../market/market_metrics.service.js';

/**
 * Detect market regime for an asset
 */
export async function detectRegime(
  assetAddress: string,
  chain: string,
  timeframe: RegimeTimeframe
): Promise<IMarketRegime | null> {
  const timeframeMs = getTimeframeMs(timeframe);
  const now = new Date();
  const from = new Date(now.getTime() - timeframeMs);
  
  // Fetch price points
  const pricePoints = await PricePointModel.find({
    chain,
    assetAddress: assetAddress.toLowerCase(),
    timestamp: { $gte: from, $lte: now },
  }).sort({ timestamp: 1 });
  
  if (pricePoints.length < 5) {
    return null; // Not enough data
  }
  
  // Extract prices
  const prices = pricePoints.map(p => parsePrice(p.priceUsd));
  
  // Calculate metrics
  const volatility = calculateVolatility(prices);
  const { slope: trendDirection, r2: trendStrength } = calculateTrend(prices);
  const maxDrawdown = calculateMaxDrawdown(prices);
  
  const priceStart = prices[0];
  const priceEnd = prices[prices.length - 1];
  const priceChangePercent = priceStart > 0 
    ? ((priceEnd - priceStart) / priceStart) * 100 
    : 0;
  
  // Determine regime
  let regime: MarketRegime;
  let regimeConfidence: number;
  
  // Check high volatility first (overrides other regimes)
  if (volatility > REGIME_THRESHOLDS.highVolatility) {
    regime = 'high_volatility';
    regimeConfidence = Math.min(1, volatility / REGIME_THRESHOLDS.highVolatility / 2);
  }
  // Check for strong trend
  else if (trendStrength > REGIME_THRESHOLDS.strongTrend && 
           Math.abs(priceChangePercent) > REGIME_THRESHOLDS.minTrendMove) {
    if (trendDirection > 0) {
      regime = 'trend_up';
    } else {
      regime = 'trend_down';
    }
    regimeConfidence = trendStrength;
  }
  // Otherwise range-bound
  else {
    regime = 'range';
    regimeConfidence = 1 - trendStrength; // Higher confidence when trend is weak
  }
  
  // Get previous regime
  const previous = await MarketRegimeModel.findOne({
    assetAddress: assetAddress.toLowerCase(),
    chain,
    timeframe,
  });
  
  const previousRegime = previous?.regime;
  const regimeChanged = previousRegime ? previousRegime !== regime : false;
  
  // Calculate validity
  const validityMs = REGIME_THRESHOLDS.validity[timeframe];
  
  // Upsert regime
  const marketRegime = await MarketRegimeModel.findOneAndUpdate(
    {
      assetAddress: assetAddress.toLowerCase(),
      chain,
      timeframe,
    },
    {
      $set: {
        regime,
        regimeConfidence,
        volatility,
        trendStrength,
        trendDirection,
        priceChangePercent,
        maxDrawdownPercent: maxDrawdown * 100,
        volatilityThreshold: REGIME_THRESHOLDS.highVolatility,
        trendThreshold: REGIME_THRESHOLDS.strongTrend,
        computedAt: now,
        validUntil: new Date(now.getTime() + validityMs),
        previousRegime,
        regimeChanged,
      },
    },
    { upsert: true, new: true }
  );
  
  return marketRegime;
}

/**
 * Get current regime for an asset
 */
export async function getRegime(
  assetAddress: string,
  chain: string = 'ethereum',
  timeframe: RegimeTimeframe = '4h'
): Promise<IMarketRegime | null> {
  const regime = await MarketRegimeModel.findOne({
    assetAddress: assetAddress.toLowerCase(),
    chain,
    timeframe,
  });
  
  // Check if valid
  if (regime && regime.validUntil > new Date()) {
    return regime;
  }
  
  // Recompute if expired or missing
  return detectRegime(assetAddress, chain, timeframe);
}

/**
 * Get regime modifier for confidence adjustment
 * Used in Phase 14C.3 - Regime-aware Validation
 */
export function getRegimeConfidenceModifier(regime: MarketRegime): number {
  const modifiers: Record<MarketRegime, number> = {
    'trend_up': 1.0,          // Normal penalty/reward
    'trend_down': 1.0,        // Normal penalty/reward
    'range': 0.7,             // Reduced penalty (harder to predict in range)
    'high_volatility': 0.5,   // Halved penalty (very hard to predict)
    'low_liquidity': 0.3,     // Minimal penalty (unreliable prices)
  };
  return modifiers[regime];
}

/**
 * Get regime-aware confidence impact
 * Modifies the base confidence impact based on market regime
 */
export async function getRegimeAwareConfidenceImpact(
  assetAddress: string,
  chain: string,
  baseImpact: number,
  reactionType: 'confirmed' | 'neutral' | 'failed'
): Promise<{ adjustedImpact: number; regime: MarketRegime | null; explanation: string }> {
  // Get current regime (use 4h as default context)
  const regimeData = await getRegime(assetAddress, chain, '4h');
  
  if (!regimeData) {
    return {
      adjustedImpact: baseImpact,
      regime: null,
      explanation: 'No market regime data available',
    };
  }
  
  const modifier = getRegimeConfidenceModifier(regimeData.regime);
  let adjustedImpact = baseImpact;
  let explanation = '';
  
  if (reactionType === 'failed') {
    // Only reduce penalty for failures, not rewards
    adjustedImpact = baseImpact * modifier;
    
    if (regimeData.regime === 'high_volatility') {
      explanation = 'Signal failed due to high market volatility - penalty reduced';
    } else if (regimeData.regime === 'range') {
      explanation = 'Signal failed in range-bound market - penalty reduced';
    } else if (regimeData.regime === 'low_liquidity') {
      explanation = 'Signal failed due to low liquidity conditions - minimal penalty';
    } else {
      explanation = `Signal failed in ${regimeData.regime} market`;
    }
  } else if (reactionType === 'confirmed') {
    // Bonus for confirmed in difficult conditions
    if (regimeData.regime === 'high_volatility' || regimeData.regime === 'range') {
      adjustedImpact = baseImpact * 1.2; // 20% bonus
      explanation = `Signal confirmed despite ${regimeData.regime} conditions - extra credit`;
    } else {
      explanation = `Signal confirmed in ${regimeData.regime} market`;
    }
  } else {
    explanation = `Neutral reaction in ${regimeData.regime} market`;
  }
  
  return {
    adjustedImpact,
    regime: regimeData.regime,
    explanation,
  };
}

/**
 * Get all regimes for multiple timeframes
 */
export async function getAllRegimes(
  assetAddress: string,
  chain: string = 'ethereum'
): Promise<Record<RegimeTimeframe, IMarketRegime | null>> {
  const timeframes: RegimeTimeframe[] = ['1h', '4h', '1d'];
  const result: Record<RegimeTimeframe, IMarketRegime | null> = {
    '1h': null,
    '4h': null,
    '1d': null,
  };
  
  for (const tf of timeframes) {
    result[tf] = await getRegime(assetAddress, chain, tf);
  }
  
  return result;
}

/**
 * Get regime change events (for alerts)
 */
export async function getRecentRegimeChanges(
  hours: number = 24,
  chain: string = 'ethereum'
): Promise<IMarketRegime[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return MarketRegimeModel.find({
    chain,
    regimeChanged: true,
    computedAt: { $gte: since },
  }).sort({ computedAt: -1 });
}
