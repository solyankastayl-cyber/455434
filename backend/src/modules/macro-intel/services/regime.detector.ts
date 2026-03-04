/**
 * Market Regime Detector
 * 
 * Core logic for detecting which of 8 market regimes we're in
 * based on trend analysis of BTC, dominance, and alt markets.
 */

import {
  MarketRegime,
  MacroTrend,
  TrendValue,
  MacroTrends,
  MacroTrendValues,
  MacroRawData,
  RiskLevel,
  StablecoinPressure,
  MarketBias,
  MacroFlags,
  MACRO_INTEL_THRESHOLDS,
  REGIME_DEFINITIONS,
} from '../contracts/macro-intel.types.js';

/**
 * Convert percentage change to trend direction
 */
export function detectTrend(change: number): MacroTrend {
  if (change > MACRO_INTEL_THRESHOLDS.TREND_UP_THRESHOLD) return 'UP';
  if (change < MACRO_INTEL_THRESHOLDS.TREND_DOWN_THRESHOLD) return 'DOWN';
  return 'FLAT';
}

/**
 * Convert trend to numeric value for ML
 */
export function trendToValue(trend: MacroTrend): TrendValue {
  if (trend === 'UP') return 1;
  if (trend === 'DOWN') return -1;
  return 0;
}

/**
 * Detect all trends from raw data
 */
export function detectAllTrends(raw: MacroRawData): { trends: MacroTrends; trendValues: MacroTrendValues } {
  const btcDominance = detectTrend(raw.btcDominanceChange24h);
  const stableDominance = detectTrend(raw.stableDominanceChange24h);
  const btcPrice = detectTrend(raw.btcPriceChange24h);
  const altMarket = detectTrend(raw.altMarketChange24h);

  return {
    trends: {
      btcDominance,
      stableDominance,
      btcPrice,
      altMarket,
    },
    trendValues: {
      btcDominanceTrend: trendToValue(btcDominance),
      stableDominanceTrend: trendToValue(stableDominance),
      btcPriceTrend: trendToValue(btcPrice),
      altMarketTrend: trendToValue(altMarket),
    },
  };
}

/**
 * Detect market regime based on trends
 * 
 * PRIMARY LOGIC:
 * - BTC.D ↑ + BTC ↑ → BTC_FLIGHT_TO_SAFETY
 * - BTC.D ↑ + BTC ↓ → PANIC_SELL_OFF
 * - BTC.D ↓ + BTC ↑ → ALT_ROTATION
 * - BTC.D ↓ + BTC ↓ → FULL_RISK_OFF
 * 
 * SECONDARY (ALT-based):
 * - BTC.D ↑ + ALT ↑ → BTC_LEADS_ALT_FOLLOW
 * - BTC.D ↑ + ALT ↓ → BTC_MAX_PRESSURE
 * - BTC.D ↓ + ALT ↑ → ALT_SEASON
 * - BTC.D ↓ + ALT ↓ → CAPITAL_EXIT
 */
export function detectRegime(trends: MacroTrends): MarketRegime {
  const { btcDominance, btcPrice, altMarket } = trends;

  // Primary detection: BTC.D + BTC Price
  if (btcDominance === 'UP') {
    if (btcPrice === 'UP') return MarketRegime.BTC_FLIGHT_TO_SAFETY;
    if (btcPrice === 'DOWN') return MarketRegime.PANIC_SELL_OFF;
    
    // If BTC price FLAT, check alt market
    if (altMarket === 'UP') return MarketRegime.BTC_LEADS_ALT_FOLLOW;
    if (altMarket === 'DOWN') return MarketRegime.BTC_MAX_PRESSURE;
    
    // Default for BTC.D UP
    return MarketRegime.BTC_FLIGHT_TO_SAFETY;
  }
  
  // BTC.D DOWN scenarios
  if (btcDominance === 'DOWN') {
    if (btcPrice === 'UP') return MarketRegime.ALT_ROTATION;
    if (btcPrice === 'DOWN') return MarketRegime.FULL_RISK_OFF;
    
    // If BTC price FLAT, check alt market
    if (altMarket === 'UP') return MarketRegime.ALT_SEASON;
    if (altMarket === 'DOWN') return MarketRegime.CAPITAL_EXIT;
    
    // Default for BTC.D DOWN
    return MarketRegime.ALT_ROTATION;
  }
  
  // BTC.D FLAT - use alt market as primary signal
  if (altMarket === 'UP') return MarketRegime.ALT_SEASON;
  if (altMarket === 'DOWN') return MarketRegime.CAPITAL_EXIT;
  
  // Neutral - default to low-risk state
  return MarketRegime.BTC_FLIGHT_TO_SAFETY;
}

/**
 * Detect stablecoin pressure
 */
export function detectStablecoinPressure(stableTrend: MacroTrend): StablecoinPressure {
  if (stableTrend === 'UP') return 'RISK_OFF';
  if (stableTrend === 'DOWN') return 'RISK_ON';
  return 'NEUTRAL';
}

