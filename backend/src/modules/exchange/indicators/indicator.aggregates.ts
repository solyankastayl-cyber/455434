/**
 * S10.6I.7 — Indicator Aggregates
 * 
 * Temporary layer for Regimes & Patterns.
 * NOT stored in database — computed on the fly.
 * 
 * Aggregates = higher-level market state derived from 32 indicators.
 * Used ONLY inside Regimes / Patterns evaluation.
 */

import { StoredIndicatorValue, IndicatorsMeta } from '../observation/observation.types.js';
import { IndicatorSnapshot } from './indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// AGGREGATE TYPES
// ═══════════════════════════════════════════════════════════════

export interface MarketAggregates {
  /** Market stress level [0..1] */
  marketStress: number;
  
  /** Participation health [0..1] */
  participation: number;
  
  /** Momentum state [-1..+1] */
  momentumState: number;
  
  /** Price structure state [-1..+1] */
  structureState: number;
  
  /** Order book pressure [-1..+1] */
  orderbookPressure: number;
  
  /** Position crowding [0..1] */
  positionCrowding: number;
  
  /** Drivers explaining each aggregate */
  drivers: Record<string, string[]>;
  
  /** Meta info */
  computed: boolean;
  indicatorCount: number;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Safe get indicator value
// ═══════════════════════════════════════════════════════════════

function getIndicator(
  indicators: Record<string, StoredIndicatorValue>,
  id: string,
  defaultValue: number = 0
): number {
  const ind = indicators[id];
  if (!ind || typeof ind.value !== 'number' || isNaN(ind.value)) {
    return defaultValue;
  }
  return ind.value;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Clamp
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Weighted mean
// ═══════════════════════════════════════════════════════════════

function weightedMean(values: { value: number; weight: number }[]): number {
  const totalWeight = values.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((sum, v) => sum + v.value * v.weight, 0) / totalWeight;
}

// ═══════════════════════════════════════════════════════════════
// A) MARKET STRESS AGGREGATE
// Components: ATR_Normalized, LiquidityVacuumIndex, SpreadPressureIndex, FundingRatePressure
// ═══════════════════════════════════════════════════════════════

function computeMarketStress(
  indicators: Record<string, StoredIndicatorValue>
): { value: number; drivers: string[] } {
  const drivers: string[] = [];
  
  const atrNorm = getIndicator(indicators, 'atr_normalized', 1);
  const lvi = getIndicator(indicators, 'liquidity_vacuum', 0.5);
  const spi = getIndicator(indicators, 'spread_pressure', 0);
  const frp = Math.abs(getIndicator(indicators, 'funding_pressure', 0));
  
  // Normalize ATR (>1 = high volatility)
  const atrStress = clamp((atrNorm - 1) / 2 + 0.5, 0, 1);
  if (atrStress > 0.6) drivers.push('high_volatility');
  
  // LVI already [0..1]
  if (lvi > 0.6) drivers.push('liquidity_vacuum');
  
  // SPI already [0..1]
  if (spi > 0.5) drivers.push('spread_tension');
  
  // FRP absolute (extreme funding = stress)
  if (frp > 0.5) drivers.push('funding_extreme');
  
  const stress = weightedMean([
    { value: atrStress, weight: 0.3 },
    { value: lvi, weight: 0.3 },
    { value: spi, weight: 0.2 },
    { value: frp, weight: 0.2 },
  ]);
  
  return { value: clamp(stress, 0, 1), drivers };
}

// ═══════════════════════════════════════════════════════════════
// B) PARTICIPATION AGGREGATE
// Components: RelativeVolumeIndex, ParticipationIntensity, OI_Delta
// ═══════════════════════════════════════════════════════════════

function computeParticipation(
  indicators: Record<string, StoredIndicatorValue>
): { value: number; drivers: string[] } {
  const drivers: string[] = [];
  
  const rvi = getIndicator(indicators, 'relative_volume', 0);
  const pi = getIndicator(indicators, 'participation_intensity', 0.5);
  const oid = getIndicator(indicators, 'oi_delta', 0);
  
  // RVI: [-1..+1] → normalize to [0..1]
  const rviNorm = (rvi + 1) / 2;
  if (rviNorm > 0.6) drivers.push('volume_elevated');
  
  // PI already [0..1]
  if (pi > 0.6) drivers.push('intense_participation');
  
  // OID: [-1..+1] → use absolute for participation (both in/out = activity)
  const oidActivity = Math.abs(oid);
  if (oidActivity > 0.4) drivers.push('oi_moving');
  
  const participation = weightedMean([
    { value: rviNorm, weight: 0.35 },
    { value: pi, weight: 0.35 },
    { value: oidActivity, weight: 0.3 },
  ]);
  
  return { value: clamp(participation, 0, 1), drivers };
}

// ═══════════════════════════════════════════════════════════════
// C) MOMENTUM STATE AGGREGATE
// Components: RSI, MACD Δ, MomentumDecay, ROC
// ═══════════════════════════════════════════════════════════════

function computeMomentumState(
  indicators: Record<string, StoredIndicatorValue>
): { value: number; drivers: string[] } {
  const drivers: string[] = [];
  
  const rsi = getIndicator(indicators, 'rsi_normalized', 0);
  const macdDelta = getIndicator(indicators, 'macd_delta', 0);
  const momentumDecay = getIndicator(indicators, 'momentum_decay', 1);
  const roc = getIndicator(indicators, 'roc', 0);
  
  // RSI: [-1..+1]
  if (Math.abs(rsi) > 0.5) drivers.push(rsi > 0 ? 'momentum_up' : 'momentum_down');
  
  // MACD Delta: [-1..+1]
  if (macdDelta > 0.1) drivers.push('momentum_accelerating');
  else if (macdDelta < -0.1) drivers.push('momentum_decaying');
  
  // Momentum Decay: [0..3], <1 = decaying
  if (momentumDecay < 0.6) drivers.push('exhaustion_signal');
  else if (momentumDecay > 1.5) drivers.push('momentum_building');
  
  // ROC: [-2..+2]
  const rocNorm = clamp(roc / 2, -1, 1);
  
  const momentumState = weightedMean([
    { value: rsi, weight: 0.3 },
    { value: macdDelta, weight: 0.25 },
    { value: clamp((momentumDecay - 1) / 2, -1, 1), weight: 0.2 },
    { value: rocNorm, weight: 0.25 },
  ]);
  
  return { value: clamp(momentumState, -1, 1), drivers };
}

// ═══════════════════════════════════════════════════════════════
// D) STRUCTURE STATE AGGREGATE
// Components: EMA distances, VWAP dev, RangeCompression, TrendSlope
// ═══════════════════════════════════════════════════════════════

function computeStructureState(
  indicators: Record<string, StoredIndicatorValue>
): { value: number; drivers: string[] } {
  const drivers: string[] = [];
  
  const emaFast = getIndicator(indicators, 'ema_distance_fast', 0);
  const emaMid = getIndicator(indicators, 'ema_distance_mid', 0);
  const emaSlow = getIndicator(indicators, 'ema_distance_slow', 0);
  const vwapDev = getIndicator(indicators, 'vwap_deviation', 0);
  const rangeComp = getIndicator(indicators, 'range_compression', 1);
  const trendSlope = getIndicator(indicators, 'trend_slope', 0);
  
  // EMA alignment
  const emaAlignment = (emaFast + emaMid + emaSlow) / 3;
  if (emaAlignment > 0.5) drivers.push('ema_bullish_stack');
  else if (emaAlignment < -0.5) drivers.push('ema_bearish_stack');
  
  // VWAP deviation
  if (Math.abs(vwapDev) > 1) drivers.push(vwapDev > 0 ? 'vwap_premium' : 'vwap_discount');
  
  // Range compression (<0.6 = squeezed)
  if (rangeComp < 0.6) drivers.push('range_compressed');
  else if (rangeComp > 1.5) drivers.push('range_expanded');
  
  // Trend slope
  if (Math.abs(trendSlope) > 0.3) drivers.push(trendSlope > 0 ? 'uptrend' : 'downtrend');
  
  const structureState = weightedMean([
    { value: clamp(emaAlignment / 3, -1, 1), weight: 0.3 },
    { value: clamp(vwapDev / 3, -1, 1), weight: 0.2 },
    { value: clamp((rangeComp - 1) / 2, -1, 1), weight: 0.2 },
    { value: trendSlope, weight: 0.3 },
  ]);
  
  return { value: clamp(structureState, -1, 1), drivers };
}

// ═══════════════════════════════════════════════════════════════
// E) ORDER BOOK PRESSURE AGGREGATE
// Components: OBI, DDI, LWS, AbsorptionStrength
// ═══════════════════════════════════════════════════════════════

function computeOrderbookPressure(
  indicators: Record<string, StoredIndicatorValue>
): { value: number; drivers: string[] } {
  const drivers: string[] = [];
  
  const obi = getIndicator(indicators, 'book_imbalance', 0);
  const ddi = getIndicator(indicators, 'depth_density', 0.5);
  const lws = getIndicator(indicators, 'liquidity_walls', 0);
  const abs = getIndicator(indicators, 'absorption_strength', 0.5);
  
  // OBI: [-1..+1] — direct pressure direction
  if (obi > 0.3) drivers.push('bid_dominance');
  else if (obi < -0.3) drivers.push('ask_dominance');
  
  // DDI: [0..1] — density info
  if (ddi < 0.3) drivers.push('thin_market');
  else if (ddi > 0.6) drivers.push('dense_market');
  
  // LWS: [0..1] — walls presence
  if (lws > 0.6) drivers.push('strong_walls');
  
  // Absorption: [0..1] — how much is being absorbed
  if (abs > 0.7) drivers.push('high_absorption');
  else if (abs < 0.3) drivers.push('low_absorption');
  
  // Pressure is primarily OBI, modulated by depth
  const pressure = weightedMean([
    { value: obi, weight: 0.4 },
    { value: (ddi - 0.5) * 2, weight: 0.2 }, // Normalize DDI to [-1..+1]
    { value: lws * (obi > 0 ? 1 : -1), weight: 0.2 }, // Walls in direction of imbalance
    { value: (abs - 0.5) * 2, weight: 0.2 },
  ]);
  
  return { value: clamp(pressure, -1, 1), drivers };
}

// ═══════════════════════════════════════════════════════════════
// F) POSITION CROWDING AGGREGATE
// Components: OI_Level, Long/Short Ratio, Funding Pressure, OI_Delta
// ═══════════════════════════════════════════════════════════════

function computePositionCrowding(
  indicators: Record<string, StoredIndicatorValue>
): { value: number; drivers: string[] } {
  const drivers: string[] = [];
  
  const oil = getIndicator(indicators, 'oi_level', 0);
  const lsr = getIndicator(indicators, 'long_short_ratio', 0);
  const frp = getIndicator(indicators, 'funding_pressure', 0);
  const pci = getIndicator(indicators, 'position_crowding', 0.5);
  
  // Use the already-computed PCI from indicators
  // But also add context from components
  
  if (Math.abs(oil) > 0.3) drivers.push(oil > 0 ? 'oi_high' : 'oi_low');
  if (Math.abs(lsr) > 0.3) drivers.push(lsr > 0 ? 'crowd_long' : 'crowd_short');
  if (Math.abs(frp) > 0.5) drivers.push(frp > 0 ? 'funding_longs' : 'funding_shorts');
  
  if (pci > 0.7) drivers.push('squeeze_risk');
  
  return { value: clamp(pci, 0, 1), drivers };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Compute all aggregates
// ═══════════════════════════════════════════════════════════════

export function computeMarketAggregates(
  indicators: Record<string, StoredIndicatorValue>
): MarketAggregates {
  const indicatorCount = Object.keys(indicators).length;
  
  if (indicatorCount === 0) {
    return {
      marketStress: 0.5,
      participation: 0.5,
      momentumState: 0,
      structureState: 0,
      orderbookPressure: 0,
      positionCrowding: 0.5,
      drivers: {},
      computed: false,
      indicatorCount: 0,
      timestamp: Date.now(),
    };
  }
  
  const stress = computeMarketStress(indicators);
  const participation = computeParticipation(indicators);
  const momentum = computeMomentumState(indicators);
  const structure = computeStructureState(indicators);
  const orderbook = computeOrderbookPressure(indicators);
  const crowding = computePositionCrowding(indicators);
  
  return {
    marketStress: stress.value,
    participation: participation.value,
    momentumState: momentum.value,
    structureState: structure.value,
    orderbookPressure: orderbook.value,
    positionCrowding: crowding.value,
    drivers: {
      marketStress: stress.drivers,
      participation: participation.drivers,
      momentumState: momentum.drivers,
      structureState: structure.drivers,
      orderbookPressure: orderbook.drivers,
      positionCrowding: crowding.drivers,
    },
    computed: true,
    indicatorCount,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS FOR REGIMES
// ═══════════════════════════════════════════════════════════════

export function isAccumulationCondition(agg: MarketAggregates): boolean {
  return (
    agg.participation > 0.6 &&
    Math.abs(agg.structureState) < 0.3 &&
    agg.positionCrowding < 0.5
  );
}

export function isExhaustionCondition(agg: MarketAggregates): boolean {
  return (
    Math.abs(agg.momentumState) < 0.3 &&
    agg.participation < 0.4 &&
    agg.drivers.momentumState?.includes('exhaustion_signal')
  );
}

export function isSqueezeCondition(agg: MarketAggregates): boolean {
  return (
    agg.positionCrowding > 0.7 &&
    agg.marketStress > 0.6
  );
}

export function isExpansionCondition(agg: MarketAggregates): boolean {
  return (
    Math.abs(agg.structureState) > 0.5 &&
    Math.abs(agg.momentumState) > 0.5 &&
    agg.participation > 0.5
  );
}

export function isDistributionCondition(agg: MarketAggregates): boolean {
  return (
    agg.participation < 0.4 &&
    agg.positionCrowding > 0.6 &&
    agg.drivers.positionCrowding?.includes('oi_high')
  );
}

console.log('[S10.6I.7] Indicator Aggregates loaded');
