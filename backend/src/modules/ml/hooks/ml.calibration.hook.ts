/**
 * PHASE 3.4 — Meta-Brain ML Hook
 * ===============================
 * ML confidence calibration modifier
 * 
 * RULES (LOCKED):
 * - ML does NOT change verdict direction
 * - ML does NOT raise confidence (only lowers)
 * - ML only calibrates based on historical accuracy
 * - Only applied when dataMode = LIVE
 */

import { mlInferenceService } from '../services/ml.inference.service.js';

export interface MetaBrainDecision {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  strength: 'WEAK' | 'STRONG';
  drivers: string[];
  risks: string[];
  modifiers?: Record<string, any>;
}

export interface MlHookContext {
  symbol: string;
  dataMode: 'LIVE' | 'MIXED' | 'MOCK';
  features: Record<string, number>;
}

export interface MlHookResult {
  applied: boolean;
  originalConfidence: number;
  calibratedConfidence: number;
  model?: string;
  errorProbability?: number;
  reason?: string;
}

/**
 * Apply ML confidence calibration to Meta-Brain decision
 * 
 * This hook:
 * - ONLY lowers confidence (never raises)
 * - ONLY applies to LIVE data
 * - Does NOT change verdict direction
 * - Records calibration in modifiers
 */
export async function applyMlCalibration(
  context: MlHookContext,
  decision: MetaBrainDecision
): Promise<{ decision: MetaBrainDecision; hookResult: MlHookResult }> {
  
  // Rule: Only apply to LIVE data
  if (context.dataMode !== 'LIVE') {
    return {
      decision,
      hookResult: {
        applied: false,
        originalConfidence: decision.confidence,
        calibratedConfidence: decision.confidence,
        reason: 'ML calibration skipped: dataMode is not LIVE',
      },
    };
  }
  
  // Check if ML is ready
  if (!mlInferenceService.isReady()) {
    return {
      decision,
      hookResult: {
        applied: false,
        originalConfidence: decision.confidence,
        calibratedConfidence: decision.confidence,
        reason: 'ML calibration skipped: no trained model available',
      },
    };
  }
  
  // Calibrate confidence
  const calibration = await mlInferenceService.calibrateConfidence(
    context.features,
    decision.confidence
  );
  
  // Build modified decision
  const modifiedDecision: MetaBrainDecision = {
    ...decision,
    confidence: calibration.calibratedConfidence,
    modifiers: {
      ...decision.modifiers,
      mlCalibrated: true,
      mlModel: calibration.model,
      mlOriginalConfidence: calibration.rawConfidence,
      mlErrorProbability: calibration.errorProbability,
    },
  };
  
  // Downgrade strength if confidence dropped significantly
  if (
    decision.strength === 'STRONG' &&
    calibration.calibratedConfidence < 0.6
  ) {
    modifiedDecision.strength = 'WEAK';
    modifiedDecision.risks = [
      ...modifiedDecision.risks,
      'ML_CONFIDENCE_DOWNGRADE',
    ];
  }
  
  return {
    decision: modifiedDecision,
    hookResult: {
      applied: true,
      originalConfidence: calibration.rawConfidence,
      calibratedConfidence: calibration.calibratedConfidence,
      model: calibration.model,
      errorProbability: calibration.errorProbability,
    },
  };
}

/**
 * Extract features for ML from observation/context
 */
export function extractMlFeatures(context: any): Record<string, number> {
  const features: Record<string, number> = {};
  
  // Extract from indicators if present
  if (context.indicators) {
    for (const [key, value] of Object.entries(context.indicators)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        features[`ind_${key}`] = value;
      }
    }
  }
  
  // Extract from market data
  if (context.market) {
    if (context.market.price) features['market_price'] = context.market.price;
    if (context.market.volatility) features['market_volatility'] = context.market.volatility;
    if (context.market.priceChange5m) features['market_change5m'] = context.market.priceChange5m;
  }
  
  // Extract from orderbook
  if (context.orderbook) {
    if (context.orderbook.imbalance) features['ob_imbalance'] = context.orderbook.imbalance;
    if (context.orderbook.spread) features['ob_spread'] = context.orderbook.spread;
  }
  
  // Extract from derivatives
  if (context.derivatives) {
    if (context.derivatives.fundingRate) features['deriv_funding'] = context.derivatives.fundingRate;
    if (context.derivatives.openInterest) features['deriv_oi'] = context.derivatives.openInterest;
  }
  
  return features;
}

console.log('[Phase 3.4] ML Hook loaded');
