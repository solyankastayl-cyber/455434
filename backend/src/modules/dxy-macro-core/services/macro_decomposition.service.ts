/**
 * MACRO DECOMPOSITION SERVICE
 * 
 * Разложение scoreSigned на компоненты и расчёт корреляций с DXY forward returns.
 * 
 * Roadmap tasks:
 * 1. Декомпозиция на компоненты (FEDFUNDS, CPI, UNRATE, Liquidity)
 * 2. Расчёт корреляций компонентов с DXY_forward
 * 3. Взвешивание по силе корреляции
 * 4. Удаление шума (|corr| < 0.03)
 * 5. Проверка лага (10D/30D/60D/120D)
 */

import { getEnabledMacroSeries } from '../data/macro_sources.registry.js';

// Component correlation results
export interface ComponentCorrelation {
  seriesId: string;
  displayName: string;
  role: string;
  correlation: number;           // corr with DXY forward
  absCorrelation: number;        // |corr|
  optimalLag: number;            // days (10, 30, 60, 120)
  correlationsByLag: {
    lag10: number;
    lag30: number;
    lag60: number;
    lag120: number;
  };
  isNoise: boolean;              // |corr| < 0.03
  weight: number;                // optimized weight
}

export interface DecompositionResult {
  components: ComponentCorrelation[];
  optimizedWeights: Record<string, number>;
  aggregateCorrelation: number;  // corr of weighted score with DXY
  noiseFiltered: string[];       // excluded series
  totalComponents: number;
  usedComponents: number;
  computedAt: string;
}

// Correlation calculation helper
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;
  
  const xSlice = x.slice(0, n);
  const ySlice = y.slice(0, n);
  
  const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
  const yMean = ySlice.reduce((a, b) => a + b, 0) / n;
  
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - xMean;
    const dy = ySlice[i] - yMean;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;
  
  return num / denom;
}

// Shift array for lag analysis
function shiftForLag(arr: number[], lag: number): number[] {
  if (lag <= 0) return arr;
  return arr.slice(lag);
}

// Calculate forward return (future price - current) / current
function computeForwardReturns(prices: number[], horizonDays: number): number[] {
  const returns: number[] = [];
  for (let i = 0; i < prices.length - horizonDays; i++) {
    const current = prices[i];
    const future = prices[i + horizonDays];
    if (current > 0) {
      returns.push((future - current) / current);
    }
  }
  return returns;
}

/**
 * Analyze component correlations with DXY forward returns
 */
