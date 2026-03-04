/**
 * DXY NORMALIZE SERVICE — Shape Normalization
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

// ═══════════════════════════════════════════════════════════════
// CUMULATIVE SHAPE NORMALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize prices to cumulative returns from start
 * normalized[i] = close[i] / close[0] - 1
 */
export function normalizeWindow(closes: number[]): number[] {
  if (!closes || closes.length < 2) return [];
  
  const base = closes[0];
  if (base === 0 || isNaN(base)) return [];
  
  return closes.map(v => (v / base) - 1);
}

// ═══════════════════════════════════════════════════════════════
// DAILY RETURNS NORMALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Convert to daily returns
 * return[i] = (close[i] / close[i-1]) - 1
 */
export function toDailyReturns(closes: number[]): number[] {
  if (!closes || closes.length < 2) return [];
  
  const returns: number[] = [0]; // First day return is 0
  
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] === 0) {
      returns.push(0);
    } else {
      returns.push((closes[i] / closes[i - 1]) - 1);
    }
  }
  
  return returns;
}

// ═══════════════════════════════════════════════════════════════
// DENORMALIZE (for projections)
// ═══════════════════════════════════════════════════════════════

/**
 * Convert normalized returns back to absolute prices
 */
export function denormalize(normalized: number[], basePrice: number): number[] {
  return normalized.map(n => basePrice * (1 + n));
}
