/**
 * Macro Intelligence Snapshot Service
 * 
 * Aggregates all macro data and computes regime state
 */

import {
  MacroRawData,
  MacroRegimeState,
  MacroContext,
  MacroMlFeatures,
  MacroIntelSnapshot,
  MarketRegime,
  REGIME_ID_MAP,
  RISK_LEVEL_MAP,
  REGIME_DEFINITIONS,
} from '../contracts/macro-intel.types.js';

import {
  detectAllTrends,
  detectRegime,
  detectStablecoinPressure,
  adjustRiskLevel,
  calculateConfidenceMultiplier,
  generateFlags,
  determineMarketBias,
} from './regime.detector.js';

import { getMacroSnapshot as getBaseMacroSnapshot } from '../../macro/services/macro.snapshot.service.js';
import { fetchBtcPrice } from '../providers/btc-price.provider.js';

// Cache
let cachedSnapshot: MacroIntelSnapshot | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

/**
 * Build raw macro data from all providers
 */
async function buildRawData(): Promise<{ raw: MacroRawData; quality: MacroIntelSnapshot['quality'] }> {
  const missing: string[] = [];
  
  // Get base macro data (Fear & Greed + Dominance)
  const baseMacro = await getBaseMacroSnapshot();
  
  // Get BTC price
  const btcPriceResult = await fetchBtcPrice();
  
  // Calculate alt market change (proxy: opposite of BTC dominance change)
  // When BTC.D goes down, alt market is gaining (positive)
  const altMarketChange24h = baseMacro.dominance.btcDelta24h 
    ? -baseMacro.dominance.btcDelta24h 
    : 0;
  
  // Check for missing data
  if (!baseMacro.fearGreed.value) missing.push('fearGreed');
  if (!baseMacro.dominance.btcPct) missing.push('btcDominance');
  if (!btcPriceResult.data) missing.push('btcPrice');
  
  const raw: MacroRawData = {
    fearGreedIndex: baseMacro.fearGreed.value || 50,
    fearGreedLabel: baseMacro.fearGreed.label || 'NEUTRAL',
    
    btcDominance: baseMacro.dominance.btcPct || 50,
    stableDominance: baseMacro.dominance.stablePct || 10,
    altDominance: baseMacro.dominance.altPct || 40,
    
    btcDominanceChange24h: baseMacro.dominance.btcDelta24h || 0,
    stableDominanceChange24h: baseMacro.dominance.stableDelta24h || 0,
    
    btcPrice: btcPriceResult.data?.price || 0,
    btcPriceChange24h: btcPriceResult.data?.change24h || 0,
    
    altMarketChange24h,
    
    timestamp: Date.now(),
  };
  
  const quality: MacroIntelSnapshot['quality'] = {
    mode: missing.length === 0 ? 'LIVE' : (missing.length < 2 ? 'DEGRADED' : 'NO_DATA'),
    missing,
  };
  
  return { raw, quality };
}

/**
 * Compute regime state from raw data
 */
function computeRegimeState(raw: MacroRawData): MacroRegimeState {
  // Detect all trends
  const { trends, trendValues } = detectAllTrends(raw);
  
  // Detect regime
  const regime = detectRegime(trends);
  const regimeDef = REGIME_DEFINITIONS[regime];
  
  // Detect stablecoin pressure
  const stablecoinPressure = detectStablecoinPressure(trends.stableDominance);
  
  // Adjust risk level
  const riskLevel = adjustRiskLevel(regimeDef.riskLevel, raw.fearGreedIndex, stablecoinPressure);
  
  // Calculate confidence multiplier
  const confidenceMultiplier = calculateConfidenceMultiplier(regime, raw.fearGreedIndex, stablecoinPressure);
  
  // Generate flags
  const flags = generateFlags(regime, raw.fearGreedIndex, stablecoinPressure);
  
  // Determine market bias
  const marketBias = determineMarketBias(regime, flags);
  
  // Determine blocks
  const blocks = {
    strongActions: flags.MACRO_PANIC || flags.CAPITAL_EXIT || riskLevel === 'EXTREME',
    altExposure: flags.FLIGHT_TO_BTC || flags.MACRO_PANIC,
    btcExposure: flags.MACRO_PANIC || flags.CAPITAL_EXIT,
  };
  
  return {
    regime,
    regimeId: REGIME_ID_MAP[regime],
    regimeLabel: regimeDef.title,
    
    trends,
    trendValues,
    
    riskLevel,
    riskLevelId: RISK_LEVEL_MAP[riskLevel],
    
    marketBias,
    stablecoinPressure,
    
    confidenceMultiplier,
    blocks,
    flags,
  };
}

