/**
 * EXCHANGE ALT SCANNER — Types & Contracts
 * =========================================
 * 
 * Cross-sectional analysis of altcoins universe.
 * Answers: "Why these alts are moving today, and who's next?"
 */

// ═══════════════════════════════════════════════════════════════
// BASIC TYPES
// ═══════════════════════════════════════════════════════════════

export type Venue = 'BINANCE' | 'BYBIT' | 'COINBASE' | 'HYPERLIQUID' | 'MOCK';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type Horizon = '1h' | '4h' | '24h';

export type Direction = 'UP' | 'DOWN' | 'FLAT';

export type AltFacet =
  | 'MOMENTUM'
  | 'MEAN_REVERSION'
  | 'BREAKOUT'
  | 'SQUEEZE'
  | 'FUNDING_FLIP'
  | 'OI_SPIKE'
  | 'VOLUME_ANOMALY'
  | 'LIQUIDATION_FLUSH';

// ═══════════════════════════════════════════════════════════════
// UNIVERSE
// ═══════════════════════════════════════════════════════════════

export interface UniverseAsset {
  symbol: string;      // e.g. "SOLUSDT"
  base: string;        // "SOL"
  quote: string;       // "USDT"
  venue: Venue;
  enabled: boolean;
  tags?: string[];     // e.g. ["L1", "AI", "MEME", "DEFI"]
  marketCap?: number;
  avgVolume24h?: number;
}

// ═══════════════════════════════════════════════════════════════
// MARKET DATA
// ═══════════════════════════════════════════════════════════════

export interface MarketOHLCV {
  ts: number;          // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DerivativesSnapshot {
  fundingRate?: number;           // e.g. 0.0001 (0.01%)
  openInterest?: number;          // USD notional
  openInterestDelta1h?: number;   // % change
  longShortRatio?: number;        // 0..1 (long share) or raw ratio
  liquidationBuyUsd?: number;     // 24h
  liquidationSellUsd?: number;    // 24h
  basis?: number;                 // perp vs spot spread
}

export interface TickerSnapshot {
  symbol: string;
  lastPrice: number;
  priceChange24h: number;
  priceChangePct24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR VECTOR (normalized features)
// ═══════════════════════════════════════════════════════════════

export interface IndicatorVector {
  symbol: string;
  ts: number;
  venue: Venue;
  
  // Price / Momentum
  rsi_14: number;
  rsi_z: number;              // z-score
  momentum_1h: number;        // % return
  momentum_4h: number;
  momentum_24h: number;
  trend_score: number;        // -1..+1
  
  // Volatility
  atr_pct: number;            // ATR as % of price
  volatility_z: number;
  vol_regime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  
  // Derivatives / Positioning
  funding_rate: number;
  funding_z: number;
  oi_change_1h: number;
  oi_z: number;
  long_share: number;         // 0..1
  long_bias: number;          // -1..+1 (deviation from neutral)
  
  // Liquidations
  liq_imbalance: number;      // sell - buy (normalized)
  liq_z: number;
  cascade_risk: number;       // 0..1
  
  // Market Structure
  breakout_score: number;     // 0..1
  meanrev_score: number;      // 0..1
  squeeze_score: number;      // 0..1
  
  // Flags (binary/derived)
  oversold_flag: boolean;
  overbought_flag: boolean;
  squeeze_flag: boolean;
  crowded_trade_flag: boolean;
  
  // Quality
  quality: {
    coverage: number;         // 0..1 (how many features available)
    missing: string[];        // list of missing features
  };
  
  // Raw values for debugging
  meta?: {
    price: number;
    volume: number;
    funding_raw: number;
    oi_raw: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// PATTERN CLUSTERING
// ═══════════════════════════════════════════════════════════════

export interface PatternSignature {
  key: string;                          // hash of bins
  bins: Record<string, string | number>;  // discretized features
}

export interface PatternCluster {
  clusterId: string;
  ts: number;
  venue: Venue;
  tf: Timeframe;
  
  signature: PatternSignature;
  centroid: Record<string, number>;     // mean feature values
  topFeatures: Array<{ k: string; v: number }>;
  
  members: string[];                    // symbols
  size: number;
  dispersion: number;                   // avg distance to centroid
  
  label?: string;                       // heuristic: "OVERSOLD_SQUEEZE"
  
  // Performance (filled by outcome tracker)
  performance?: {
    horizon: Horizon;
    avgReturn: number;
    winRate: number;
    strength: number;
    samples: number;
  };
}

export interface ClusterMembership {
  symbol: string;
  clusterId: string;
  ts: number;
  venue: Venue;
  tf: Timeframe;
  
  distance: number;                     // to centroid
  similarity: number;                   // 0..1
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY RANKING
// ═══════════════════════════════════════════════════════════════

export interface AltOpportunity {
  symbol: string;
  ts: number;
  venue: Venue;
  
  // Scoring
  opportunityScore: number;             // 0..100
  confidence: number;                   // 0..1
  
  // Components
  similarity: number;                   // to winning pattern
  clusterStrength: number;              // how well cluster performed
  momentumPenalty: number;              // if already moved
  freshness: number;                    // how new is the setup
  
  // Context
  clusterId: string;
  clusterLabel?: string;
  facet: AltFacet;
  direction: Direction;
  
  // Explainability
  reasons: string[];
  vector: IndicatorVector;
  
  // Expected outcome
  expectedMove?: {
    horizon: Horizon;
    minPct: number;
    maxPct: number;
    probability: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSES
// ═══════════════════════════════════════════════════════════════

export interface AltRadarResponse {
  ok: boolean;
  asOf: number;
  venue: Venue;
  universeSize: number;
  
  // Top opportunities
  topLongs: AltOpportunity[];
  topShorts: AltOpportunity[];
  topMeanReversion: AltOpportunity[];
  
  // Cluster overview
  clusters: PatternCluster[];
  hotClusters: PatternCluster[];        // clusters with recent performance
  
  // Market context
  marketContext?: {
    btcBias: Direction;
    overallSentiment: number;           // -1..+1
    dominantFacet: AltFacet;
  };
}

export interface AltClusterDetailResponse {
  ok: boolean;
  cluster: PatternCluster;
  members: Array<{
    symbol: string;
    similarity: number;
    currentReturn: number;
    opportunity: AltOpportunity | null;
  }>;
  historicalPerformance?: {
    avgWinRate: number;
    avgReturn: number;
    occurrences: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME TRACKING
// ═══════════════════════════════════════════════════════════════

export interface AltOutcome {
  symbol: string;
  ts: number;
  venue: Venue;
  
  horizon: Horizon;
  priceAtSignal: number;
  priceAtHorizon: number;
  returnPct: number;
  
  clusterId?: string;
  opportunityScore?: number;
  
  label: 'TP' | 'FP' | 'FN' | 'TN' | 'WEAK';
  directionCorrect: boolean;
}

export interface ClusterOutcome {
  clusterId: string;
  ts: number;
  venue: Venue;
  tf: Timeframe;
  horizon: Horizon;
  
  avgReturn: number;
  medianReturn: number;
  winRate: number;
  strength: number;                     // |avgReturn| * winRate
  samples: number;
}

console.log('[ExchangeAlt] Types loaded');
