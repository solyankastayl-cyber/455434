/**
 * Market Structure Engine — HH/HL/LH/LL + Regime Detection
 * 
 * Analyzes pivot sequence to determine:
 * - Trend direction (uptrend, downtrend, range)
 * - HH/HL (Higher Highs / Higher Lows) patterns
 * - LH/LL (Lower Highs / Lower Lows) patterns
 * - Compression/consolidation detection
 * - Regime transitions
 */

import { MarketStructure, MarketRegime, Pivot, StructureConfig } from '../domain/types.js';

/**
 * Default structure configuration
 */
export const DEFAULT_STRUCTURE_CONFIG: StructureConfig = {
  lookbackPivots: 8
};

/**
 * Compute market structure from pivots
 */
export function computeMarketStructure(
  pivots: Pivot[],
  cfg: StructureConfig = DEFAULT_STRUCTURE_CONFIG
): MarketStructure {
  const k = cfg.lookbackPivots ?? 8;
  const recent = pivots.slice(-k);

  // Extract recent highs and lows
  const highs = recent.filter(p => p.type === "HIGH");
  const lows = recent.filter(p => p.type === "LOW");

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  // Calculate HH/HL score
  let score = 0;
  
  // Higher Highs check
  if (lastHigh && prevHigh) {
    score += lastHigh.price > prevHigh.price ? 0.5 : -0.5;
  }
  
  // Higher Lows check
  if (lastLow && prevLow) {
    score += lastLow.price > prevLow.price ? 0.5 : -0.5;
  }

  // Compression score: smaller swings = more compression
  const amp = computeSwingAmplitude(recent);
  const compressionScore = amp <= 0 ? 0 : Math.max(0, Math.min(1, 1 / (1 + amp)));

  // Determine regime
  let regime: MarketRegime = "TRANSITION";
  
  if (score >= 0.6) {
    regime = "TREND_UP";
  } else if (score <= -0.6) {
    regime = "TREND_DOWN";
  } else if (compressionScore > 0.5) {
    regime = "RANGE";
  } else {
    regime = "TRANSITION";
  }

  return {
    regime,
    lastSwingHigh: lastHigh,
    lastSwingLow: lastLow,
    hhhlScore: score,
    compressionScore,
  };
}

/**
 * Compute average swing amplitude (for compression detection)
 */
function computeSwingAmplitude(recent: Pivot[]): number {
  if (recent.length < 2) return 0;
  
  let sum = 0;
  let cnt = 0;
  
  for (let i = 1; i < recent.length; i++) {
    sum += Math.abs(recent[i].price - recent[i - 1].price);
    cnt++;
  }
  
  return cnt > 0 ? sum / cnt : 0;
}

/**
 * Detailed structure analysis
 */
export function analyzeStructure(pivots: Pivot[]): {
  higherHighs: boolean;
  higherLows: boolean;
  lowerHighs: boolean;
  lowerLows: boolean;
  consecutiveHH: number;
  consecutiveHL: number;
  consecutiveLH: number;
  consecutiveLL: number;
} {
  const highs = pivots.filter(p => p.type === "HIGH");
  const lows = pivots.filter(p => p.type === "LOW");
  
  // Check HH/HL/LH/LL sequences
  let consecutiveHH = 0;
  let consecutiveHL = 0;
  let consecutiveLH = 0;
  let consecutiveLL = 0;
  
  // Analyze highs
  for (let i = highs.length - 1; i > 0; i--) {
    if (highs[i].price > highs[i - 1].price) {
      consecutiveHH++;
    } else {
      break;
    }
  }
  
  for (let i = highs.length - 1; i > 0; i--) {
    if (highs[i].price < highs[i - 1].price) {
      consecutiveLH++;
    } else {
      break;
    }
  }
  
  // Analyze lows
  for (let i = lows.length - 1; i > 0; i--) {
    if (lows[i].price > lows[i - 1].price) {
      consecutiveHL++;
    } else {
      break;
    }
  }
  
  for (let i = lows.length - 1; i > 0; i--) {
    if (lows[i].price < lows[i - 1].price) {
      consecutiveLL++;
    } else {
      break;
    }
  }
  
  const recentHighs = highs.slice(-3);
  const recentLows = lows.slice(-3);
  
  return {
    higherHighs: recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price > recentHighs[recentHighs.length - 2].price,
    higherLows: recentLows.length >= 2 && recentLows[recentLows.length - 1].price > recentLows[recentLows.length - 2].price,
    lowerHighs: recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price < recentHighs[recentHighs.length - 2].price,
    lowerLows: recentLows.length >= 2 && recentLows[recentLows.length - 1].price < recentLows[recentLows.length - 2].price,
    consecutiveHH,
    consecutiveHL,
    consecutiveLH,
    consecutiveLL,
  };
}

/**
 * Check for trend exhaustion signals
 */
export function checkTrendExhaustion(pivots: Pivot[]): {
  uptrendExhaustion: boolean;
  downtrendExhaustion: boolean;
  signal: string | null;
} {
  const highs = pivots.filter(p => p.type === "HIGH").slice(-4);
  const lows = pivots.filter(p => p.type === "LOW").slice(-4);
  
  // Uptrend exhaustion: HH but LL (divergence)
  const uptrendExhaustion = 
    highs.length >= 2 && 
    lows.length >= 2 &&
    highs[highs.length - 1].price > highs[highs.length - 2].price &&
    lows[lows.length - 1].price < lows[lows.length - 2].price;
  
  // Downtrend exhaustion: LL but HH (divergence)
  const downtrendExhaustion = 
    highs.length >= 2 && 
    lows.length >= 2 &&
    lows[lows.length - 1].price < lows[lows.length - 2].price &&
    highs[highs.length - 1].price > highs[highs.length - 2].price;
  
  let signal: string | null = null;
  if (uptrendExhaustion) signal = "UPTREND_EXHAUSTION";
  if (downtrendExhaustion) signal = "DOWNTREND_EXHAUSTION";
  
  return { uptrendExhaustion, downtrendExhaustion, signal };
}
