/**
 * S10.6I.0 — Market Indicators Layer
 * 
 * CONTRACTS (LOCKED)
 * 
 * Indicators = SENSORS, not SIGNALS.
 * - Pure measurements
 * - No business logic
 * - No if/else decisions
 * - No buy/sell
 * 
 * Each indicator outputs ONE NUMBER.
 */

// ═══════════════════════════════════════════════════════════════
// INDICATOR CATEGORIES
// ═══════════════════════════════════════════════════════════════

export type IndicatorCategory =
  | 'PRICE_STRUCTURE'    // S10.6I.1 — where price is relative to itself
  | 'MOMENTUM'           // S10.6I.2 — energy of movement
  | 'VOLUME'             // S10.6I.3 — participation (future)
  | 'ORDER_BOOK'         // S10.6I.4 — depth physics (future)
  | 'POSITIONING'        // S10.6I.5 — derivatives positioning (future)
  | 'WHALE_POSITIONING'; // S10.W — whale/large position mechanics

// ═══════════════════════════════════════════════════════════════
// INDICATOR VALUE (core contract)
// ═══════════════════════════════════════════════════════════════

export interface IndicatorValue {
  /** Unique indicator ID (e.g., 'ema_distance_fast') */
  id: string;
  
  /** Category for grouping */
  category: IndicatorCategory;
  
  /** Raw calculated value */
  value: number;
  
  /** Is value normalized to standard range? */
  normalized: boolean;
  
  /** Human-readable interpretation */
  interpretation: string;
  
  /** Timestamp of calculation */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR DEFINITION (metadata)
// ═══════════════════════════════════════════════════════════════

export interface IndicatorDefinition {
  /** Unique ID */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Category */
  category: IndicatorCategory;
  
  /** Description of what it measures */
  description: string;
  
  /** Formula (for documentation) */
  formula: string;
  
  /** Expected value range */
  range: {
    min: number;
    max: number;
  };
  
  /** Is output normalized? */
  normalized: boolean;
  
  /** What values mean */
  interpretations: {
    low: string;
    neutral: string;
    high: string;
  };
  
  /** Dependencies on other indicators */
  dependencies: string[];
  
  /** Parameters for calculation */
  parameters: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR SNAPSHOT (full state at a moment)
// ═══════════════════════════════════════════════════════════════

export interface IndicatorSnapshot {
  symbol: string;
  timestamp: number;
  
  /** All indicator values */
  indicators: IndicatorValue[];
  
  /** By category for easy access */
  byCategory: Record<IndicatorCategory, IndicatorValue[]>;
  
  /** Quick lookup by ID */
  byId: Record<string, IndicatorValue>;
  
  /** Metadata */
  calculatedAt: number;
  calculationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR INPUT (market data for calculation)
// ═══════════════════════════════════════════════════════════════

export interface IndicatorInput {
  symbol: string;
  
  /** OHLCV candles (most recent last) */
  candles: OHLCVCandle[];
  
  /** Current price */
  price: number;
  
  /** Volume data */
  volume?: {
    total: number;
    buy: number;
    sell: number;
  };
  
  /** Order book data */
  orderBook?: {
    bidDepth: number;
    askDepth: number;
    spread: number;
    imbalance: number;
  };
  
  /** Open interest */
  openInterest?: {
    value: number;
    delta: number;
  };
  
  /** Funding rate */
  fundingRate?: number;
}

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ═══════════════════════════════════════════════════════════════
// CALCULATOR INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface IndicatorCalculator {
  /** Definition of this indicator */
  definition: IndicatorDefinition;
  
  /** Calculate the indicator value */
  calculate(input: IndicatorInput): IndicatorValue;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR IDs (CANONICAL)
// ═══════════════════════════════════════════════════════════════

export const INDICATOR_IDS = {
  // S10.6I.1 — Price Structure
  PRICE_STRUCTURE: {
    EMA_DISTANCE_FAST: 'ema_distance_fast',
    EMA_DISTANCE_MID: 'ema_distance_mid',
    EMA_DISTANCE_SLOW: 'ema_distance_slow',
    VWAP_DEVIATION: 'vwap_deviation',
    MEDIAN_PRICE_DEVIATION: 'median_price_deviation',
    ATR_NORMALIZED: 'atr_normalized',
    TREND_SLOPE: 'trend_slope',
    RANGE_COMPRESSION: 'range_compression',
  },
  
  // S10.6I.2 — Momentum
  MOMENTUM: {
    RSI: 'rsi_normalized',
    STOCHASTIC: 'stochastic',
    MACD_DELTA: 'macd_delta',
    ROC: 'roc',
    MOMENTUM_DECAY: 'momentum_decay',
    DIRECTIONAL_BALANCE: 'directional_momentum_balance',
  },
  
  // S10.6I.3 — Volume (future)
  VOLUME: {
    VOLUME_INDEX: 'volume_index',
    VOLUME_DELTA: 'volume_delta',
    BUY_SELL_RATIO: 'buy_sell_ratio',
    VOLUME_PRICE_RESPONSE: 'volume_price_response',
    RELATIVE_VOLUME: 'relative_volume',
    PARTICIPATION_INTENSITY: 'participation_intensity',
  },
  
  // S10.6I.4 — Order Book (future)
  ORDER_BOOK: {
    IMBALANCE: 'book_imbalance',
    DEPTH_DENSITY: 'depth_density',
    LIQUIDITY_WALLS: 'liquidity_walls',
    ABSORPTION_STRENGTH: 'absorption_strength',
    LIQUIDITY_VACUUM: 'liquidity_vacuum',
    SPREAD_PRESSURE: 'spread_pressure',
  },
  
  // S10.6I.5 — Positioning (future)
  POSITIONING: {
    OI_LEVEL: 'oi_level',
    OI_DELTA: 'oi_delta',
    OI_VOLUME_RATIO: 'oi_volume_ratio',
    FUNDING_PRESSURE: 'funding_pressure',
    LONG_SHORT_RATIO: 'long_short_ratio',
    POSITION_CROWDING: 'position_crowding',
  },
  
  // S10.W — Whale Positioning (Large Position Mechanics)
  WHALE_POSITIONING: {
    LARGE_POSITION_PRESENCE: 'large_position_presence',
    WHALE_SIDE_BIAS: 'whale_side_bias',
    POSITION_CROWDING_AGAINST_WHALES: 'position_crowding_against_whales',
    STOP_HUNT_PROBABILITY: 'stop_hunt_probability',
    LARGE_POSITION_SURVIVAL_TIME: 'large_position_survival_time',
    CONTRARIAN_PRESSURE_INDEX: 'contrarian_pressure_index',
  },
} as const;

// Total: 36 indicators (30 base + 6 whale)
export const TOTAL_INDICATORS = 36;

console.log('[S10.6I] Indicator types loaded');
