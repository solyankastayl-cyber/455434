/**
 * S10.W — Whale Intelligence Types
 * 
 * Data contracts for large position tracking and whale mechanics.
 * 
 * GUARDRAILS:
 * - NO signals / NO buy-sell / NO direction prediction
 * - Whales = measurements only
 * - Meta-Brain receives only downgrade / risk, not recommendations
 * 
 * LOCKED — Do not modify without explicit approval
 */

// ═══════════════════════════════════════════════════════════════
// ENUMS & CONSTANTS
// ═══════════════════════════════════════════════════════════════

export type WhaleSide = 'LONG' | 'SHORT';
export type WhaleEventType = 'OPEN' | 'CLOSE' | 'INCREASE' | 'DECREASE';
export type WhaleSourceType = 'api' | 'sdk' | 'mock' | 'synthetic';
export type WhaleSourceStatus = 'UP' | 'DEGRADED' | 'DOWN';
export type ExchangeId = 'hyperliquid' | 'binance' | 'bybit';

// Large position threshold multipliers
export const WHALE_THRESHOLDS = {
  // Position is "large" if > k × median position size
  SIZE_MULTIPLIER: 5,
  // Max USD for normalization
  MAX_POSITION_USD: 1_000_000_000, // 1B USD
  // Min USD to be considered whale
  MIN_WHALE_SIZE_USD: 100_000, // 100K USD
  // Top N positions to track
  TOP_POSITIONS_COUNT: 10,
} as const;

// ═══════════════════════════════════════════════════════════════
// 1. LARGE POSITION SNAPSHOT
// ═══════════════════════════════════════════════════════════════

/**
 * Snapshot of a single large position.
 * This is a FACT, not a prediction or signal.
 */
export interface LargePositionSnapshot {
  /** Exchange identifier */
  exchange: ExchangeId;
  
  /** Trading symbol (normalized: BTCUSDT, ETHUSDT) */
  symbol: string;
  
  /** Position side */
  side: WhaleSide;
  
  /** Position size in USD (normalized) */
  sizeUsd: number;
  
  /** Entry price (if available from source) */
  entryPrice?: number;
  
  /** Current mark price */
  markPrice?: number;
  
  /** Leverage (if available) */
  leverage?: number;
  
  /** When the position was detected/opened */
  openTimestamp: number;
  
  /** Last time we saw this position */
  lastSeenTimestamp: number;
  
  /** Source confidence: 0..1
   * - Hyperliquid: ~0.9-1.0 (on-chain, transparent)
   * - Binance/Bybit: ~0.4-0.6 (derived from OI/flow)
   */
  confidence: number;
  
  /** Data source type */
  source: WhaleSourceType;
  
  /** Unique identifier for this position */
  positionId?: string;
  
  /** Wallet address (if available, e.g., Hyperliquid) */
  wallet?: string;
}

// ═══════════════════════════════════════════════════════════════
// 2. WHALE EVENT
// ═══════════════════════════════════════════════════════════════

/**
 * Event representing a change in whale position.
 * Events are immutable facts.
 */
export interface WhaleEvent {
  /** Unique event ID */
  id: string;
  
  /** Exchange identifier */
  exchange: ExchangeId;
  
  /** Trading symbol */
  symbol: string;
  
  /** Event type */
  eventType: WhaleEventType;
  
  /** Position side */
  side: WhaleSide;
  
  /** Change in USD (positive for OPEN/INCREASE, negative for CLOSE/DECREASE) */
  deltaUsd: number;
  
  /** Total position size after event (if known) */
  totalSizeUsd?: number;
  
  /** Event timestamp */
  timestamp: number;
  
  /** Data source */
  source: WhaleSourceType;
  
  /** Position ID this event relates to */
  positionId?: string;
  
  /** Wallet address (if available) */
  wallet?: string;
  
  /** Additional metadata */
  meta?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// 3. WHALE MARKET STATE
// ═══════════════════════════════════════════════════════════════

/**
 * Aggregated whale state for a market (per tick).
 * This is the ONLY input for whale indicators.
 */
export interface WhaleMarketState {
  /** Exchange identifier */
  exchange: ExchangeId;
  
  /** Trading symbol */
  symbol: string;
  
  /** State timestamp */
  timestamp: number;
  
  // ─── Aggregated Positions ───
  
  /** Total long positions in USD */
  totalLongUsd: number;
  
  /** Total short positions in USD */
  totalShortUsd: number;
  
  /** Net bias: (long - short) / (long + short), range [-1, +1]
   * +1 = all whales long
   * -1 = all whales short
   */
  netBias: number;
  
  /** Number of whale positions (long) */
  whaleLongCount: number;
  
  /** Number of whale positions (short) */
  whaleShortCount: number;
  
  // ─── Top Positions ───
  
  /** Top N largest positions */
  topPositions: LargePositionSnapshot[];
  
  /** Maximum single position size */
  maxSinglePositionUsd: number;
  
  /** Median whale position size */
  medianPositionUsd: number;
  
