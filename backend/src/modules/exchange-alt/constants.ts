/**
 * EXCHANGE ALT SCANNER — Constants
 * =================================
 */

// Default universe (top alts by volume/liquidity)
export const ALT_DEFAULT_UNIVERSE: string[] = [
  // Layer 1
  'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'DOTUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT', 'SUIUSDT',
  // Layer 2 / Scaling
  'MATICUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT',
  // DeFi
  'LINKUSDT', 'UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'SNXUSDT',
  // Meme / Community
  'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'WIFUSDT', 'BONKUSDT',
  // AI / Data
  'FETUSDT', 'RENDERUSDT', 'TAOUSDT',
  // Exchange tokens
  'BNBUSDT', 'FTMUSDT',
  // Others
  'XRPUSDT', 'ADAUSDT', 'LTCUSDT', 'BCHUSDT', 'ETCUSDT',
];

// Feature dimensions for clustering
export const ALT_FEATURE_KEYS = [
  'rsi_z',
  'momentum_1h',
  'momentum_4h',
  'volatility_z',
  'funding_z',
  'oi_z',
  'long_bias',
  'liq_z',
  'trend_score',
  'breakout_score',
  'meanrev_score',
  'squeeze_score',
] as const;

export const ALT_FEATURE_DIM = ALT_FEATURE_KEYS.length;

// Job intervals
export const ALT_OBSERVATION_INTERVAL_MS = 5 * 60 * 1000;   // 5 min
export const ALT_CLUSTER_INTERVAL_MS = 15 * 60 * 1000;      // 15 min
export const ALT_OUTCOME_INTERVAL_MS = 5 * 60 * 1000;       // 5 min

// Clustering params
export const DBSCAN_EPS = 0.25;
export const DBSCAN_MIN_PTS = 3;

// Scoring weights
export const ALT_SCORE_WEIGHTS = {
  similarity: 0.30,
  clusterStrength: 0.35,
  freshness: 0.15,
  momentumPenalty: 0.20,
} as const;

// Thresholds
export const ALT_THRESHOLDS = {
  minClusterStrength: 0.3,
  minSimilarity: 0.5,
  oversoldRsi: 30,
  overboughtRsi: 70,
  highFundingZ: 1.5,
  lowFundingZ: -1.5,
  squeezeFundingThreshold: 0.0003,
  crowdedLongShare: 0.7,
  crowdedShortShare: 0.3,
} as const;

console.log('[ExchangeAlt] Constants loaded');