/**
 * Adjust risk level based on Fear & Greed and Stablecoin pressure
 */
export function adjustRiskLevel(
  baseRisk: RiskLevel,
  fearGreed: number,
  stablePressure: StablecoinPressure
): RiskLevel {
  const riskOrder: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
  let riskIndex = riskOrder.indexOf(baseRisk);
  
  // Extreme Fear escalates risk
  if (fearGreed <= MACRO_INTEL_THRESHOLDS.EXTREME_FEAR_THRESHOLD) {
    riskIndex = Math.min(3, riskIndex + 1);
  }
  
  // RISK_OFF stablecoin pressure escalates risk
  if (stablePressure === 'RISK_OFF') {
    riskIndex = Math.min(3, riskIndex + 1);
  }
  
  // Extreme Greed adds risk (potential reversal)
  if (fearGreed >= MACRO_INTEL_THRESHOLDS.EXTREME_GREED_THRESHOLD) {
    riskIndex = Math.min(3, riskIndex + 1);
  }
  
  return riskOrder[riskIndex];
}

/**
 * Calculate confidence multiplier
 */
export function calculateConfidenceMultiplier(
  regime: MarketRegime,
  fearGreed: number,
  stablePressure: StablecoinPressure
): number {
  // Start with regime base multiplier
  let multiplier = REGIME_DEFINITIONS[regime].confidenceMultiplier;
  
  // Fear & Greed adjustments
  if (fearGreed <= MACRO_INTEL_THRESHOLDS.EXTREME_FEAR_THRESHOLD) {
    multiplier *= 0.8; // -20% for extreme fear
  } else if (fearGreed <= MACRO_INTEL_THRESHOLDS.FEAR_THRESHOLD) {
    multiplier *= 0.9; // -10% for fear
  } else if (fearGreed >= MACRO_INTEL_THRESHOLDS.EXTREME_GREED_THRESHOLD) {
    multiplier *= 0.85; // -15% for extreme greed (bubble risk)
  }
  
  // Stablecoin pressure adjustments
  if (stablePressure === 'RISK_OFF') {
    multiplier *= 0.9; // -10% for capital flight
  }
  
  // Clamp to bounds
  return Math.max(
    MACRO_INTEL_THRESHOLDS.MIN_CONFIDENCE_MULTIPLIER,
    Math.min(MACRO_INTEL_THRESHOLDS.MAX_CONFIDENCE_MULTIPLIER, multiplier)
  );
}

/**
 * Generate macro flags
 */
export function generateFlags(
  regime: MarketRegime,
  fearGreed: number,
  stablePressure: StablecoinPressure
): MacroFlags {
  const flags: MacroFlags = {
    MACRO_PANIC: false,
    RISK_OFF: false,
    ALT_SEASON: false,
    FLIGHT_TO_BTC: false,
    CAPITAL_EXIT: false,
    LIQUIDITY_FLIGHT: false,
    EXTREME_FEAR: false,
    EXTREME_GREED: false,
  };
  
  // Regime-based flags
  if (regime === MarketRegime.PANIC_SELL_OFF) {
    flags.MACRO_PANIC = true;
    flags.RISK_OFF = true;
  }
  
  if (regime === MarketRegime.FULL_RISK_OFF) {
    flags.RISK_OFF = true;
  }
  
  if (regime === MarketRegime.ALT_SEASON || regime === MarketRegime.ALT_ROTATION) {
    flags.ALT_SEASON = true;
  }
  
  if (regime === MarketRegime.BTC_FLIGHT_TO_SAFETY || regime === MarketRegime.BTC_MAX_PRESSURE) {
    flags.FLIGHT_TO_BTC = true;
  }
  
  if (regime === MarketRegime.CAPITAL_EXIT) {
    flags.CAPITAL_EXIT = true;
    flags.RISK_OFF = true;
  }
  
  // Fear & Greed flags
  if (fearGreed <= MACRO_INTEL_THRESHOLDS.EXTREME_FEAR_THRESHOLD) {
    flags.EXTREME_FEAR = true;
    flags.RISK_OFF = true;
  }
  
  if (fearGreed >= MACRO_INTEL_THRESHOLDS.EXTREME_GREED_THRESHOLD) {
    flags.EXTREME_GREED = true;
  }
  
  // Stablecoin pressure flags
  if (stablePressure === 'RISK_OFF') {
    flags.LIQUIDITY_FLIGHT = true;
    flags.RISK_OFF = true;
  }
  
  return flags;
}

/**
 * Determine market bias
 */
export function determineMarketBias(
  regime: MarketRegime,
  flags: MacroFlags
): MarketBias {
  // Override for extreme conditions
  if (flags.MACRO_PANIC || flags.CAPITAL_EXIT) {
    return 'DEFENSIVE';
  }
  
  // Use regime definition
  return REGIME_DEFINITIONS[regime].marketBias;
}

console.log('[RegimeDetector] Loaded');
