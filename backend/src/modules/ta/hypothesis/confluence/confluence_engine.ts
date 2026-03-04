/**
 * Phase C: Confluence Engine
 * 
 * ARCHITECTURAL PRINCIPLES:
 * 1. Fixed number of factors (8) - no "rule explosion"
 * 2. Each factor returns 0..1 value with weight
 * 3. Final score = base * weighted_aggregate
 * 4. Volatility acts as gate (multiplier)
 * 5. Every calculation is explainable (reasons array)
 * 
 * Pipeline position:
 * Detectors → Conflict Engine → [Confluence Engine] → Hypothesis Builder → Ranker
 */

import { geometryFactor } from './factors/geometry.factor.js';
import { touchesFactor } from './factors/touches.factor.js';
import { regimeFactor } from './factors/regime.factor.js';
import { maFactor } from './factors/ma.factor.js';
import { fibFactor } from './factors/fib.factor.js';
import { volatilityFactor } from './factors/volatility.factor.js';
import { agreementFactor } from './factors/agreement.factor.js';
import { rrFactor } from './factors/rr.factor.js';
import { ConfluenceResult, PatternInput, MarketContext, FactorResult } from './confluence_types.js';

/**
 * Apply confluence scoring to a pattern
 * 
 * @param pattern - Pattern with base score and metrics
 * @param context - Market context (regime, MA, fib, vol, etc)
 * @returns ConfluenceResult with factor breakdown and final score
 */
export function applyConfluence(pattern: PatternInput, context: MarketContext): ConfluenceResult {
  const baseScore = pattern.score || 0.5;
  
  // Compute all 8 factors
  const factors: FactorResult[] = [
    geometryFactor(pattern),
    touchesFactor(pattern),
    regimeFactor(pattern, context),
    maFactor(pattern, context),
    fibFactor(pattern, context),
    volatilityFactor(context),
    agreementFactor(pattern, context),
    rrFactor(pattern),
  ];
  
  // Calculate weighted sum
  let weightedSum = 0;
  let totalWeight = 0;
  let gateMultiplier = 1.0;
  
  for (const f of factors) {
    weightedSum += f.value * f.weight;
    totalWeight += f.weight;
    
    // Apply gate multipliers (volatility, etc)
    if (f.multiplier !== undefined && f.multiplier < 1.0) {
      gateMultiplier *= f.multiplier;
    }
  }
  
  // Confluence score = normalized weighted average
  const confluenceScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  
  // Final score = base * confluence * gates
  const finalScore = Math.max(0, Math.min(1, baseScore * confluenceScore * gateMultiplier));
  
  // Collect all reasons
  const reasons: string[] = [
    `base=${baseScore.toFixed(4)}`,
    `confluence=${confluenceScore.toFixed(4)}`,
    `gate=${gateMultiplier.toFixed(2)}`,
    `final=${finalScore.toFixed(4)}`,
  ];
  
  return {
    baseScore,
    factors,
    weightedSum,
    totalWeight,
    confluenceScore,
    finalScore,
    reasons,
  };
}

/**
 * Apply confluence to multiple patterns
 * 
 * @param patterns - Array of patterns to score
 * @param context - Shared market context
 * @returns Patterns with finalScore set
 */
export function applyConfluenceToMany<T extends PatternInput>(
  patterns: T[],
  context: MarketContext
): Array<T & { confluenceResult: ConfluenceResult; finalScore: number }> {
  return patterns.map(p => {
    const result = applyConfluence(p, context);
    return {
      ...p,
      confluenceResult: result,
      finalScore: result.finalScore,
    };
  });
}

/**
 * Create default market context (for cases when context is partial)
 */
export function createDefaultContext(partial: Partial<MarketContext> = {}): MarketContext {
  return {
    regime: 'TRANSITION',
    volatility: 'NORMAL',
    maTrend: 'MIXED',
    nearestFib: 'none',
    ...partial,
  };
}

export * from './confluence_types.js';
export * from './confluence_weights.js';
