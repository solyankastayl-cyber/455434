/**
 * BLOCK 17: Feature Extractor
 * Extracts ML-ready features from price windows
 */

const EPS = 1e-12;

// ═══════════════════════════════════════════════════════════════
// STATISTICAL HELPERS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let v = 0;
  for (const x of arr) {
    const d = x - m;
    v += d * d;
  }
  return Math.sqrt(v / (arr.length - 1)) || 0;
}

function skewness(arr: number[]): number {
  if (arr.length < 3) return 0;
  const m = mean(arr);
  const s = std(arr) || EPS;
  let num = 0;
  for (const x of arr) {
    num += Math.pow((x - m) / s, 3);
  }
  return num / arr.length;
}

function kurtosis(arr: number[]): number {
  if (arr.length < 4) return 0;
  const m = mean(arr);
  const s = std(arr) || EPS;
  let num = 0;
  for (const x of arr) {
    num += Math.pow((x - m) / s, 4);
  }
  return num / arr.length;
}

function maxDrawdown(prices: number[]): number {
  if (prices.length === 0) return 0;
  let peak = prices[0];
  let maxDD = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = p / peak - 1; // <= 0
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Normalized slope via linear regression
 * Returns slope / mean(y) for scale-invariance
 */
function normalizedSlope(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;

  const xMean = (n - 1) / 2;
  const yMean = mean(series);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (series[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }

  const slope = den === 0 ? 0 : num / den;
  return yMean !== 0 ? slope / yMean : 0;
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type VolReg = 0 | 1 | 2;      // LOW_VOL / NORMAL_VOL / HIGH_VOL
export type TrendReg = -1 | 0 | 1;   // DOWN_TREND / SIDEWAYS / UP_TREND

export interface ExtractInput {
  closesWindow: number[];       // length = windowLen + 1 (prices)
  qualityWindow: number[];      // length = windowLen + 1 (0..1 scores)
  regimeVol: VolReg;
  regimeTrend: TrendReg;
  topMatchScore: number;
  avgTopKScore: number;
  regimeConsistency: number;    // 0..1
  effectiveSampleSize: number;
}

export interface FeatureVector {
  // Shape features
  meanLogRet: number;
  volLogRet: number;
  skewLogRet: number;
  kurtLogRet: number;
  slope90: number;
  maxDrawdownInWindow: number;

  // Context features
  avgQuality: number;
  regimeVol: VolReg;
  regimeTrend: TrendReg;

  // Match quality features
  topMatchScore: number;
  avgTopKScore: number;
  regimeConsistency: number;
  effectiveSampleSize: number;
}

// ═══════════════════════════════════════════════════════════════
// FEATURE EXTRACTOR
// ═══════════════════════════════════════════════════════════════

export class FeatureExtractor {
  /**
   * Extract ML-ready features from window data
   */
  extract(input: ExtractInput): FeatureVector {
    const closes = input.closesWindow;
    const q = input.qualityWindow;

    // Calculate log returns
    const r: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      r.push(Math.log((closes[i] + EPS) / (closes[i - 1] + EPS)));
    }

    // Slope using last 90 points (or full window if smaller)
    const slopeWindow = closes.slice(-Math.min(90, closes.length));
    const slope90 = normalizedSlope(slopeWindow);

    return {
      // Shape features
      meanLogRet: mean(r),
      volLogRet: std(r),
      skewLogRet: skewness(r),
      kurtLogRet: kurtosis(r),
      slope90,
      maxDrawdownInWindow: maxDrawdown(closes),

      // Context features
      avgQuality: mean(q),
      regimeVol: input.regimeVol,
      regimeTrend: input.regimeTrend,

      // Match quality features
      topMatchScore: input.topMatchScore,
      avgTopKScore: input.avgTopKScore,
      regimeConsistency: input.regimeConsistency,
      effectiveSampleSize: input.effectiveSampleSize
    };
  }

  /**
   * Convert regime string to numeric encoding
   */
  encodeVolRegime(vol: string): VolReg {
    if (vol === 'LOW_VOL') return 0;
    if (vol === 'NORMAL_VOL') return 1;
    return 2; // HIGH_VOL
  }

  encodeTrendRegime(trend: string): TrendReg {
    if (trend === 'DOWN_TREND') return -1;
    if (trend === 'UP_TREND') return 1;
    return 0; // SIDEWAYS
  }
}
