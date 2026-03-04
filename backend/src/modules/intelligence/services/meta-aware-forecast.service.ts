/**
 * META-AWARE FORECAST SERVICE
 * ===========================
 * 
 * This service bridges the gap between:
 *   - Raw exchange predictions (what the model outputs)
 *   - Final risk-adjusted forecasts (what the UI displays)
 * 
 * Architecture:
 *   Exchange Layer → Meta-Brain (invariants + risk rules) → Meta-Aware Forecast
 * 
 * The UI displays the FINAL state after risk adjustments.
 * This ensures consistency: what you see = what the system would act on.
 * 
 * Key principles:
 *   1. Meta-brain can only LOWER confidence, never increase
 *   2. Meta-brain can CAP expected move in high-risk environments
 *   3. STRONG actions blocked during extreme macro conditions
 *   4. All adjustments are logged as appliedOverlays
 */

import type {
  MetaAwareForecast,
  ForecastAdjustmentContext,
  MetaBrainAdjustmentResult,
  AppliedOverlay,
  ForecastCaps,
  RiskLevel,
  MetaAction,
} from '../contracts/meta-aware-forecast.types.js';
import type { ForecastDirection, ForecastHorizon } from '../../exchange/forecast/forecast.types.js';
import { getMacroIntelContext } from '../../macro-intel/services/macro-intel.snapshot.service.js';
import { getRegimeState } from '../../exchange/regimes/regime.service.js';
import { buildRealtimeOverlay } from '../../chart/services/realtime_overlay.service.js';
import {
  enforceInvariants,
  buildInvariantContext,
  getConfidenceCap,
  canDoStrongAction,
} from '../../meta-brain/invariants/index.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Horizon in milliseconds
const HORIZON_MS: Record<ForecastHorizon, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
};

// Risk level thresholds based on macro regime
const REGIME_RISK_MAP: Record<string, RiskLevel> = {
  'PANIC_SELL_OFF': 'EXTREME',
  'CAPITAL_EXIT': 'EXTREME',
  'FULL_RISK_OFF': 'HIGH',
  'BTC_MAX_PRESSURE': 'HIGH',
  'BTC_FLIGHT_TO_SAFETY': 'MEDIUM',
  'ALT_ROTATION': 'MEDIUM',
  'BTC_LEADS_ALT_FOLLOW': 'LOW',
  'ALT_SEASON': 'LOW',
};

// Confidence caps by risk level
const CONFIDENCE_CAPS: Record<RiskLevel, number> = {
  'LOW': 0.85,
  'MEDIUM': 0.70,
  'HIGH': 0.55,
  'EXTREME': 0.45,
};