  // ─── Risk Metrics ───
  
  /** Concentration Index: 0..1
   * 1 = market dominated by 1-2 whales
   * 0 = evenly distributed
   */
  concentrationIndex: number;
  
  /** Crowding Risk: 0..1
   * How much the crowd is positioned AGAINST whales
   * (used for PCAW indicator)
   */
  crowdingRisk: number;
  
  // ─── Meta ───
  
  /** Aggregated confidence (weighted by position size) */
  confidence: number;
  
  /** Data source */
  source: WhaleSourceType;
  
  /** Time since last whale activity (ms) */
  timeSinceLastActivity?: number;
}

// ═══════════════════════════════════════════════════════════════
// 4. WHALE SOURCE HEALTH
// ═══════════════════════════════════════════════════════════════

/**
 * Health status of a whale data source.
 */
export interface WhaleSourceHealth {
  /** Exchange identifier */
  exchange: ExchangeId;
  
  /** Current status */
  status: WhaleSourceStatus;
  
  /** Last successful update */
  lastUpdate: number;
  
  /** Symbols coverage: % of tracked symbols with data */
  coverage: number;
  
  /** Source confidence for this exchange */
  confidence: number;
  
  /** Number of positions tracked */
  positionsTracked: number;
  
  /** Error message if status is not UP */
  lastError?: string;
  
  /** Errors in last hour */
  errorCountLastHour: number;
}

// ═══════════════════════════════════════════════════════════════
// 5. WHALE INDICATORS (Input for indicator calculations)
// ═══════════════════════════════════════════════════════════════

/**
 * Calculated whale indicators (from WhaleMarketState).
 * Category: POSITIONING_EXT
 * 
 * These go into ExchangeObservationRow.indicators
 */
export interface WhaleIndicators {
  /** 
   * Large Position Presence (LPP): 0..1
   * Presence of oversized positions vs market baseline
   * Formula: clamp(maxSinglePositionUsd / (medianPositionUsd × k), 0, 1)
   */
  large_position_presence: number;
  
  /**
   * Whale Side Bias (WSB): -1..+1
   * Direction skew of whale positions
   * Formula: (totalLongUsd - totalShortUsd) / (totalLongUsd + totalShortUsd)
   */
  whale_side_bias: number;
  
  /**
   * Position Crowding Against Whales (PCAW): -1..+1
   * How much retail is positioned against whales
   * > +0.6 → crowd is pushing against whales
   * < -0.6 → crowd is following whales
   */
  position_crowding_against_whales: number;
  
  /**
   * Stop-Hunt Probability Index (SHPI): 0..1
   * Risk that market will hunt whale stops
   * Formula: 0.4 × PCAW + 0.3 × volatilitySpike + 0.3 × liquidityVacuum
   */
  stop_hunt_probability: number;
  
  /**
   * Large Position Survival Time (LPST): -1..+1
   * How long do whale positions survive?
   * Formula: log(timeAlive / medianWhaleLifetime)
   * < 0 → position likely to be liquidated soon
   * > 0 → position is stable
   */
  large_position_survival_time: number;
  
  /**
   * Contrarian Pressure Index (CPI): 0..1
   * Synthesis indicator - ideal conditions for whale squeeze
   * Formula: PCAW × SHPI × (1 - LPST_norm)
   * ≈ 1 → ideal conditions for whale liquidation
   * ≈ 0 → market is calm
   */
  contrarian_pressure_index: number;
}

// ═══════════════════════════════════════════════════════════════
// 6. STORAGE / QUERY TYPES
// ═══════════════════════════════════════════════════════════════

export interface WhaleSnapshotQuery {
  exchange?: ExchangeId;
  symbol?: string;
  side?: WhaleSide;
  minSizeUsd?: number;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface WhaleEventQuery {
  exchange?: ExchangeId;
  symbol?: string;
  eventType?: WhaleEventType;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface WhaleStateQuery {
  exchange?: ExchangeId;
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

// ═══════════════════════════════════════════════════════════════
// 7. API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface WhaleHealthResponse {
  sources: WhaleSourceHealth[];
  aggregatedStatus: WhaleSourceStatus;
  totalPositionsTracked: number;
  symbolsCovered: string[];
  lastGlobalUpdate: number;
}

export interface WhaleStateResponse {
  state: WhaleMarketState | null;
  indicators: WhaleIndicators | null;
  source: WhaleSourceType;
  timestamp: number;
}

export interface WhaleEventsResponse {
  events: WhaleEvent[];
  totalCount: number;
  startTime: number;
  endTime: number;
}

export interface WhaleSeedResponse {
  success: boolean;
  snapshotsCreated: number;
  eventsCreated: number;
  statesCreated: number;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// 8. INTEGRATION WITH OBSERVATION ROW
// ═══════════════════════════════════════════════════════════════

// Note: WhaleMeta is defined in observation.types.ts
// Re-exported here for convenience
export type { WhaleMeta } from '../observation/observation.types.js';

console.log('[S10.W] Whale Intelligence Types loaded');