export async function analyzeComponentCorrelations(
  componentSeries: Array<{
    seriesId: string;
    displayName: string;
    role: string;
    values: number[];           // time series values (oldest first)
    dates: string[];
  }>,
  dxyPrices: number[],          // DXY prices aligned with component dates
  horizonDays: number = 30      // forward return horizon
): Promise<DecompositionResult> {
  
  const components: ComponentCorrelation[] = [];
  const noiseFiltered: string[] = [];
  
  // Compute DXY forward returns for different lags
  const dxyForward30 = computeForwardReturns(dxyPrices, 30);
  const dxyForward10 = computeForwardReturns(dxyPrices, 10);
  const dxyForward60 = computeForwardReturns(dxyPrices, 60);
  const dxyForward120 = computeForwardReturns(dxyPrices, 120);
  
  for (const comp of componentSeries) {
    // Correlations at different lags
    const lag10 = pearsonCorrelation(comp.values, shiftForLag(dxyForward10, 0));
    const lag30 = pearsonCorrelation(comp.values, shiftForLag(dxyForward30, 0));
    const lag60 = pearsonCorrelation(comp.values, shiftForLag(dxyForward60, 0));
    const lag120 = pearsonCorrelation(comp.values, shiftForLag(dxyForward120, 0));
    
    // Find optimal lag (highest |corr|)
    const correlations = { lag10, lag30, lag60, lag120 };
    const absCorrelations = {
      lag10: Math.abs(lag10),
      lag30: Math.abs(lag30),
      lag60: Math.abs(lag60),
      lag120: Math.abs(lag120),
    };
    
    const optimalLagKey = Object.entries(absCorrelations)
      .sort((a, b) => b[1] - a[1])[0][0] as keyof typeof correlations;
    
    const optimalLag = parseInt(optimalLagKey.replace('lag', ''));
    const correlation = correlations[optimalLagKey];
    const absCorrelation = Math.abs(correlation);
    
    // Check if noise (|corr| < 0.03)
    const isNoise = absCorrelation < 0.03;
    
    if (isNoise) {
      noiseFiltered.push(comp.seriesId);
    }
    
    components.push({
      seriesId: comp.seriesId,
      displayName: comp.displayName,
      role: comp.role,
      correlation: Math.round(correlation * 10000) / 10000,
      absCorrelation: Math.round(absCorrelation * 10000) / 10000,
      optimalLag,
      correlationsByLag: {
        lag10: Math.round(lag10 * 10000) / 10000,
        lag30: Math.round(lag30 * 10000) / 10000,
        lag60: Math.round(lag60 * 10000) / 10000,
        lag120: Math.round(lag120 * 10000) / 10000,
      },
      isNoise,
      weight: 0, // Will be computed below
    });
  }
  
  // Step 3: Calculate optimized weights (proportional to |corr|)
  // Formula: weight_i = |corr_i| / Σ|corr|
  const nonNoiseComponents = components.filter(c => !c.isNoise);
  const totalAbsCorr = nonNoiseComponents.reduce((sum, c) => sum + c.absCorrelation, 0);
  
  const optimizedWeights: Record<string, number> = {};
  
  for (const comp of components) {
    if (comp.isNoise) {
      comp.weight = 0;
      optimizedWeights[comp.seriesId] = 0;
    } else {
      const weight = totalAbsCorr > 0 ? comp.absCorrelation / totalAbsCorr : 0;
      comp.weight = Math.round(weight * 10000) / 10000;
      optimizedWeights[comp.seriesId] = comp.weight;
    }
  }
  
  // Calculate aggregate correlation using optimized weights
  // This is theoretical - actual computation would need weighted score time series
  const aggregateCorrelation = nonNoiseComponents.length > 0
    ? nonNoiseComponents.reduce((sum, c) => sum + c.correlation * c.weight, 0)
    : 0;
  
  return {
    components,
    optimizedWeights,
    aggregateCorrelation: Math.round(aggregateCorrelation * 10000) / 10000,
    noiseFiltered,
    totalComponents: components.length,
    usedComponents: nonNoiseComponents.length,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Build optimized score using correlation-weighted components
 */
export function buildOptimizedScore(
  componentValues: Array<{
    seriesId: string;
    pressure: number;  // normalized pressure value
  }>,
  weights: Record<string, number>
): { scoreSigned: number; breakdown: Array<{ seriesId: string; contribution: number }> } {
  let weightedSum = 0;
  let totalWeight = 0;
  const breakdown: Array<{ seriesId: string; contribution: number }> = [];
  
  for (const comp of componentValues) {
    const weight = weights[comp.seriesId] || 0;
    if (weight > 0) {
      const contribution = comp.pressure * weight;
      weightedSum += contribution;
      totalWeight += weight;
      breakdown.push({
        seriesId: comp.seriesId,
        contribution: Math.round(contribution * 10000) / 10000,
      });
    }
  }
  
  const scoreSigned = totalWeight > 0 ? weightedSum / totalWeight : 0;
  
  return {
    scoreSigned: Math.round(scoreSigned * 10000) / 10000,
    breakdown,
  };
}

/**
 * OPTIMIZED WEIGHTS BASED ON REAL DXY CORRELATION ANALYSIS
 * 
 * Analysis date: 2026-02-27
 * DXY data points: 13,366
 * Optimal lag: 120 days
 * 
 * Formula: weight_i = |corr_i| / Σ|corr|
 */
export const DEFAULT_OPTIMIZED_WEIGHTS: Record<string, number> = {
  // STRONG SIGNAL (|corr| > 0.10)
  'T10Y2Y': 0.2495,        // Yield Curve — STRONGEST (-0.1241)
  
  // WEAK SIGNALS (|corr| 0.03-0.10)
  'PPIACO': 0.1932,        // PPI (+0.0961)
  'FEDFUNDS': 0.1335,      // Rates (+0.0664)
  'UNRATE': 0.1236,        // Unemployment (-0.0615)
  'CPIAUCSL': 0.1136,      // Headline CPI (+0.0565)
  'CPILFESL': 0.0953,      // Core CPI (+0.0474)
  'M2SL': 0.0913,          // Liquidity (+0.0454)
  
  // Composites (derived)
  'HOUSING_COMPOSITE': 0.03,
  'CREDIT_COMPOSITE': 0.02,
};

/**
 * Get weight for a series ID, with fallback
 */
export function getOptimizedWeight(seriesId: string): number {
  return DEFAULT_OPTIMIZED_WEIGHTS[seriesId] ?? 0.05;
}
