/**
 * TA Domain Types — Universal contract for entire TA "textbook"
 * 
 * This file defines the core types used by all detectors, engines,
 * and the ML layer. Changes here affect the entire system.
 * 
 * @version 2.0.0
 */

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME
// ═══════════════════════════════════════════════════════════════

export type TF = "1D"; // Fixed to 1D for MVP, contract ready to expand

// ═══════════════════════════════════════════════════════════════
// CANDLE & SERIES
// ═══════════════════════════════════════════════════════════════

export type Candle = {
  ts: number;          // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type Series = {
  asset: string;
  tf: TF;
  candles: Candle[];
};

// ═══════════════════════════════════════════════════════════════
// PIVOTS
// ═══════════════════════════════════════════════════════════════

export type PivotType = "HIGH" | "LOW";

export type Pivot = {
  i: number;           // candle index
  ts: number;
  price: number;
  type: PivotType;
  strength: number;    // how significant the pivot is (core metric)
};

// ═══════════════════════════════════════════════════════════════
// MARKET STRUCTURE
// ═══════════════════════════════════════════════════════════════

export type MarketRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "TRANSITION";

export type MarketStructure = {
  regime: MarketRegime;
  lastSwingHigh?: Pivot;
  lastSwingLow?: Pivot;
  hhhlScore: number;   // +1 .. -1 (uptrend vs downtrend)
  compressionScore: number; // 0..1
};

// ═══════════════════════════════════════════════════════════════
// SUPPORT / RESISTANCE LEVELS
// ═══════════════════════════════════════════════════════════════

export type LevelZone = {
  id: string;
  price: number;       // central level price
  band: number;        // zone width (in price units)
  touches: number;
  lastTouchTs: number;
  strength: number;    // 0..1
  type: "SUPPORT" | "RESISTANCE" | "BOTH";
};

// ═══════════════════════════════════════════════════════════════
// TA CONTEXT — Unified context for all detectors
// ═══════════════════════════════════════════════════════════════

export type TAContext = {
  series: Series;

  // core indicators
  atr: number[];
  returns1d: number[];
  logPrice: number[];

  // MAs (computed upfront, used by many detectors)
  ma50: number[];
  ma200: number[];
  maSlope50: number[];
  maSlope200: number[];

  // core geometry
  pivots: Pivot[];
  structure: MarketStructure;
  levels: LevelZone[];

  // universal features for detectors & ML
  features: Record<string, number>;

  // Phase 7: Feature Pack (structured features)
  featuresPack?: FeaturePack;
};

// ═══════════════════════════════════════════════════════════════
// FEATURE PACK — Phase 7 structured features for ML & scoring
// ═══════════════════════════════════════════════════════════════

export type MAPack = {
  ma20: number;
  ma50: number;
  ma200: number;
  slope20: number;
  slope50: number;
  slope200: number;
  dist20: number;   // (price / ma - 1)
  dist50: number;
  dist200: number;
  cross50_200: -1 | 0 | 1; // -1 death cross, +1 golden cross, 0 none
  alignment: "BULL" | "BEAR" | "MIXED"; // ma20 > ma50 > ma200 = BULL
};

export type FibSwing = {
  fromIdx: number;
  toIdx: number;
  fromPrice: number;
  toPrice: number;
  dir: "UP" | "DOWN";
  amplitude: number;
};

export type FibRetrace = {
  r236: number;
  r382: number;
  r50: number;
  r618: number;
  r786: number;
  goldenPocketLow: number;  // 0.618
  goldenPocketHigh: number; // 0.65
  priceInGoldenPocket: boolean;
  nearestLevel: number;
  nearestRatio: number;
};

export type FibExtension = {
  e1272: number;
  e1618: number;
  e2618: number;
};

export type FibPack = {
  swing: FibSwing | null;
  retrace: FibRetrace | null;
  ext: FibExtension | null;
  distToNearestLevel: number; // abs(price - nearest) / price
};

export type VolRegime = "LOW" | "NORMAL" | "HIGH";

export type VolPack = {
  atrNow: number;
  atrPct: number;         // atr / price
  atrPctile: number;      // 0..1 percentile over lookback
  regime: VolRegime;
  compression: number;    // from structure.compressionScore
  volGate: number;        // 0..1 multiplier for scoring
};

export type FeaturePack = {
  ma: MAPack;
  fib: FibPack;
  vol: VolPack;
};

// ═══════════════════════════════════════════════════════════════
// PATTERN TYPES — Full "textbook" of patterns
// ═══════════════════════════════════════════════════════════════

