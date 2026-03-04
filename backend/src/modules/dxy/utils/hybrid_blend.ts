/**
 * DXY HYBRID BLEND UTILS — A4
 * 
 * Point-by-point blending of synthetic and replay paths.
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

// ═══════════════════════════════════════════════════════════════
// COMPUTE REPLAY WEIGHT
// ═══════════════════════════════════════════════════════════════

/**
 * Compute replay weight based on similarity and entropy.
 * 
 * Formula: w = clamp(similarity * (1 - entropy), 0, clampMax)
 * 
 * - Higher similarity → more replay influence
 * - Higher entropy → less replay influence
 * - Clamp to prevent replay from dominating
 */
export function computeReplayWeight(
  similarity: number,
  entropy: number,
  clampMax: number = 0.5
): number {
  if (!Number.isFinite(similarity) || !Number.isFinite(entropy)) {
    return 0;
  }
  
  // Normalize inputs
  const sim = Math.max(0, Math.min(1, similarity));
  const ent = Math.max(0, Math.min(1, entropy));
  
  // Weight formula
  const w = sim * (1 - ent);
  
  // Clamp to max
  return Math.min(clampMax, Math.max(0, w));
}

// ═══════════════════════════════════════════════════════════════
// BLEND PATHS POINT-BY-POINT
// ═══════════════════════════════════════════════════════════════

/**
 * Blend synthetic and replay paths by percentage returns.
 * 
 * @param synthPct - Synthetic path as decimal returns from start
 * @param replayPct - Replay path as decimal returns from start
 * @param w - Replay weight (0..0.5)
 * @returns Blended decimal returns
 */
export function blendPathsPointByPoint(
  synthPct: number[],
  replayPct: number[],
  w: number
): number[] {
  const len = Math.max(synthPct.length, replayPct.length);
  const result: number[] = [];
  
  for (let t = 0; t < len; t++) {
    const synVal = synthPct[t] ?? 0;
    const repVal = replayPct[t] ?? synVal; // fallback to synthetic if replay missing
    
    // Blend: (1 - w) * synthetic + w * replay
    const blended = (1 - w) * synVal + w * repVal;
    
    // Validate
    if (!Number.isFinite(blended)) {
      result.push(synVal); // fallback to synthetic
    } else {
      result.push(blended);
    }
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// CONVERT PCT TO ABSOLUTE PRICE PATH
// ═══════════════════════════════════════════════════════════════

/**
 * Convert decimal returns to absolute prices.
 * 
 * @param basePrice - Starting price
 * @param pctReturns - Array of decimal returns from start
 * @param startDate - Date to start generating dates from
 * @returns Array of { t, date, value, pct }
 */
export function pctToAbsolutePath(
  basePrice: number,
  pctReturns: number[],
  startDate: string
): Array<{ t: number; date: string; value: number; pct: number }> {
  const result: Array<{ t: number; date: string; value: number; pct: number }> = [];
  
  const start = new Date(startDate);
  
  for (let t = 0; t < pctReturns.length; t++) {
    const pct = pctReturns[t];
    const value = basePrice * (1 + pct);
    
    // Generate date (t days from start)
    const date = new Date(start);
    date.setDate(date.getDate() + t + 1);
    
    result.push({
      t,
      date: date.toISOString().split('T')[0],
      value: Math.round(value * 10000) / 10000,
      pct: Math.round(pct * 10000) / 10000,
    });
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// COMPUTE BREAKDOWN (MODEL/REPLAY/HYBRID RETURNS)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute return breakdown for hybrid path.
 * 
 * @param synthPct - Synthetic pct returns
 * @param replayPct - Replay pct returns
 * @param hybridPct - Hybrid pct returns
 * @param horizonDays - Forecast horizon in days
 * @returns Breakdown with endpoint returns
 */
export function computeHybridBreakdown(
  synthPct: number[],
  replayPct: number[],
  hybridPct: number[],
  horizonDays: number
): { modelReturn: number; replayReturn: number; hybridReturn: number } {
  // Get endpoint returns (last value or horizon-specific)
  const endIdx = Math.min(horizonDays - 1, synthPct.length - 1, hybridPct.length - 1);
  
  const modelReturn = endIdx >= 0 && Number.isFinite(synthPct[endIdx]) 
    ? synthPct[endIdx] 
    : 0;
  
  const replayReturn = endIdx >= 0 && replayPct.length > endIdx && Number.isFinite(replayPct[endIdx])
    ? replayPct[endIdx]
    : modelReturn;
  
  const hybridReturn = endIdx >= 0 && Number.isFinite(hybridPct[endIdx])
    ? hybridPct[endIdx]
    : modelReturn;
  
  return {
    modelReturn: Math.round(modelReturn * 10000) / 10000,
    replayReturn: Math.round(replayReturn * 10000) / 10000,
    hybridReturn: Math.round(hybridReturn * 10000) / 10000,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATE PATH (NaN CHECK)
// ═══════════════════════════════════════════════════════════════

/**
 * Validate path array for NaN values.
 * Throws if any NaN found.
 */
export function validatePath(path: number[], label: string): void {
  for (let i = 0; i < path.length; i++) {
    if (!Number.isFinite(path[i])) {
      throw new Error(`NaN detected in ${label} at index ${i}`);
    }
  }
}

/**
 * Check if path has any NaN (non-throwing version).
 */
export function hasNaN(path: number[]): boolean {
  return path.some(v => !Number.isFinite(v));
}
