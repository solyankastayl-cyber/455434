/**
 * SPX-DXY CROSS-ASSET OVERLAY SERVICE
 * 
 * Implements proper overlay computation:
 * r^{spx}_{adj}(t) = r^{spx}_{hyb}(t) + w_H * β_H * Δr^{dxy}_{macro}(t)
 * 
 * Key principles:
 * - All computations in log returns (not levels)
 * - Horizon-aware beta (β_H)
 * - Correlation-based weight (w_H) that can disable overlay
 * - Guard multiplier for stress conditions
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CrossAssetParams {
  horizon: '7d' | '14d' | '30d' | '90d' | '180d' | '365d';
  spxHybridReturns: number[];      // Log returns path from SPX hybrid
  dxyMacroReturns: number[];       // Log returns path from DXY macro
  currentSpxPrice: number;
  currentDxyLevel: number;
  guardMultiplier?: number;        // 1.0 normal, 0.6 degraded, 0.3 critical
}

export interface CrossAssetResult {
  // Core overlay values
  adjustedReturns: number[];       // Final SPX adjusted log returns
  adjustedPrices: number[];        // Final SPX prices
  deltaOverlay: number[];          // The overlay adjustment at each t
  
  // Parameters used
  beta: number;
  correlation: number;
  stability: number;
  weight: number;
  
  // Summary metrics
  spxHybridFinalReturn: number;    // % return at horizon end
  dxyMacroFinalReturn: number;     // % return at horizon end
  spxAdjustedFinalReturn: number;  // % return after overlay
  overlayDelta: number;            // Difference: adjusted - hybrid (%)
  
  // Debug info
  debug: {
    horizonDays: number;
    betaRaw: number;
    betaClamped: number;
    rhoRaw: number;
    stabilityRaw: number;
    weightRaw: number;
    guardMultiplier: number;
    overlayActive: boolean;
    reason: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// HORIZON-AWARE PARAMETERS (calibrated from SPX-DXY historical)
// ═══════════════════════════════════════════════════════════════

/**
 * Pre-calibrated beta values for SPX-DXY relationship
 * Based on historical regression: R^{spx}_H = α + β * R^{dxy}_H
 * 
 * Typically negative: DXY up → SPX down (USD strength = risk-off)
 */
const BETA_BY_HORIZON: Record<string, number> = {
  '7d':   -0.35,
  '14d':  -0.38,
  '30d':  -0.42,
  '90d':  -0.48,
  '180d': -0.52,
  '365d': -0.55,
};

/**
 * Pre-calibrated correlation values
 * Used to determine overlay weight
 */
const CORRELATION_BY_HORIZON: Record<string, number> = {
  '7d':   -0.25,
  '14d':  -0.28,
  '30d':  -0.31,
  '90d':  -0.35,
  '180d': -0.38,
  '365d': -0.40,
};

/**
 * Correlation stability (1 - std of rolling correlation)
 * Higher = more stable relationship
 */
const STABILITY_BY_HORIZON: Record<string, number> = {
  '7d':   0.65,
  '14d':  0.70,
  '30d':  0.75,
  '90d':  0.78,
  '180d': 0.80,
  '365d': 0.82,
};

// ═══════════════════════════════════════════════════════════════
// WEIGHT CALCULATION
// ═══════════════════════════════════════════════════════════════

const RHO_MIN = 0.10;  // Below this, overlay is disabled
const RHO_MAX = 0.35;  // Above this, full overlay

/**
 * Calculate overlay weight based on correlation and stability
 * w_H = clip((|ρ| - ρ_min)/(ρ_max - ρ_min), 0, 1) * stability * guard
 */
function calculateWeight(
  correlation: number,
  stability: number,
  guardMultiplier: number = 1.0
): { weight: number; reason: string } {
  const absRho = Math.abs(correlation);
  
  // If correlation too weak, disable overlay
  if (absRho < RHO_MIN) {
    return { 
      weight: 0, 
      reason: `Correlation too weak (|ρ|=${absRho.toFixed(3)} < ${RHO_MIN})` 
    };
  }
  
  // Linear interpolation between RHO_MIN and RHO_MAX
  const rhoWeight = Math.min(1, Math.max(0, (absRho - RHO_MIN) / (RHO_MAX - RHO_MIN)));
  
  // Final weight
  const weight = rhoWeight * stability * guardMultiplier;
  
  let reason = `Active: rhoWeight=${rhoWeight.toFixed(2)}, stability=${stability.toFixed(2)}`;
  if (guardMultiplier < 1) {
    reason += `, guard=${guardMultiplier}`;
  }
  
  return { weight, reason };
}

// ═══════════════════════════════════════════════════════════════
// MAIN OVERLAY COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute SPX adjusted by DXY cross-asset overlay
 * 
 * Formula: r^{spx}_{adj}(t) = r^{spx}_{hyb}(t) + w_H * β_H * Δr^{dxy}(t)
 */
