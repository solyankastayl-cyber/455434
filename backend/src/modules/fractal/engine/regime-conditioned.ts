/**
 * BLOCK 36.2 — Regime-Conditioned Similarity
 * 
 * Don't compare windows from different market regimes.
 * Patterns from BULL markets shouldn't match CRASH patterns.
 * 
 * Regime classification based on:
 * - Trend (30d momentum)
 * - Volatility
 * - Crash indicators
 * - Bubble indicators
 */

export type RegimeKey = 'BULL' | 'BEAR' | 'SIDE' | 'CRASH' | 'BUBBLE';

export interface RegimeFeatures {
  trend?: number;      // -1 to 1 (momentum indicator)
  volatility?: number; // annualized vol
  crash?: boolean;     // crash transition detected
  bubble?: boolean;    // bubble detected
  structuralBull?: boolean;
}

export interface RegimeConditionedConfig {
  enabled: boolean;
  fallbackEnabled: boolean;  // if too few matches, expand to adjacent regimes
  minMatchesBeforeFallback: number;
}

export const DEFAULT_REGIME_CONFIG: RegimeConditionedConfig = {
  enabled: true,
  fallbackEnabled: true,
  minMatchesBeforeFallback: 18,  // 3x minMatches default
};

/**
 * Classify regime from features
 */
export function classifyRegime(features: RegimeFeatures): RegimeKey {
  // Priority order: CRASH > BUBBLE > BULL > BEAR > SIDE
  
  if (features.crash) {
    return 'CRASH';
  }
  
  if (features.bubble) {
    return 'BUBBLE';
  }
  
  const trend = features.trend ?? 0;
  
  if (trend > 0.15 || features.structuralBull) {
    return 'BULL';
  }
  
  if (trend < -0.15) {
    return 'BEAR';
  }
  
  return 'SIDE';
}

/**
 * Get compatible regimes for fallback matching
 * When not enough matches in exact regime, expand to adjacent ones
 */
export function getCompatibleRegimes(regime: RegimeKey): RegimeKey[] {
  const compatibility: Record<RegimeKey, RegimeKey[]> = {
    BULL: ['BULL', 'SIDE'],           // Bulls can match sideways
    BEAR: ['BEAR', 'CRASH', 'SIDE'],  // Bears can match crashes & sideways
    SIDE: ['SIDE', 'BULL', 'BEAR'],   // Sideways matches anything non-extreme
    CRASH: ['CRASH', 'BEAR'],         // Crashes match bears
    BUBBLE: ['BUBBLE', 'BULL'],       // Bubbles match bulls
  };
  
  return compatibility[regime] || [regime];
}

/**
 * Check if two regimes are compatible for matching
 */
export function areRegimesCompatible(
  regime1: RegimeKey,
  regime2: RegimeKey,
  strict: boolean = true
): boolean {
  if (regime1 === regime2) return true;
  
  if (!strict) {
    const compatible = getCompatibleRegimes(regime1);
    return compatible.includes(regime2);
  }
  
  return false;
}

/**
 * Filter matches by regime compatibility
 */
export function filterByRegime<T extends { regimeKey?: RegimeKey }>(
  matches: T[],
  currentRegime: RegimeKey,
  config: RegimeConditionedConfig = DEFAULT_REGIME_CONFIG
): T[] {
  if (!config.enabled) {
    return matches;
  }
  
  // First try strict matching
  const strictMatches = matches.filter(m => 
    m.regimeKey === currentRegime || !m.regimeKey
  );
  
  // If enough matches, return strict
  if (strictMatches.length >= config.minMatchesBeforeFallback || !config.fallbackEnabled) {
    return strictMatches;
  }
  
  // Fallback: expand to compatible regimes
  const compatibleRegimes = getCompatibleRegimes(currentRegime);
  const expandedMatches = matches.filter(m =>
    !m.regimeKey || compatibleRegimes.includes(m.regimeKey)
  );
  
  // Log fallback usage
  if (expandedMatches.length > strictMatches.length) {
    console.log(
      `[REGIME] Fallback: ${currentRegime} expanded to ${compatibleRegimes.join(',')} ` +
      `(${strictMatches.length} → ${expandedMatches.length} matches)`
    );
  }
  
  return expandedMatches;
}

/**
 * Add regime labels to historical windows
 * Call this during window building/indexing
 */
export function labelWindowRegime(
  windowFeatures: RegimeFeatures
): { regimeKey: RegimeKey; regimeConfidence: number } {
  const regime = classifyRegime(windowFeatures);
  
  // Calculate confidence based on feature strength
  let confidence = 0.5; // default moderate
  
  if (windowFeatures.crash || windowFeatures.bubble) {
    confidence = 0.9; // high confidence for extreme regimes
  } else {
    const trendStrength = Math.abs(windowFeatures.trend ?? 0);
    confidence = Math.min(0.9, 0.5 + trendStrength);
  }
  
  return {
    regimeKey: regime,
    regimeConfidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Compute regime features from price series
 * Helper for labeling windows during indexing
 */
export function computeRegimeFeatures(
  closes: number[],
  options?: {
    crashThreshold?: number;    // default -0.30 (30% drop)
    bubbleThreshold?: number;   // default 2.0 (100% rise)
    trendWindow?: number;       // default 30 days
  }
): RegimeFeatures {
  const opts = {
    crashThreshold: -0.30,
    bubbleThreshold: 2.0,
    trendWindow: 30,
    ...options,
  };
  
  if (closes.length < opts.trendWindow + 5) {
    return { trend: 0, volatility: 0 };
  }
  
  // Compute returns
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i-1] > 0) {
      returns.push(Math.log(closes[i] / closes[i-1]));
    }
  }
  
  if (returns.length < opts.trendWindow) {
    return { trend: 0, volatility: 0 };
  }
  
  // Trend: momentum over window
  const recentReturns = returns.slice(-opts.trendWindow);
  const cumReturn = recentReturns.reduce((a, b) => a + b, 0);
  const trend = Math.tanh(cumReturn * 5); // normalize to [-1, 1]
  
  // Volatility: annualized
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);
  const volatility = dailyVol * Math.sqrt(252);
  
  // Crash detection: sharp recent drop
  const last30Return = closes[closes.length - 1] / closes[Math.max(0, closes.length - 31)] - 1;
  const crash = last30Return <= opts.crashThreshold;
  
  // Bubble detection: extreme recent rise
  const last60Return = closes.length > 60 
    ? closes[closes.length - 1] / closes[closes.length - 61] - 1
    : 0;
  const bubble = last60Return >= opts.bubbleThreshold;
  
  // Structural bull: sustained uptrend
  const structuralBull = trend > 0.3 && volatility < 0.8;
  
  return {
    trend,
    volatility,
    crash,
    bubble,
    structuralBull,
  };
}

/**
 * Regime statistics for diagnostics
 */
export function computeRegimeStats<T extends { regimeKey?: RegimeKey }>(
  windows: T[]
): Record<RegimeKey, number> {
  const stats: Record<RegimeKey, number> = {
    BULL: 0,
    BEAR: 0,
    SIDE: 0,
    CRASH: 0,
    BUBBLE: 0,
  };
  
  for (const w of windows) {
    if (w.regimeKey) {
      stats[w.regimeKey]++;
    }
  }
  
  return stats;
}