export type PatternType =
  // Chart Patterns
  | "TRIANGLE_ASC" | "TRIANGLE_DESC" | "TRIANGLE_SYM"
  | "FLAG_BULL" | "FLAG_BEAR"
  | "WEDGE_RISING" | "WEDGE_FALLING"
  | "HNS" | "IHNS"
  | "DOUBLE_TOP" | "DOUBLE_BOTTOM"
  | "TRIPLE_TOP" | "TRIPLE_BOTTOM"
  | "CUP_HANDLE"
  // Harmonic Patterns
  | "GARTLEY" | "BAT" | "BUTTERFLY" | "CRAB" | "ABCD" | "CYPHER"
  // Candlestick Patterns
  | "CANDLE_ENGULF_BULL" | "CANDLE_ENGULF_BEAR"
  | "CANDLE_PIN" | "CANDLE_DOJI"
  | "CANDLE_HAMMER" | "CANDLE_SHOOTING_STAR"
  | "CANDLE_MORNING_STAR" | "CANDLE_EVENING_STAR"
  // Level Patterns
  | "LEVEL_BREAKOUT" | "LEVEL_RETEST" | "LEVEL_BOUNCE"
  // Trend Patterns
  | "CHANNEL_UP" | "CHANNEL_DOWN" | "CHANNEL_HORIZONTAL"
  | "TRENDLINE_BREAK"
  // Fibonacci
  | "FIB_RETRACE" | "FIB_EXT"
  // Divergences
  | "DIVERGENCE_BULL" | "DIVERGENCE_BEAR"
  | "HIDDEN_DIV_BULL" | "HIDDEN_DIV_BEAR"
  // Other
  | "OTHER";

// ═══════════════════════════════════════════════════════════════
// CANDIDATE PATTERN — Output from detectors
// ═══════════════════════════════════════════════════════════════

export type CandidatePattern = {
  id: string;
  type: PatternType;
  tf: TF;
  asset: string;

  startTs: number;
  endTs: number;
  startIdx: number;
  endIdx: number;

  // Direction signal
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";

  // Geometry — for frontend rendering
  geometry: {
    pivots?: Pivot[];
    lines?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
    zones?: Array<{ price: number; band: number }>;
    targets?: Array<{ price: number; label: string }>;
    [key: string]: any;
  };

  // Quality metrics — for ranking
  metrics: {
    geometryScore: number;      // how well does it match ideal pattern
    touchScore: number;         // how many valid touches
    symmetryScore: number;      // pattern symmetry
    durationScore: number;      // appropriate duration
    noiseScore: number;         // inverse of noise (1 = clean)
    volumeScore?: number;       // volume confirmation
    totalScore: number;         // weighted combination
  };

  // Context at detection time
  context: {
    regime: MarketRegime;
    atr: number;
    currentPrice: number;
    maContext?: {
      priceVsMa50: number;      // price / ma50 - 1
      priceVsMa200: number;
      ma50VsMa200: number;      // ma50 / ma200 - 1
      maSlope50: number;
      maSlope200: number;
    };
    fibContext?: {
      retracementLevel?: number; // 0.382, 0.5, 0.618, etc.
      extensionLevel?: number;
    };
  };

  // Trading parameters (if pattern suggests a trade)
  trade?: {
    entry: number;
    stop: number;
    target1: number;
    target2?: number;
    riskReward: number;
  };
};

// ═══════════════════════════════════════════════════════════════
// DETECTOR INTERFACE — Contract for all pattern detectors
// ═══════════════════════════════════════════════════════════════

export interface Detector {
  id: string;
  name: string;
  types: PatternType[];
  version: string;
  
  /**
   * Detect patterns from TA context
   * @param ctx - Pre-computed TA context with pivots, structure, etc.
   * @returns Array of candidate patterns found
   */
  detect(ctx: TAContext): CandidatePattern[];
}

// ═══════════════════════════════════════════════════════════════
// ENGINE CONFIGS
// ═══════════════════════════════════════════════════════════════

export type PivotConfig = {
  atrMult: number;         // reversal threshold: ATR * atrMult
  minBarsBetween: number;  // minimum distance between pivots
  minMovePct?: number;     // additional % threshold (protection on very low ATR)
};

export type StructureConfig = {
  lookbackPivots: number;  // how many recent pivots to analyze
};

export type LevelConfig = {
  atrBandMult: number;     // zone width = ATR * atrBandMult
  minTouches: number;      // minimum touches to form a level
  maxLevels: number;       // maximum levels to return
  decayFactor: number;     // strength decay over time
};

export type TAEngineConfig = {
  atrPeriod: number;
  pivot: PivotConfig;
  structure: StructureConfig;
  levels: LevelConfig;
};

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIGS
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_TA_CONFIG: TAEngineConfig = {
  atrPeriod: 14,
  pivot: {
    atrMult: 1.5,
    minBarsBetween: 3,
    minMovePct: 0.003  // 0.3%
  },
  structure: {
    lookbackPivots: 8
  },
  levels: {
    atrBandMult: 0.5,
    minTouches: 2,
    maxLevels: 10,
    decayFactor: 0.95
  }
};
