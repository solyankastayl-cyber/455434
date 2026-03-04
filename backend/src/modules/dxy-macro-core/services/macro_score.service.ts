/**
 * MACRO SCORE SERVICE — B1 + B4.1 (Housing) + B4.2 (Activity) + B4.3 (Credit) + P2.4 (Liquidity) + P3 (As-Of)
 * 
 * Computes composite macro score from all series.
 * B4.1: Housing component (MORTGAGE30US, HOUST, PERMIT, CSUSHPISA)
 * B4.2: Activity component (NAPM, INDPRO, TCU)
 * B4.3: Credit component (BAA10Y, BAMLH0A0HYM2, STLFSI4)
 * P2.4: Liquidity component (WALCL, RRP, TGA) — Fed liquidity impulse
 * P3: As-Of mode — respects publication lag for honest backtesting
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { buildAllMacroContexts, buildMacroContext, buildMacroContextAsOf, buildAllMacroContextsAsOf } from './macro_context.service.js';
import { getHousingScoreComponent, getHousingScoreComponentAsOf } from './housing_context.service.js';
import { getActivityScoreComponent, getActivityScoreComponentAsOf } from './activity_context.service.js';
import { getCreditScoreComponent, getCreditScoreComponentAsOf } from './credit_context.service.js';
import { getLiquidityMacroComponent, getLiquidityMacroComponentAsOf } from '../../liquidity-engine/liquidity.regime.js';
import { getEnabledMacroSeries, MacroRole } from '../data/macro_sources.registry.js';
import {
  MacroScore,
  MacroScoreComponent,
  MacroContext,
  MacroConfidence,
} from '../contracts/macro.contracts.js';
import type { AsOfOptions } from '../../macro-asof/asof.contract.js';

// ═══════════════════════════════════════════════════════════════
// WEIGHTS BY ROLE — OPTIMIZED FROM REAL DXY CORRELATION ANALYSIS
// 
// Analysis date: 2026-02-27
// DXY data: 13,366 points (1973-2026)
// Optimal lag: 120 days
// 
// Key finding: T10Y2Y (Yield Curve) is STRONGEST predictor (-0.1241)
// 
// New weight distribution based on |corr| (sum = 1.0):
//   Core7 (FRED series): 0.44
//   Housing composite:   0.12
//   Activity composite:  0.12
//   Credit composite:    0.12
//   Liquidity (P2):      0.20
// ═══════════════════════════════════════════════════════════════

const ROLE_WEIGHTS: Record<MacroRole, number> = {
  rates: 0.133,        // FEDFUNDS corr=+0.0664 (weight 0.1335)
  inflation: 0.113,    // CPI+PPI (combined PPIACO=0.19 + CPI=0.11 + CoreCPI=0.10)
  labor: 0.124,        // UNRATE corr=-0.0615 (weight 0.1236)
  liquidity: 0.091,    // M2SL corr=+0.0454 (weight 0.0913)
  curve: 0.250,        // T10Y2Y corr=-0.1241 (STRONGEST - weight 0.2495)
  growth: 0.024,       // Other growth
  housing: 0.00,       // Handled via composite
  credit: 0.00,        // Handled via composite
};

// Extended component weights — P2.4 adjusted
const HOUSING_COMPOSITE_WEIGHT = 0.12;    // B4.1 (was 0.15)
const ACTIVITY_COMPOSITE_WEIGHT = 0.12;   // B4.2 (was 0.15)
const CREDIT_COMPOSITE_WEIGHT = 0.12;     // B4.3 (was 0.15)
const LIQUIDITY_ENGINE_WEIGHT = 0.20;     // P2.4 — Fed liquidity impulse (NEW)

// Per-series weight adjustments (within role) — OPTIMIZED FROM REAL CORRELATION
// Based on analysis: optimal lag = 120 days
const SERIES_WEIGHT_MULTIPLIERS: Record<string, number> = {
  'T10Y2Y': 1.5,       // STRONGEST: corr=-0.1241, boost
  'PPIACO': 1.2,       // Strong: corr=+0.0961
  'FEDFUNDS': 1.0,     // Medium: corr=+0.0664
  'UNRATE': 1.0,       // Medium: corr=-0.0615
  'CPIAUCSL': 0.9,     // Weaker: corr=+0.0565
  'CPILFESL': 0.8,     // Weaker: corr=+0.0474
  'M2SL': 0.7,         // Weakest: corr=+0.0454
};

// Series to exclude from standard processing (handled via composites)
const HOUSING_SERIES = ['MORTGAGE30US', 'HOUST', 'PERMIT', 'CSUSHPISA'];
const ACTIVITY_SERIES = ['MANEMP', 'INDPRO', 'TCU'];
const CREDIT_SERIES = ['BAA10Y', 'TEDRATE', 'VIXCLS'];
const EXCLUDED_SERIES = [...HOUSING_SERIES, ...ACTIVITY_SERIES, ...CREDIT_SERIES];

// ═══════════════════════════════════════════════════════════════
// COMPUTE COMPOSITE SCORE
// ═══════════════════════════════════════════════════════════════

/**
 * Compute macro score for current date (no lag).
 * For backtesting, use computeMacroScoreAsOf().
 */