// Move caps by risk level (max expected move %)
const MOVE_CAPS: Record<RiskLevel, number> = {
  'LOW': 15,
  'MEDIUM': 10,
  'HIGH': 6,
  'EXTREME': 3,
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Determine action from direction and confidence
 */
function determineAction(
  direction: ForecastDirection,
  confidence: number,
  riskLevel: RiskLevel
): MetaAction {
  // AVOID if confidence too low
  if (confidence < 0.35) return 'AVOID';
  
  // AVOID in extreme risk unless very confident
  if (riskLevel === 'EXTREME' && confidence < 0.6) return 'AVOID';
  
  // Map direction to action
  if (direction === 'UP') return 'BUY';
  if (direction === 'DOWN') return 'SELL';
  return 'AVOID';
}

/**
 * Get macro context safely
 */
async function getMacroContext(): Promise<ForecastAdjustmentContext['macro'] | null> {
  try {
    const macroIntel = await getMacroIntelContext();
    return {
      regime: macroIntel.regime,
      riskLevel: (REGIME_RISK_MAP[macroIntel.regime] || 'MEDIUM') as RiskLevel,
      fearGreed: macroIntel.fearGreed,
      btcDominance: macroIntel.btcDominance,
      confidenceMultiplier: macroIntel.confidenceMultiplier,
      blockedStrong: macroIntel.blockStrongActions,
      flags: Object.entries(macroIntel.flags)
        .filter(([, v]) => v)
        .map(([k]) => k),
    };
  } catch (error: any) {
    console.warn('[MetaAwareForecast] Macro context unavailable:', error.message);
    return null;
  }
}

/**
 * Get funding context safely
 */
async function getFundingContext(asset: string): Promise<ForecastAdjustmentContext['funding'] | null> {
  try {
    const overlay = await buildRealtimeOverlay(asset);
    return {
      rate: overlay.funding.rate,
      state: overlay.funding.state as 'NORMAL' | 'ELEVATED' | 'EXTREME',
      annualized: overlay.funding.annualized,
    };
  } catch (error: any) {
    console.warn('[MetaAwareForecast] Funding context unavailable:', error.message);
    return null;
  }
}

/**
 * Get regime context safely
 */
function getRegimeContext(asset: string): ForecastAdjustmentContext['regime'] | null {
  try {
    const symbol = asset.includes('USDT') ? asset : `${asset}USDT`;
    const regimeState = getRegimeState(symbol);
    if (!regimeState) return null;
    
    // Map regime to type
    let type: 'RANGE' | 'TREND' | 'SQUEEZE' | 'VOLATILE' = 'RANGE';
    const regime = regimeState.regime;
    if (regime === 'EXPANSION' || regime === 'ACCUMULATION') type = 'TREND';
    else if (regime === 'LONG_SQUEEZE' || regime === 'SHORT_SQUEEZE') type = 'SQUEEZE';
    else if (regime === 'EXHAUSTION' || regime === 'DISTRIBUTION') type = 'VOLATILE';
    
    return {
      type,
      confidence: regimeState.confidence || 0.5,
    };
  } catch (error: any) {
    console.warn('[MetaAwareForecast] Regime context unavailable:', error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Apply meta-brain risk adjustments to a raw forecast
 * Returns the final, risk-adjusted forecast for UI display
 */
export async function applyMetaBrainToForecast(
  rawForecast: {
    asset: string;
    horizon: ForecastHorizon;
    direction: ForecastDirection;
    confidence: number;
    expectedMovePct: number;
    basePrice: number;
    asOfTs: number;
  }
): Promise<MetaAwareForecast> {
  const appliedOverlays: AppliedOverlay[] = [];
  const caps: ForecastCaps = {};
  
  // Start with raw values
  let finalConfidence = rawForecast.confidence;
  let finalMove = rawForecast.expectedMovePct;
  let finalDirection = rawForecast.direction;
  let riskLevel: RiskLevel = 'MEDIUM';
  
  // ─────────────────────────────────────────────────────────────
  // STEP 1: Get market context
  // ─────────────────────────────────────────────────────────────
  const macro = await getMacroContext();
  const funding = await getFundingContext(rawForecast.asset);
  const regime = getRegimeContext(rawForecast.asset);
  
  // ─────────────────────────────────────────────────────────────
  // STEP 2: Determine risk level
  // ─────────────────────────────────────────────────────────────
  if (macro) {
    riskLevel = macro.riskLevel;
  }
  
  // Elevate risk if funding is extreme
  if (funding?.state === 'EXTREME') {
    if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
    else if (riskLevel === 'MEDIUM') riskLevel = 'HIGH';
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 3: Apply macro confidence multiplier
  // ─────────────────────────────────────────────────────────────
  if (macro && macro.confidenceMultiplier < 1) {
    const oldConf = finalConfidence;
    finalConfidence = finalConfidence * macro.confidenceMultiplier;
    
    appliedOverlays.push({
      id: 'MACRO_CONFIDENCE_MULTIPLIER',
      source: 'MACRO',
      reason: `Macro regime (${macro.regime}) reduces confidence`,
      effect: 'CAP_CONFIDENCE',
      value: macro.confidenceMultiplier,
    });
    
    console.log(`[MetaAwareForecast] Macro confidence: ${(oldConf * 100).toFixed(0)}% → ${(finalConfidence * 100).toFixed(0)}%`);
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 4: Apply confidence cap based on risk level
  // ─────────────────────────────────────────────────────────────
  const confCap = CONFIDENCE_CAPS[riskLevel];
  if (finalConfidence > confCap) {
    appliedOverlays.push({
      id: 'RISK_CONFIDENCE_CAP',
      source: 'SYSTEM',
      reason: `Risk level (${riskLevel}) caps confidence at ${(confCap * 100).toFixed(0)}%`,
      effect: 'CAP_CONFIDENCE',
      value: confCap,
    });
    
    finalConfidence = confCap;
    caps.confidenceCap = confCap;
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 5: Apply funding-based adjustments
  // ─────────────────────────────────────────────────────────────
  if (funding?.state === 'EXTREME' && funding.rate !== null) {
    // Extreme positive funding = crowded longs → bearish pressure
    // Extreme negative funding = crowded shorts → bullish pressure
    const fundingPositive = funding.rate > 0;
    
    if (fundingPositive && finalDirection === 'UP') {
      // Reduce confidence for UP predictions with crowded longs
      const fundingPenalty = 0.85;
      finalConfidence = finalConfidence * fundingPenalty;
      
      appliedOverlays.push({
        id: 'FUNDING_CROWD_PENALTY',
        source: 'FUNDING',
        reason: 'Extreme positive funding (crowded longs) reduces UP confidence',
        effect: 'CAP_CONFIDENCE',
        value: fundingPenalty,
      });
    } else if (!fundingPositive && finalDirection === 'DOWN') {
      // Reduce confidence for DOWN predictions with crowded shorts
      const fundingPenalty = 0.85;
      finalConfidence = finalConfidence * fundingPenalty;
      
      appliedOverlays.push({
        id: 'FUNDING_CROWD_PENALTY',
        source: 'FUNDING',
        reason: 'Extreme negative funding (crowded shorts) reduces DOWN confidence',
        effect: 'CAP_CONFIDENCE',
        value: fundingPenalty,
      });
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 6: Apply move cap based on risk level
  // ─────────────────────────────────────────────────────────────
  const moveCap = MOVE_CAPS[riskLevel];
  if (Math.abs(finalMove) > moveCap) {
    const sign = finalMove >= 0 ? 1 : -1;
    finalMove = sign * moveCap;
    caps.moveCapPct = moveCap;
    
    appliedOverlays.push({
      id: 'RISK_MOVE_CAP',
      source: 'SYSTEM',
      reason: `Risk level (${riskLevel}) caps expected move at ±${moveCap}%`,
      effect: 'REDUCE_MOVE',
      value: moveCap,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 7: Check if strong actions are blocked
  // ─────────────────────────────────────────────────────────────
  if (macro?.blockedStrong) {
    caps.strengthCapped = true;
    
    appliedOverlays.push({
      id: 'MACRO_BLOCKS_STRONG',
      source: 'MACRO',
      reason: 'Strong actions blocked by macro conditions',
      effect: 'BLOCK_STRONG',
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 8: Determine final action
  // ─────────────────────────────────────────────────────────────
  const action = determineAction(finalDirection, finalConfidence, riskLevel);
  
  // If action is AVOID but original was directional, add overlay
  if (action === 'AVOID' && finalDirection !== 'FLAT') {
    const originalAction = finalDirection === 'UP' ? 'BUY' : 'SELL';
    appliedOverlays.push({
      id: 'ACTION_DOWNGRADED_TO_AVOID',
      source: 'SYSTEM',
      reason: `${originalAction} downgraded to AVOID due to low confidence (${(finalConfidence * 100).toFixed(0)}%)`,
      effect: 'WARN',
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // STEP 9: Calculate final target price
  // ─────────────────────────────────────────────────────────────
  const targetPrice = rawForecast.basePrice * (1 + finalMove / 100);
  const targetTs = rawForecast.asOfTs + HORIZON_MS[rawForecast.horizon];
  
  // ─────────────────────────────────────────────────────────────
  // STEP 10: Log summary
  // ─────────────────────────────────────────────────────────────
  const isAdjusted = appliedOverlays.length > 0;
  if (isAdjusted) {
    console.log(
      `[MetaAwareForecast] ${rawForecast.asset} ${rawForecast.horizon}: ` +
      `${finalDirection} ${(finalConfidence * 100).toFixed(0)}% ` +
      `(${appliedOverlays.length} overlays applied) → ${action}`
    );
  }
  
  return {
    raw: {
      direction: rawForecast.direction,
      confidence: rawForecast.confidence,
      expectedMovePct: rawForecast.expectedMovePct,
    },
    direction: finalDirection,
    confidence: finalConfidence,
    expectedMovePct: finalMove,
    targetPrice: Math.round(targetPrice * 100) / 100,
    action,
    riskLevel,
    appliedOverlays,
    caps,
    asOfTs: rawForecast.asOfTs,
    targetTs,
    horizon: rawForecast.horizon,
    isMetaAdjusted: isAdjusted,
  };
}

/**
 * Build a complete meta-aware forecast from forecast point data
 */
export async function buildMetaAwareForecast(
  forecastPoint: {
    ts: number;
    horizon: ForecastHorizon;
    basePrice: number;
    targetPrice: number;
    expectedMovePct: number;
    direction: ForecastDirection;
    confidence: number;
  },
  asset: string
): Promise<MetaAwareForecast> {
  return applyMetaBrainToForecast({
    asset,
    horizon: forecastPoint.horizon,
    direction: forecastPoint.direction,
    confidence: forecastPoint.confidence,
    expectedMovePct: forecastPoint.expectedMovePct,
    basePrice: forecastPoint.basePrice,
    asOfTs: forecastPoint.ts,
  });
}

console.log('[Intelligence] Meta-aware forecast service loaded');
