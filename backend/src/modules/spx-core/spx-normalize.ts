/**
 * SPX CORE — Normalization Utils
 * 
 * BLOCK B5.2.1 — Normalize price series for similarity comparison
 */

/**
 * Normalize series to returns from first value
 * Result: [0, r1, r2, ...] where rN = (pN - p0) / p0
 */
export function normalizeSeries(series: number[]): number[] {
  if (series.length < 2) return series.map(() => 0);
  
  const base = series[0];
  if (base === 0) return series.map(() => 0);
  
  return series.map(v => (v - base) / base);
}

/**
 * Z-score normalization
 */
export function zScoreNormalize(series: number[]): number[] {
  if (series.length < 2) return series.map(() => 0);
  
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const std = Math.sqrt(
    series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / series.length
  );
  
  if (std === 0) return series.map(() => 0);
  
  return series.map(v => (v - mean) / std);
}

/**
 * Min-max normalization to [0, 1]
 */
export function minMaxNormalize(series: number[]): number[] {
  if (series.length < 2) return series.map(() => 0.5);
  
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min;
  
  if (range === 0) return series.map(() => 0.5);
  
  return series.map(v => (v - min) / range);
}

/**
 * Compute returns (day-to-day changes)
 */
export function computeReturns(series: number[]): number[] {
  if (series.length < 2) return [];
  
  const returns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev === 0) {
      returns.push(0);
    } else {
      returns.push((series[i] - prev) / prev);
    }
  }
  
  return returns;
}