export async function computeMacroScore(): Promise<MacroScore> {
  return computeMacroScoreInternal();
}

/**
 * P3: Compute macro score as of a specific date.
 * Only uses data that would have been available at that date.
 * 
 * @param asOf The date to evaluate as of (YYYY-MM-DD)
 */
export async function computeMacroScoreAsOf(asOf: string): Promise<MacroScore & { asOf: string }> {
  const score = await computeMacroScoreInternal({ asOf, applyLag: true });
  return { ...score, asOf };
}

/**
 * Internal implementation supporting both modes
 */
async function computeMacroScoreInternal(options?: AsOfOptions): Promise<MacroScore> {
  const asOf = options?.asOf;
  const applyLag = options?.applyLag ?? false;
  
  // Get contexts (with or without as-of filtering)
  let allContexts: MacroContext[];
  if (asOf && applyLag) {
    // P3: Get contexts filtered by publication lag
    allContexts = await buildAllMacroContextsAsOf(asOf);
  } else {
    allContexts = await buildAllMacroContexts();
  }
  
  // Filter out series handled via composites
  const contexts = allContexts.filter(c => !EXCLUDED_SERIES.includes(c.seriesId));
  
  if (contexts.length === 0) {
    return buildEmptyScore();
  }
  
  // Build components from non-housing series
  const components: MacroScoreComponent[] = [];
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const ctx of contexts) {
    const roleWeight = ROLE_WEIGHTS[ctx.role] || 0.05;
    const seriesMultiplier = SERIES_WEIGHT_MULTIPLIERS[ctx.seriesId] ?? 1.0;
    const weight = roleWeight * seriesMultiplier;
    
    const normalizedPressure = ctx.pressure * weight;
    
    components.push({
      seriesId: ctx.seriesId,
      displayName: ctx.displayName,
      role: ctx.role,
      weight: Math.round(weight * 1000) / 1000,
      rawPressure: ctx.pressure,
      normalizedPressure: Math.round(normalizedPressure * 1000) / 1000,
      regime: ctx.regime,
    });
    
    totalWeight += weight;
    weightedSum += normalizedPressure;
  }
  
  // B4.1: Add housing composite component
  let housingComponent: MacroScoreComponent | null = null;
  try {
    const housing = asOf 
      ? await getHousingScoreComponentAsOf(asOf)
      : await getHousingScoreComponent();
    
    if (housing.available) {
      const housingNormalized = housing.scoreSigned * HOUSING_COMPOSITE_WEIGHT;
      
      housingComponent = {
        seriesId: housing.key,
        displayName: housing.displayName,
        role: 'housing',
        weight: HOUSING_COMPOSITE_WEIGHT,
        rawPressure: housing.scoreSigned,
        normalizedPressure: Math.round(housingNormalized * 1000) / 1000,
        regime: housing.regime,
      };
      
      components.push(housingComponent);
      totalWeight += HOUSING_COMPOSITE_WEIGHT;
      weightedSum += housingNormalized;
    }
  } catch (e) {
    console.warn('[Macro Score] Housing component unavailable:', (e as Error).message);
  }
  
  // B4.2: Add activity composite component
  try {
    const activity = asOf
      ? await getActivityScoreComponentAsOf(asOf)
      : await getActivityScoreComponent();
    
    if (activity.available) {
      const activityNormalized = activity.scoreSigned * ACTIVITY_COMPOSITE_WEIGHT;
      
      components.push({
        seriesId: activity.key,
        displayName: activity.displayName,
        role: 'growth',
        weight: ACTIVITY_COMPOSITE_WEIGHT,
        rawPressure: activity.scoreSigned,
        normalizedPressure: Math.round(activityNormalized * 1000) / 1000,
        regime: activity.regime,
      });
      
      totalWeight += ACTIVITY_COMPOSITE_WEIGHT;
      weightedSum += activityNormalized;
    }
  } catch (e) {
    console.warn('[Macro Score] Activity component unavailable:', (e as Error).message);
  }
  
  // B4.3: Add credit composite component
  try {
    const credit = asOf
      ? await getCreditScoreComponentAsOf(asOf)
      : await getCreditScoreComponent();
    
    if (credit.available) {
      const creditNormalized = credit.scoreSigned * CREDIT_COMPOSITE_WEIGHT;
      
      components.push({
        seriesId: credit.key,
        displayName: credit.displayName,
        role: 'credit',
        weight: CREDIT_COMPOSITE_WEIGHT,
        rawPressure: credit.scoreSigned,
        normalizedPressure: Math.round(creditNormalized * 1000) / 1000,
        regime: credit.regime,
      });
      
      totalWeight += CREDIT_COMPOSITE_WEIGHT;
      weightedSum += creditNormalized;
    }
  } catch (e) {
    console.warn('[Macro Score] Credit component unavailable:', (e as Error).message);
  }
  
  // P2.4: Add Fed Liquidity Engine component
  // Formula: scoreSigned = -impulse/3 (inverted for USD convention)
  // Positive impulse (expansion) → negative score (USD bearish)
  // Negative impulse (contraction) → positive score (USD bullish)
  try {
    const liquidityEngine = asOf
      ? await getLiquidityMacroComponentAsOf(asOf)
      : await getLiquidityMacroComponent();
    
    if (liquidityEngine.available) {
      const liquidityNormalized = liquidityEngine.scoreSigned * LIQUIDITY_ENGINE_WEIGHT;
      
      components.push({
        seriesId: liquidityEngine.key,
        displayName: liquidityEngine.displayName,
        role: 'liquidity',  // Reuse role, but this is P2 engine not M2
        weight: LIQUIDITY_ENGINE_WEIGHT,
        rawPressure: liquidityEngine.scoreSigned,
        normalizedPressure: Math.round(liquidityNormalized * 1000) / 1000,
        regime: liquidityEngine.regime,
        // Extended fields for drivers
        _liquidityDetails: {
          impulse: liquidityEngine.scoreSigned * -3,  // Reconstruct original impulse
          confidence: liquidityEngine.confidence,
          regime: liquidityEngine.regime,
        },
      } as MacroScoreComponent & { _liquidityDetails: any });
      
      totalWeight += LIQUIDITY_ENGINE_WEIGHT;
      weightedSum += liquidityNormalized;
    }
  } catch (e) {
    console.warn('[Macro Score] Liquidity Engine component unavailable:', (e as Error).message);
  }
  
  // Normalize to -1..+1
  const scoreSigned = totalWeight > 0 ? weightedSum / totalWeight : 0;
  
  // Convert to 0..1 (0 = max risk-on, 1 = max risk-off)
  const score01 = (scoreSigned + 1) / 2;
  
  // Quality assessment
  const freshCount = contexts.filter(c => c.quality.freshness === 'FRESH').length;
  const staleCount = contexts.filter(c => c.quality.freshness === 'STALE').length;
  const avgCoverage = contexts.reduce((sum, c) => sum + c.quality.coverage, 0) / contexts.length;
  
  // Quality penalty (reduces confidence)
  let qualityPenalty = 0;
  if (staleCount > 2) qualityPenalty += 0.1 * (staleCount - 2);
  if (avgCoverage < 30) qualityPenalty += 0.1;
  qualityPenalty = Math.min(0.5, qualityPenalty);
  
  // Confidence
  const { confidence, confidenceReasons } = computeConfidence(
    contexts.length,
    freshCount,
    staleCount,
    qualityPenalty
  );
  
  // Summary
  const summary = buildSummary(components, contexts);
  
  return {
    score01: Math.round(score01 * 1000) / 1000,
    scoreSigned: Math.round(scoreSigned * 1000) / 1000,
    confidence,
    confidenceReasons,
    quality: {
      seriesCount: contexts.length,
      freshCount,
      staleCount,
      avgCoverage: Math.round(avgCoverage * 10) / 10,
      qualityPenalty: Math.round(qualityPenalty * 1000) / 1000,
    },
    components,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function computeConfidence(
  seriesCount: number,
  freshCount: number,
  staleCount: number,
  qualityPenalty: number
): { confidence: MacroConfidence; confidenceReasons: string[] } {
  const reasons: string[] = [];
  
  // Start with HIGH confidence
  let level = 3;  // 3=HIGH, 2=MEDIUM, 1=LOW
  
  // Check series count
  if (seriesCount < 5) {
    level = Math.min(level, 1);
    reasons.push(`Only ${seriesCount} series available (need 5+)`);
  } else if (seriesCount < 7) {
    level = Math.min(level, 2);
    reasons.push(`${seriesCount} series available (optimal: 7+)`);
  }
  
  // Check freshness
  if (freshCount < 4) {
    level = Math.min(level, 2);
    reasons.push(`Only ${freshCount} series are fresh`);
  }
  
  // Check quality penalty
  if (qualityPenalty > 0.2) {
    level = Math.min(level, 1);
    reasons.push(`High quality penalty: ${(qualityPenalty * 100).toFixed(0)}%`);
  } else if (qualityPenalty > 0.1) {
    level = Math.min(level, 2);
    reasons.push(`Moderate quality penalty: ${(qualityPenalty * 100).toFixed(0)}%`);
  }
  
  if (reasons.length === 0) {
    reasons.push('All quality checks passed');
  }
  
  const confidence: MacroConfidence = 
    level >= 3 ? 'HIGH' : 
    level >= 2 ? 'MEDIUM' : 
    'LOW';
  
  return { confidence, confidenceReasons: reasons };
}

function buildSummary(
  components: MacroScoreComponent[],
  contexts: MacroContext[]
): { dominantRegime: string; dominantRole: MacroRole; keyDrivers: string[] } {
  // Find dominant regime (most frequent)
  const regimeCounts: Record<string, number> = {};
  for (const c of components) {
    const r = String(c.regime);
    regimeCounts[r] = (regimeCounts[r] || 0) + 1;
  }
  const dominantRegime = Object.entries(regimeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
  
  // Find dominant role (highest absolute pressure contribution)
  const rolePressure: Record<MacroRole, number> = {} as any;
  for (const c of components) {
    rolePressure[c.role] = (rolePressure[c.role] || 0) + Math.abs(c.normalizedPressure);
  }
  const dominantRole = Object.entries(rolePressure)
    .sort((a, b) => b[1] - a[1])[0]?.[0] as MacroRole || 'rates';
  
  // Key drivers (top 3 by absolute pressure)
  const keyDrivers = components
    .sort((a, b) => Math.abs(b.normalizedPressure) - Math.abs(a.normalizedPressure))
    .slice(0, 3)
    .map(c => `${c.displayName}: ${c.regime} (${c.rawPressure > 0 ? '+' : ''}${c.rawPressure})`);
  
  return { dominantRegime, dominantRole, keyDrivers };
}

function buildEmptyScore(): MacroScore {
  return {
    score01: 0.5,
    scoreSigned: 0,
    confidence: 'LOW',
    confidenceReasons: ['No macro data available'],
    quality: {
      seriesCount: 0,
      freshCount: 0,
      staleCount: 0,
      avgCoverage: 0,
      qualityPenalty: 1,
    },
    components: [],
    summary: {
      dominantRegime: 'UNKNOWN',
      dominantRole: 'rates',
      keyDrivers: [],
    },
    computedAt: new Date().toISOString(),
  };
}
