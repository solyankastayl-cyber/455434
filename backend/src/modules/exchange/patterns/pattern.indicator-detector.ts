/**
 * S10.6I.7 — Indicator-driven Pattern Detector
 * 
 * Detects market patterns ONLY using Indicators Layer.
 * 
 * PRINCIPLES:
 * - Pattern = repeatable market form
 * - Pattern ≠ signal, ≠ prediction
 * - Stability window >= 5 (no single-tick patterns)
 * - Drivers explain why pattern was detected
 */

import { StoredIndicatorValue } from '../observation/observation.types.js';
import { MarketAggregates, computeMarketAggregates } from '../indicators/indicator.aggregates.js';
import { MarketRegime } from '../regimes/regime.types.js';

// ═══════════════════════════════════════════════════════════════
// PATTERN DETECTION TYPES
// ═══════════════════════════════════════════════════════════════

export type PatternCategory = 'FLOW' | 'VOLUME' | 'LIQUIDATION' | 'STRUCTURE';

export interface IndicatorPatternDetection {
  id: string;
  name: string;
  category: PatternCategory;
  confidence: number;       // 0..1
  stability: number;        // hits / window
  drivers: string[];        // human-readable
  indicatorsUsed: string[]; // indicator IDs
  regimeContext?: MarketRegime[];
  direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// STABILITY TRACKING
// ═══════════════════════════════════════════════════════════════

const STABILITY_WINDOW = 5;
const patternHistory: Map<string, Map<string, boolean[]>> = new Map();

function getPatternStability(symbol: string, patternId: string): number {
  const symbolHistory = patternHistory.get(symbol);
  if (!symbolHistory) return 0;
  
  const history = symbolHistory.get(patternId);
  if (!history || history.length === 0) return 0;
  
  const hits = history.filter(h => h).length;
  return hits / history.length;
}

function updatePatternHistory(symbol: string, patternId: string, detected: boolean): void {
  if (!patternHistory.has(symbol)) {
    patternHistory.set(symbol, new Map());
  }
  
  const symbolHistory = patternHistory.get(symbol)!;
  if (!symbolHistory.has(patternId)) {
    symbolHistory.set(patternId, []);
  }
  
  const history = symbolHistory.get(patternId)!;
  history.push(detected);
  
  // Keep only last STABILITY_WINDOW entries
  while (history.length > STABILITY_WINDOW) {
    history.shift();
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get indicator value
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
// 1. ABSORPTION_TRAP
// Aggression present, price not moving — someone absorbing volume
// ═══════════════════════════════════════════════════════════════

function detectAbsorptionTrap(
  symbol: string,
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): IndicatorPatternDetection | null {
  const patternId = 'ABSORPTION_TRAP';
  const drivers: string[] = [];
  const indicatorsUsed: string[] = [];
  let score = 0;
  
  // Volume Delta high (aggression)
  const volumeDelta = getIndicator(indicators, 'volume_delta', 0);
  indicatorsUsed.push('volume_delta');
  if (Math.abs(volumeDelta) > 0.3) {
    score += 0.25;
    drivers.push('high_aggression');
  }
  
  // Volume vs Price Response low (price not responding)
  const vpr = getIndicator(indicators, 'volume_price_response', 0.5);
  indicatorsUsed.push('volume_price_response');
  if (vpr < 0.3) {
    score += 0.3;
    drivers.push('low_price_response');
  }
  
  // Absorption Strength high
  const absStrength = getIndicator(indicators, 'absorption_strength', 0.5);
  indicatorsUsed.push('absorption_strength');
  if (absStrength > 0.6) {
    score += 0.25;
    drivers.push('strong_absorption');
  }
  
  // OBI not confirming movement direction
  const obi = getIndicator(indicators, 'book_imbalance', 0);
  indicatorsUsed.push('book_imbalance');
  const directionMismatch = (volumeDelta > 0 && obi < 0.2) || (volumeDelta < 0 && obi > -0.2);
  if (directionMismatch) {
    score += 0.2;
    drivers.push('direction_mismatch');
  }
  
  // Update history
  const detected = score >= 0.6;
  updatePatternHistory(symbol, patternId, detected);
  
  // Check stability (≥3 из последних 5)
  const stability = getPatternStability(symbol, patternId);
  
  if (stability < 0.6) { // Need at least 3/5
    return null;
  }
  
  return {
    id: patternId,
    name: 'Absorption Trap',
    category: 'FLOW',
    confidence: Math.min(0.9, score),
    stability,
    drivers,
    indicatorsUsed,
    direction: 'NEUTRAL',
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. LIQUIDITY_VACUUM_BREAK
// Market is empty — price can fly through without resistance
// ═══════════════════════════════════════════════════════════════

function detectLiquidityVacuumBreak(
  symbol: string,
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates,
  currentRegime?: MarketRegime
): IndicatorPatternDetection | null {
  const patternId = 'LIQUIDITY_VACUUM_BREAK';
  const drivers: string[] = [];
  const indicatorsUsed: string[] = [];
  let score = 0;
  
  // Liquidity Vacuum Index high
  const lvi = getIndicator(indicators, 'liquidity_vacuum', 0.5);
  indicatorsUsed.push('liquidity_vacuum');
  if (lvi > 0.6) {
    score += 0.35;
    drivers.push('liquidity_vacuum');
  }
  
  // Depth Density low (thin market)
  const ddi = getIndicator(indicators, 'depth_density', 0.5);
  indicatorsUsed.push('depth_density');
  if (ddi < 0.3) {
    score += 0.3;
    drivers.push('thin_book');
  }
  
  // Spread Pressure high
  const spi = getIndicator(indicators, 'spread_pressure', 0);
  indicatorsUsed.push('spread_pressure');
  if (spi > 0.5) {
    score += 0.25;
    drivers.push('spread_pressure');
  }
  
  // Context: regime ≠ ACCUMULATION
  if (currentRegime && currentRegime !== 'ACCUMULATION') {
    score += 0.1;
  }
  
  // Update history
  const detected = score >= 0.6;
  updatePatternHistory(symbol, patternId, detected);
  
  const stability = getPatternStability(symbol, patternId);
  
  if (stability < 0.4) { // This pattern can be more transient
    return null;
  }
  
  return {
    id: patternId,
    name: 'Liquidity Vacuum Break',
    category: 'STRUCTURE',
    confidence: Math.min(0.85, score),
    stability,
    drivers,
    indicatorsUsed,
    regimeContext: currentRegime ? [currentRegime] : undefined,
    direction: 'NEUTRAL',
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. EXHAUSTION_TOP / EXHAUSTION_BOTTOM
// Momentum still present but participation dying
// ═══════════════════════════════════════════════════════════════

function detectExhaustion(
  symbol: string,
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): IndicatorPatternDetection | null {
  const patternId = 'EXHAUSTION';
  const drivers: string[] = [];
  const indicatorsUsed: string[] = [];
  let score = 0;
  
  // Momentum state high (still moving)
  indicatorsUsed.push('rsi_normalized', 'roc');
  if (Math.abs(agg.momentumState) > 0.4) {
    score += 0.2;
    drivers.push(agg.momentumState > 0 ? 'momentum_up' : 'momentum_down');
  }
  
  // Momentum Decay high (but decaying)
  const momentumDecay = getIndicator(indicators, 'momentum_decay', 1);
  indicatorsUsed.push('momentum_decay');
  if (momentumDecay < 0.6) {
    score += 0.3;
    drivers.push('momentum_decay');
  }
  
  // Low participation
  if (agg.participation < 0.4) {
    score += 0.25;
    drivers.push('low_participation');
  }
  
  // High absorption
  const absStrength = getIndicator(indicators, 'absorption_strength', 0.5);
  indicatorsUsed.push('absorption_strength');
  if (absStrength > 0.5) {
    score += 0.15;
    drivers.push('absorption');
  }
  
  // DMB diverging from momentum
  const dmb = getIndicator(indicators, 'directional_momentum_balance', 0);
  indicatorsUsed.push('directional_momentum_balance');
  const divergence = (agg.momentumState > 0 && dmb < 0) || (agg.momentumState < 0 && dmb > 0);
  if (divergence) {
    score += 0.1;
    drivers.push('dmb_divergence');
  }
  
  // Update history
  const detected = score >= 0.55;
  updatePatternHistory(symbol, patternId, detected);
  
  const stability = getPatternStability(symbol, patternId);
  
  if (stability < 0.6) {
    return null;
  }
  
  // Determine direction (TOP or BOTTOM)
  const direction: 'BULLISH' | 'BEARISH' = agg.momentumState > 0 ? 'BEARISH' : 'BULLISH';
  const name = agg.momentumState > 0 ? 'Exhaustion Top' : 'Exhaustion Bottom';
  
  return {
    id: patternId,
    name,
    category: 'VOLUME',
    confidence: Math.min(0.85, score),
    stability,
    drivers,
    indicatorsUsed,
    direction,
  };
}

// ═══════════════════════════════════════════════════════════════
// 4. CROWDING_SQUEEZE_RISK
// Market overcrowded — any move is dangerous
// ═══════════════════════════════════════════════════════════════

function detectCrowdingSqueezeRisk(
  symbol: string,
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates,
  currentRegime?: MarketRegime
): IndicatorPatternDetection | null {
  const patternId = 'CROWDING_SQUEEZE_RISK';
  const drivers: string[] = [];
  const indicatorsUsed: string[] = [];
  let score = 0;
  
  // Position Crowding Index high
  const pci = getIndicator(indicators, 'position_crowding', 0.5);
  indicatorsUsed.push('position_crowding');
  if (pci > 0.7) {
    score += 0.35;
    drivers.push('crowding');
  }
  
  // Funding Rate Pressure in same direction
  const frp = getIndicator(indicators, 'funding_pressure', 0);
  indicatorsUsed.push('funding_pressure');
  if (Math.abs(frp) > 0.5) {
    score += 0.25;
    drivers.push('funding_pressure');
  }
  
  // OI Delta not growing (stagnation or decline)
  const oiDelta = getIndicator(indicators, 'oi_delta', 0);
  indicatorsUsed.push('oi_delta');
  if (oiDelta < 0.1) {
    score += 0.2;
    drivers.push('oi_stagnation');
  }
  
  // Market stress elevated
  if (agg.marketStress > 0.5) {
    score += 0.15;
    drivers.push('elevated_stress');
  }
  
  // Context: regime = SQUEEZE or EXPANSION
  const squeezeContext = currentRegime && 
    ['LONG_SQUEEZE', 'SHORT_SQUEEZE', 'EXPANSION'].includes(currentRegime);
  if (squeezeContext) {
    score += 0.05;
  }
  
  // Update history
  const detected = score >= 0.6;
  updatePatternHistory(symbol, patternId, detected);
  
  const stability = getPatternStability(symbol, patternId);
  
  if (stability < 0.6) {
    return null;
  }
  
  // Direction based on LSR
  const lsr = getIndicator(indicators, 'long_short_ratio', 0);
  const direction: 'BULLISH' | 'BEARISH' = lsr > 0 ? 'BEARISH' : 'BULLISH'; // Squeeze goes against crowd
  
  return {
    id: patternId,
    name: 'Crowding Squeeze Risk',
    category: 'LIQUIDATION',
    confidence: Math.min(0.9, score),
    stability,
    drivers,
    indicatorsUsed,
    regimeContext: currentRegime ? [currentRegime] : undefined,
    direction,
  };
}

// ═══════════════════════════════════════════════════════════════
// 5. FAKE_IMBALANCE
// Order book screaming but market doesn't believe
// ═══════════════════════════════════════════════════════════════

function detectFakeImbalance(
  symbol: string,
  indicators: Record<string, StoredIndicatorValue>,
  agg: MarketAggregates
): IndicatorPatternDetection | null {
  const patternId = 'FAKE_IMBALANCE';
  const drivers: string[] = [];
  const indicatorsUsed: string[] = [];
  let score = 0;
  
  // Order Book Imbalance high
  const obi = getIndicator(indicators, 'book_imbalance', 0);
  indicatorsUsed.push('book_imbalance');
  if (Math.abs(obi) > 0.5) {
    score += 0.35;
    drivers.push('book_imbalance');
  }
  
  // Volume Delta ≈ 0 (no volume support)
  const volumeDelta = getIndicator(indicators, 'volume_delta', 0);
  indicatorsUsed.push('volume_delta');
  if (Math.abs(volumeDelta) < 0.2) {
    score += 0.3;
    drivers.push('no_volume_support');
  }
  
  // Price Response weak
  const vpr = getIndicator(indicators, 'volume_price_response', 0.5);
  indicatorsUsed.push('volume_price_response');
  if (vpr < 0.4) {
    score += 0.2;
    drivers.push('weak_price_response');
  }
  
  // BSR not confirming OBI direction
  const bsr = getIndicator(indicators, 'buy_sell_ratio', 0);
  indicatorsUsed.push('buy_sell_ratio');
  const mismatch = (obi > 0.3 && bsr < 0.1) || (obi < -0.3 && bsr > -0.1);
  if (mismatch) {
    score += 0.15;
    drivers.push('bsr_mismatch');
  }
  
  // Update history
  const detected = score >= 0.55;
  updatePatternHistory(symbol, patternId, detected);
  
  const stability = getPatternStability(symbol, patternId);
  
  if (stability < 0.4) { // Can be more transient
    return null;
  }
  
  return {
    id: patternId,
    name: 'Fake Imbalance',
    category: 'FLOW',
    confidence: Math.min(0.8, score),
    stability,
    drivers,
    indicatorsUsed,
    direction: 'NEUTRAL',
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Detect all indicator-driven patterns
// ═══════════════════════════════════════════════════════════════

export interface IndicatorPatternResult {
  patterns: IndicatorPatternDetection[];
  aggregates: MarketAggregates;
  indicatorCount: number;
  timestamp: number;
}

export function detectIndicatorPatterns(
  symbol: string,
  indicators: Record<string, StoredIndicatorValue>,
  currentRegime?: MarketRegime
): IndicatorPatternResult {
  const agg = computeMarketAggregates(indicators);
  const patterns: IndicatorPatternDetection[] = [];
  
  // Detect each pattern
  const absorptionTrap = detectAbsorptionTrap(symbol, indicators, agg);
  if (absorptionTrap) patterns.push(absorptionTrap);
  
  const liquidityVacuum = detectLiquidityVacuumBreak(symbol, indicators, agg, currentRegime);
  if (liquidityVacuum) patterns.push(liquidityVacuum);
  
  const exhaustion = detectExhaustion(symbol, indicators, agg);
  if (exhaustion) patterns.push(exhaustion);
  
  const crowdingSqueeze = detectCrowdingSqueezeRisk(symbol, indicators, agg, currentRegime);
  if (crowdingSqueeze) patterns.push(crowdingSqueeze);
  
  const fakeImbalance = detectFakeImbalance(symbol, indicators, agg);
  if (fakeImbalance) patterns.push(fakeImbalance);
  
  return {
    patterns,
    aggregates: agg,
    indicatorCount: Object.keys(indicators).length,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// CLEAR HISTORY (for testing)
// ═══════════════════════════════════════════════════════════════

export function clearPatternHistory(symbol?: string): void {
  if (symbol) {
    patternHistory.delete(symbol);
  } else {
    patternHistory.clear();
  }
}

console.log('[S10.6I.7] Indicator-driven Pattern Detector loaded');
