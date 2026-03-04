/**
 * NORMALIZATION UTILITIES — A2
 * 
 * Pure functions for price normalization and mapping.
 * No side effects, no DB access.
 */

// ═══════════════════════════════════════════════════════════════
// toPctFromFirst — Normalize relative to first price
// ═══════════════════════════════════════════════════════════════

export function toPctFromFirst(prices: number[]): number[] {
  if (!prices?.length) return [];
  const base = prices[0];
  if (!isFinite(base) || base === 0) return prices.map(() => 0);
  return prices.map((p) => (p / base) - 1);
}

// ═══════════════════════════════════════════════════════════════
// toPctFromLast — Normalize aftermath relative to last window price
// Returns returns relative to match_end (historical perspective)
// ═══════════════════════════════════════════════════════════════

export function toPctFromLast(windowPrices: number[], afterPrices: number[]): number[] {
  if (!windowPrices?.length || !afterPrices?.length) return afterPrices?.map(() => 0) || [];
  const base = windowPrices[windowPrices.length - 1];
  if (!isFinite(base) || base === 0) return afterPrices.map(() => 0);
  return afterPrices.map((p) => (p / base) - 1);
}

// ═══════════════════════════════════════════════════════════════
// mapPctToPrice — Convert pct back to price using base
// ═══════════════════════════════════════════════════════════════

export function mapPctToPrice(basePrice: number, pct: number): number {
  if (!isFinite(basePrice)) return NaN;
  if (!isFinite(pct)) return NaN;
  return basePrice * (1 + pct);
}

// ═══════════════════════════════════════════════════════════════
// decadeFromISO — Extract decade string from ISO date
// ═══════════════════════════════════════════════════════════════

export function decadeFromISO(isoDate: string | Date | undefined): string {
  let dateStr: string;
  
  if (isoDate instanceof Date) {
    dateStr = isoDate.toISOString().split('T')[0];
  } else if (typeof isoDate === 'string') {
    dateStr = isoDate;
  } else {
    return 'unknown';
  }
  
  const y = Number(dateStr?.slice(0, 4));
  if (!isFinite(y)) return 'unknown';
  const d = Math.floor(y / 10) * 10;
  return `${d}s`;
}

// ═══════════════════════════════════════════════════════════════
// normalizeWindow — Normalize to [0, 1] range (for similarity)
// ═══════════════════════════════════════════════════════════════

export function normalizeToRange(prices: number[]): number[] {
  if (!prices?.length) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  if (range === 0) return prices.map(() => 0.5);
  return prices.map(v => (v - min) / range);
}

// ═══════════════════════════════════════════════════════════════
// computeSimilarity — Correlation-based similarity [0, 1]
// ═══════════════════════════════════════════════════════════════

export function computeSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  
  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  
  // Convert correlation [-1, 1] to similarity [0, 1]
  const corr = num / den;
  return (corr + 1) / 2;
}
