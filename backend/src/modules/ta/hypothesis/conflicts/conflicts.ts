/**
 * Phase B: Hard Conflicts - Static map of mutually exclusive patterns
 * 
 * ARCHITECTURAL RULE: 
 * If A and B are in HARD_CONFLICTS, they CANNOT coexist in the same hypothesis.
 * 
 * These are LOGICAL impossibilities on the same timeframe:
 * - ASC_TRIANGLE and DESC_TRIANGLE cannot happen simultaneously
 * - DOUBLE_TOP and DOUBLE_BOTTOM are mutually exclusive
 * - CHANNEL_UP and CHANNEL_DOWN contradict each other
 */

export const HARD_CONFLICTS: Record<string, string[]> = {
  
  // ═══════════════════════════════════════════════════════════════
  // TRIANGLES/WEDGES - geometric opposites
  // ═══════════════════════════════════════════════════════════════
  TRIANGLE_ASC: ["TRIANGLE_DESC"],
  TRIANGLE_DESC: ["TRIANGLE_ASC"],
  
  WEDGE_RISING: ["WEDGE_FALLING"],
  WEDGE_FALLING: ["WEDGE_RISING"],
  
  // ═══════════════════════════════════════════════════════════════
  // REVERSALS - directional opposites
  // ═══════════════════════════════════════════════════════════════
  DOUBLE_TOP: ["DOUBLE_BOTTOM"],
  DOUBLE_BOTTOM: ["DOUBLE_TOP"],
  
  HNS: ["IHNS"],  // Head & Shoulders vs Inverted
  IHNS: ["HNS"],
  
  HEAD_SHOULDERS: ["INVERTED_HEAD_SHOULDERS"],
  INVERTED_HEAD_SHOULDERS: ["HEAD_SHOULDERS"],
  
  // ═══════════════════════════════════════════════════════════════
  // FLAGS - continuation opposites
  // ═══════════════════════════════════════════════════════════════
  FLAG_BULL: ["FLAG_BEAR"],
  FLAG_BEAR: ["FLAG_BULL"],
  
  // ═══════════════════════════════════════════════════════════════
  // CHANNELS - trend opposites
  // ═══════════════════════════════════════════════════════════════
  CHANNEL_UP: ["CHANNEL_DOWN"],
  CHANNEL_DOWN: ["CHANNEL_UP"],
  
  // ═══════════════════════════════════════════════════════════════
  // HARMONICS - directional opposites
  // ═══════════════════════════════════════════════════════════════
  HARMONIC_ABCD_BULL: ["HARMONIC_ABCD_BEAR"],
  HARMONIC_ABCD_BEAR: ["HARMONIC_ABCD_BULL"],
  
  HARMONIC_GARTLEY_BULL: ["HARMONIC_GARTLEY_BEAR"],
  HARMONIC_GARTLEY_BEAR: ["HARMONIC_GARTLEY_BULL"],
  
  HARMONIC_BAT_BULL: ["HARMONIC_BAT_BEAR"],
  HARMONIC_BAT_BEAR: ["HARMONIC_BAT_BULL"],
  
  HARMONIC_BUTTERFLY_BULL: ["HARMONIC_BUTTERFLY_BEAR"],
  HARMONIC_BUTTERFLY_BEAR: ["HARMONIC_BUTTERFLY_BULL"],
  
  // ═══════════════════════════════════════════════════════════════
  // CANDLES - directional opposites  
  // ═══════════════════════════════════════════════════════════════
  CANDLE_ENGULF_BULL: ["CANDLE_ENGULF_BEAR"],
  CANDLE_ENGULF_BEAR: ["CANDLE_ENGULF_BULL"],
  
  CANDLE_HAMMER: ["CANDLE_SHOOTING_STAR"],
  CANDLE_SHOOTING_STAR: ["CANDLE_HAMMER"],
  
  // ═══════════════════════════════════════════════════════════════
  // DIVERGENCES - directional opposites
  // ═══════════════════════════════════════════════════════════════
  DIVERGENCE_BULL_RSI: ["DIVERGENCE_BEAR_RSI"],
  DIVERGENCE_BEAR_RSI: ["DIVERGENCE_BULL_RSI"],
  
  DIVERGENCE_BULL_MACD: ["DIVERGENCE_BEAR_MACD"],
  DIVERGENCE_BEAR_MACD: ["DIVERGENCE_BULL_MACD"],
  
  // ═══════════════════════════════════════════════════════════════
  // MA PATTERNS - directional opposites
  // ═══════════════════════════════════════════════════════════════
  MA_CROSS_GOLDEN: ["MA_CROSS_DEATH"],
  MA_CROSS_DEATH: ["MA_CROSS_GOLDEN"],
  
  // ═══════════════════════════════════════════════════════════════
  // BREAKOUTS - directional opposites
  // ═══════════════════════════════════════════════════════════════
  LEVEL_BREAKOUT: ["LEVEL_BREAKDOWN"],
  LEVEL_BREAKDOWN: ["LEVEL_BREAKOUT"],
  
  BREAKOUT_RETEST_BULL: ["BREAKOUT_RETEST_BEAR"],
  BREAKOUT_RETEST_BEAR: ["BREAKOUT_RETEST_BULL"],
};

/**
 * Soft Conflicts - patterns that don't fully exclude each other,
 * but reduce confidence when both present.
 * 
 * multiplier: how much to reduce score (0.5 = 50% penalty)
 */
export const SOFT_CONFLICTS: Record<string, { conflicts: string[]; multiplier: number }> = {
  
  // Triangle + Harmonic on same TF is suspicious
  TRIANGLE_SYM: { 
    conflicts: ["HARMONIC_GARTLEY_BULL", "HARMONIC_GARTLEY_BEAR", "HARMONIC_BAT_BULL", "HARMONIC_BAT_BEAR"],
    multiplier: 0.7 
  },
  
  // Channel + Wave is often conflicting interpretation
  CHANNEL_UP: { 
    conflicts: ["WAVE_IMPULSE", "WAVE_CORRECTIVE"],
    multiplier: 0.75 
  },
  CHANNEL_DOWN: { 
    conflicts: ["WAVE_IMPULSE", "WAVE_CORRECTIVE"],
    multiplier: 0.75 
  },
  
  // Multiple reversal patterns at once reduce confidence
  DOUBLE_TOP: {
    conflicts: ["HNS", "HEAD_SHOULDERS"],
    multiplier: 0.8
  },
  DOUBLE_BOTTOM: {
    conflicts: ["IHNS", "INVERTED_HEAD_SHOULDERS"],
    multiplier: 0.8
  },
};

/**
 * Check if two pattern types have a hard conflict
 */
export function hasHardConflict(typeA: string, typeB: string): boolean {
  return HARD_CONFLICTS[typeA]?.includes(typeB) || HARD_CONFLICTS[typeB]?.includes(typeA);
}

/**
 * Get soft conflict multiplier between two patterns
 * Returns 1.0 if no soft conflict
 */
export function getSoftConflictMultiplier(typeA: string, typeB: string): number {
  const confA = SOFT_CONFLICTS[typeA];
  if (confA?.conflicts.includes(typeB)) {
    return confA.multiplier;
  }
  
  const confB = SOFT_CONFLICTS[typeB];
  if (confB?.conflicts.includes(typeA)) {
    return confB.multiplier;
  }
  
  return 1.0;
}