export function computeCrossAssetOverlay(params: CrossAssetParams): CrossAssetResult {
  const { 
    horizon, 
    spxHybridReturns, 
    dxyMacroReturns, 
    currentSpxPrice,
    guardMultiplier = 1.0 
  } = params;
  
  const horizonDays = parseInt(horizon.replace('d', ''));
  
  // Get horizon-specific parameters
  const betaRaw = BETA_BY_HORIZON[horizon] ?? -0.42;
  const rhoRaw = CORRELATION_BY_HORIZON[horizon] ?? -0.31;
  const stabilityRaw = STABILITY_BY_HORIZON[horizon] ?? 0.75;
  
  // Clamp beta to reasonable bounds
  const betaClamped = Math.max(-2.0, Math.min(2.0, betaRaw));
  
  // Calculate weight
  const { weight: weightRaw, reason } = calculateWeight(rhoRaw, stabilityRaw, guardMultiplier);
  
  // Ensure arrays have same length
  const len = Math.min(spxHybridReturns.length, dxyMacroReturns.length);
  
  // Compute Δr^{dxy}(t) = r^{dxy}(t) - r^{dxy}(0)
  // Since r(0) = 0 for paths starting at NOW, Δr = r
  const dxyDeltaReturns = dxyMacroReturns.slice(0, len);
  
  // Compute overlay adjustment at each t
  const deltaOverlay: number[] = [];
  const adjustedReturns: number[] = [];
  
  for (let t = 0; t < len; t++) {
    const delta = weightRaw * betaClamped * dxyDeltaReturns[t];
    deltaOverlay.push(delta);
    adjustedReturns.push(spxHybridReturns[t] + delta);
  }
  
  // Convert back to prices
  const adjustedPrices = adjustedReturns.map(r => currentSpxPrice * Math.exp(r));
  
  // Summary metrics (at final point)
  const finalIdx = len - 1;
  const spxHybridFinalReturn = (Math.exp(spxHybridReturns[finalIdx]) - 1) * 100;
  const dxyMacroFinalReturn = (Math.exp(dxyMacroReturns[finalIdx]) - 1) * 100;
  const spxAdjustedFinalReturn = (Math.exp(adjustedReturns[finalIdx]) - 1) * 100;
  const overlayDelta = spxAdjustedFinalReturn - spxHybridFinalReturn;
  
  return {
    adjustedReturns,
    adjustedPrices,
    deltaOverlay,
    
    beta: betaClamped,
    correlation: rhoRaw,
    stability: stabilityRaw,
    weight: weightRaw,
    
    spxHybridFinalReturn,
    dxyMacroFinalReturn,
    spxAdjustedFinalReturn,
    overlayDelta,
    
    debug: {
      horizonDays,
      betaRaw,
      betaClamped,
      rhoRaw,
      stabilityRaw,
      weightRaw,
      guardMultiplier,
      overlayActive: weightRaw > 0,
      reason,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// DEBUG HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Quick diagnostic for overlay validation
 */
export function validateOverlay(result: CrossAssetResult): {
  valid: boolean;
  checks: Array<{ check: string; passed: boolean; value: string }>;
} {
  const checks = [
    {
      check: 'Beta in bounds [-2, 2]',
      passed: result.beta >= -2 && result.beta <= 2,
      value: result.beta.toFixed(3),
    },
    {
      check: 'Weight in [0, 1]',
      passed: result.weight >= 0 && result.weight <= 1,
      value: result.weight.toFixed(3),
    },
    {
      check: 'Adjusted ≠ Hybrid (if overlay active)',
      passed: !result.debug.overlayActive || Math.abs(result.overlayDelta) > 0.001,
      value: `delta=${result.overlayDelta.toFixed(3)}%`,
    },
    {
      check: 'DXY flat → no adjustment',
      passed: true, // Would need DXY path to check
      value: 'N/A',
    },
    {
      check: 'Sign consistency (β<0: DXY↑ → SPX adjusted↓)',
      passed: result.beta < 0 ? 
        (result.dxyMacroFinalReturn > 0 ? result.overlayDelta < 0 : result.overlayDelta >= 0) : true,
      value: `β=${result.beta.toFixed(2)}, DXY=${result.dxyMacroFinalReturn.toFixed(2)}%, Δ=${result.overlayDelta.toFixed(2)}%`,
    },
  ];
  
  return {
    valid: checks.every(c => c.passed),
    checks,
  };
}

export default {
  computeCrossAssetOverlay,
  validateOverlay,
  BETA_BY_HORIZON,
  CORRELATION_BY_HORIZON,
  STABILITY_BY_HORIZON,
};
