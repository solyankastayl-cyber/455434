/**
 * BLOCK 37.1 — Multi-Representation Similarity Contracts
 * 
 * Type definitions for multi-rep similarity matching:
 * - raw_returns: log returns (existing)
 * - vol_shape: volatility profile (ATR/Std)
 * - dd_shape: drawdown path signature
 * - momo: momentum slope (optional)
 */

export type SimilarityModeV2 =
  | "raw_returns"     // legacy single-rep
  | "multi_rep";      // NEW: ensemble representations

export type RepKey =
  | "ret"       // raw returns
  | "vol"       // volatility shape
  | "dd"        // drawdown shape
  | "momo";     // momentum slope (optional, cheap)

export interface MultiRepConfig {
  enabled: boolean;
  reps: RepKey[];                              // default: ["ret","vol","dd"]
  repWeights: Partial<Record<RepKey, number>>; // must sum ~1.0 (we normalize)
  
  // shape params
  volLookback?: number;    // default 14
  ddLookback?: number;     // default windowLen
  slopeLookback?: number;  // default 10
  
  // normalization
  zscoreWithinWindow?: boolean; // default false (avoid distribution leakage)
  l2Normalize?: boolean;        // default true
}

export interface SimilarityConfigV2 {
  mode: SimilarityModeV2;
  multi?: MultiRepConfig;
}

export interface WindowRepVectors {
  rep: RepKey;
  vec: number[];        // numeric vector
}

export interface MultiRepScore {
  total: number;
  byRep: Partial<Record<RepKey, number>>;
  weights: Partial<Record<RepKey, number>>;
}

// Default multi-rep configuration
export const DEFAULT_MULTI_REP_CONFIG: MultiRepConfig = {
  enabled: true,
  reps: ["ret", "vol", "dd"],
  repWeights: { ret: 0.50, vol: 0.30, dd: 0.20 },
  volLookback: 14,
  slopeLookback: 10,
  zscoreWithinWindow: false,
  l2Normalize: true,
};
