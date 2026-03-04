/**
 * P4: Composite Weights Calculator
 * 
 * Smart weighting that combines:
 * - Base weights (configurable)
 * - Volatility penalty (less volatile = higher weight)
 * - Confidence factor (higher confidence = higher weight)
 * - Reliability factor (if available)
 * 
 * Final weights: w_a = normalize(w0_a * q_a * v_a)
 */

import type { BlendConfig, ComputedWeights, ParentSnapshotData } from '../contracts/composite.contract.js';
import type { VolatilityResult } from './composite.vol.js';

export interface WeightInputs {
  btc: ParentSnapshotData;
  spx: ParentSnapshotData;
  dxy: ParentSnapshotData;
  volResults: {
    BTC: VolatilityResult;
    SPX: VolatilityResult;
    DXY: VolatilityResult;
  };
  config: BlendConfig;
}

/**
 * Calculate confidence/reliability factor
 * 
 * q_a = clip(0.15 + 0.85 * conf) * clip(0.3 + 0.7 * rel)
 */
export function calculateConfidenceFactor(confidence: number, reliability?: number): number {
  // Confidence part: even low confidence gets some weight
  const confPart = Math.max(0.15, Math.min(1.0, 0.15 + 0.85 * confidence));
  
  // Reliability part (if available)
  if (reliability !== undefined && reliability >= 0) {
    const relPart = Math.max(0.3, Math.min(1.0, 0.3 + 0.7 * reliability));
    return confPart * relPart;
  }
  
  return confPart;
}

/**
 * Calculate smart weights with vol and confidence adjustments
 */
export function calculateSmartWeights(inputs: WeightInputs): ComputedWeights {
  const { btc, spx, dxy, volResults, config } = inputs;
  
  // Get base weights
  const w0 = {
    BTC: config.btcWeight,
    SPX: config.spxWeight,
    DXY: config.dxyWeight,
  };
  
  // Get vol penalties
  const volPenalties = {
    BTC: volResults.BTC.penalty,
    SPX: volResults.SPX.penalty,
    DXY: volResults.DXY.penalty,
  };
  
  // Get confidence factors
  const confFactors = {
    BTC: calculateConfidenceFactor(btc.confidence, btc.reliability),
    SPX: calculateConfidenceFactor(spx.confidence, spx.reliability),
    DXY: calculateConfidenceFactor(dxy.confidence, dxy.reliability),
  };
  
  // Calculate raw adjusted weights based on mode
  let rawWeights = { BTC: w0.BTC, SPX: w0.SPX, DXY: w0.DXY };
  
  switch (config.rebalanceMode) {
    case 'static':
      // No adjustment
      break;
      
    case 'vol_adjusted':
      rawWeights = {
        BTC: w0.BTC * volPenalties.BTC,
        SPX: w0.SPX * volPenalties.SPX,
        DXY: w0.DXY * volPenalties.DXY,
      };
      break;
      
    case 'confidence_weighted':
      rawWeights = {
        BTC: w0.BTC * confFactors.BTC,
        SPX: w0.SPX * confFactors.SPX,
        DXY: w0.DXY * confFactors.DXY,
      };
      break;
      
    case 'smart':
    default:
      // Full adjustment: base * vol * conf
      rawWeights = {
        BTC: w0.BTC * volPenalties.BTC * confFactors.BTC,
        SPX: w0.SPX * volPenalties.SPX * confFactors.SPX,
        DXY: w0.DXY * volPenalties.DXY * confFactors.DXY,
      };
      break;
  }
  
  // Apply minimum floor to raw weights BEFORE normalization
  const MIN_RAW = 0.01;
  if (rawWeights.BTC < MIN_RAW) rawWeights.BTC = MIN_RAW;
  if (rawWeights.SPX < MIN_RAW) rawWeights.SPX = MIN_RAW;
  if (rawWeights.DXY < MIN_RAW) rawWeights.DXY = MIN_RAW;
  
  // Normalize weights to sum to 1.0
  const sum = rawWeights.BTC + rawWeights.SPX + rawWeights.DXY;
  
  let finalWeights = {
    BTC: sum > 0 ? rawWeights.BTC / sum : 0.33,
    SPX: sum > 0 ? rawWeights.SPX / sum : 0.33,
    DXY: sum > 0 ? rawWeights.DXY / sum : 0.34,
  };
  
  // Apply bounds [0.05, 0.90] using iterative clamping
  // to ensure all weights stay within bounds after renormalization
  const MIN_WEIGHT = 0.05;
  const MAX_WEIGHT = 0.90;
  const ITERATIONS = 3;
  
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let needsAdjust = false;
    
    // Clamp
    for (const key of ['BTC', 'SPX', 'DXY'] as const) {
      if (finalWeights[key] < MIN_WEIGHT) {
        finalWeights[key] = MIN_WEIGHT;
        needsAdjust = true;
      }
      if (finalWeights[key] > MAX_WEIGHT) {
        finalWeights[key] = MAX_WEIGHT;
        needsAdjust = true;
      }
    }
    
    if (!needsAdjust) break;
    
    // Renormalize
    const newSum = finalWeights.BTC + finalWeights.SPX + finalWeights.DXY;
    finalWeights.BTC /= newSum;
    finalWeights.SPX /= newSum;
    finalWeights.DXY /= newSum;
  }
  
  // Final enforcement: if still out of bounds after iterations, force to bounds
  // and accept slightly off sum (better than violating bounds)
  for (const key of ['BTC', 'SPX', 'DXY'] as const) {
    if (finalWeights[key] < MIN_WEIGHT) finalWeights[key] = MIN_WEIGHT;
    if (finalWeights[key] > MAX_WEIGHT) finalWeights[key] = MAX_WEIGHT;
  }
  
  return {
    BTC: Math.round(finalWeights.BTC * 10000) / 10000,
    SPX: Math.round(finalWeights.SPX * 10000) / 10000,
    DXY: Math.round(finalWeights.DXY * 10000) / 10000,
    raw: {
      BTC: Math.round(rawWeights.BTC * 10000) / 10000,
      SPX: Math.round(rawWeights.SPX * 10000) / 10000,
      DXY: Math.round(rawWeights.DXY * 10000) / 10000,
    },
    volPenalties: {
      BTC: Math.round(volPenalties.BTC * 10000) / 10000,
      SPX: Math.round(volPenalties.SPX * 10000) / 10000,
      DXY: Math.round(volPenalties.DXY * 10000) / 10000,
    },
    confFactors: {
      BTC: Math.round(confFactors.BTC * 10000) / 10000,
      SPX: Math.round(confFactors.SPX * 10000) / 10000,
      DXY: Math.round(confFactors.DXY * 10000) / 10000,
    },
  };
}

export default {
  calculateConfidenceFactor,
  calculateSmartWeights,
};