/**
 * Build context for Meta-Brain and downstream systems
 */
function buildContext(raw: MacroRawData, state: MacroRegimeState): MacroContext {
  return {
    regimeId: state.regimeId,
    regimeLabel: state.regimeLabel,
    regime: state.regime,
    
    fearGreed: raw.fearGreedIndex,
    fearGreedNorm: raw.fearGreedIndex / 100,
    btcDominance: raw.btcDominance,
    stableDominance: raw.stableDominance,
    
    btcDominanceTrend: state.trendValues.btcDominanceTrend,
    stableDominanceTrend: state.trendValues.stableDominanceTrend,
    btcPriceTrend: state.trendValues.btcPriceTrend,
    altMarketTrend: state.trendValues.altMarketTrend,
    
    riskLevel: state.riskLevel,
    riskLevelId: state.riskLevelId,
    marketBias: state.marketBias,
    
    flags: state.flags,
    
    confidenceMultiplier: state.confidenceMultiplier,
    blockStrongActions: state.blocks.strongActions,
    
    timestamp: Date.now(),
  };
}

/**
 * Build ML features
 */
function buildMlFeatures(raw: MacroRawData, state: MacroRegimeState): MacroMlFeatures {
  return {
    macro_regime_id: state.regimeId,
    macro_risk_level: state.riskLevelId,
    fear_greed_norm: raw.fearGreedIndex / 100,
    btc_dom_trend: state.trendValues.btcDominanceTrend,
    stable_dom_trend: state.trendValues.stableDominanceTrend,
    alt_flow_proxy: Math.max(0, Math.min(1, (state.trendValues.altMarketTrend + 1) / 2)),
  };
}

/**
 * Get full macro intelligence snapshot
 */
export async function getMacroIntelSnapshot(forceRefresh = false): Promise<MacroIntelSnapshot> {
  const now = Date.now();
  
  // Return cached if valid
  if (!forceRefresh && cachedSnapshot && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedSnapshot;
  }
  
  // Build raw data
  const { raw, quality } = await buildRawData();
  
  // Compute state
  const state = computeRegimeState(raw);
  
  // Build context
  const context = buildContext(raw, state);
  
  // Build ML features
  const mlFeatures = buildMlFeatures(raw, state);
  
  const snapshot: MacroIntelSnapshot = {
    timestamp: now,
    raw,
    state,
    context,
    mlFeatures,
    quality,
  };
  
  // Update cache
  cachedSnapshot = snapshot;
  cacheTimestamp = now;
  
  console.log(`[MacroIntel] Snapshot: ${state.regime} (${state.regimeLabel}), Risk=${state.riskLevel}, CM=${state.confidenceMultiplier.toFixed(2)}`);
  
  return snapshot;
}

/**
 * Get current cached snapshot
 */
export function getCurrentMacroIntelSnapshot(): MacroIntelSnapshot | null {
  return cachedSnapshot;
}

/**
 * Get just the context (for Meta-Brain)
 */
export async function getMacroIntelContext(): Promise<MacroContext> {
  const snapshot = await getMacroIntelSnapshot();
  return snapshot.context;
}

/**
 * Get just the ML features
 */
export async function getMacroMlFeatures(): Promise<MacroMlFeatures> {
  const snapshot = await getMacroIntelSnapshot();
  return snapshot.mlFeatures;
}

console.log('[MacroIntelSnapshot] Service loaded');
