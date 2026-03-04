/**
 * CANONICAL ASSET TYPES
 * =====================
 * 
 * Asset = primary entity. Exchanges = observation sources.
 * No single-source, no union. Truth resolver decides.
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// VENUES (EXCHANGES)
// ═══════════════════════════════════════════════════════════════

export type VenueId = 'BINANCE' | 'BYBIT' | 'COINBASE' | 'HYPERLIQUID';

export const VENUE_PRIORITY: VenueId[] = [
  'BINANCE',
  'BYBIT', 
  'COINBASE',
  'HYPERLIQUID',
];

export type VenueStatus = 'ACTIVE' | 'INACTIVE' | 'DEGRADED' | 'UNKNOWN';

export interface VenueConfig {
  status: VenueStatus;
  pairs: string[];
  primaryPair?: string;
  lastUpdate?: number;
}

// ═══════════════════════════════════════════════════════════════
// CANONICAL ASSET
// ═══════════════════════════════════════════════════════════════

export type LiquidityProfile = 
  | 'SINGLE_VENUE'   // Only on one exchange
  | 'MULTI_VENUE'    // Available on 2+ exchanges
  | 'FRAGMENTED'     // Scattered with low liquidity
  | 'UNKNOWN';

export interface CanonicalAsset {
  /** Asset ID (e.g., "BTC", "ETH", "SOL") */
  assetId: string;
  
  /** Display symbol */
  symbol: string;
  
  /** Full name */
  name: string;
  
  /** Venues where asset is available */
  venues: Partial<Record<VenueId, VenueConfig>>;
  
  /** Primary quote currency */
  primaryQuote: 'USDT' | 'USD' | 'USDC';
  
  /** Liquidity profile */
  liquidityProfile: LiquidityProfile;
  
  /** Is this asset actively tracked? */
  isTracked: boolean;
  
  /** Metadata */
  meta?: {
    category?: string;
    marketCap?: number;
    rank?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// VENUE OBSERVATION
// ═══════════════════════════════════════════════════════════════

export interface VenueObservation {
  /** Venue source */
  venue: VenueId;
  
  /** Asset being observed */
  asset: string;
  
  /** Trading pair */
  pair: string;
  
  /** Current price */
  price: number;
  
  /** 24h volume in quote currency */
  volume24h: number;
  
  /** 1h volume in quote currency */
  volume1h?: number;
  
  /** Bid-ask spread (%) */
  spread: number;
  
  /** Data latency (ms) */
  latencyMs: number;
  
  /** Trust score (0..1) */
  trustScore: number;
  
  /** Observation timestamp */
  observedAt: number;
  
  /** Is data fresh? */
  isFresh: boolean;
  
  /** Any anomalies detected? */
  anomalies?: string[];
}

// ═══════════════════════════════════════════════════════════════
// RESOLVED ASSET STATE (TRUTH)
// ═══════════════════════════════════════════════════════════════

export interface ResolvedAssetState {
  /** Asset ID */
  asset: string;
  
  /** Resolved price (truth) */
  price: number;
  
  /** Price change 24h (%) */
  priceChange24h: number;
  
  /** Confidence in resolved price (0..1) */
  confidence: number;
  
  /** Sources actually used */
  sourcesUsed: VenueId[];
  
  /** Sources ignored and why */
  sourcesIgnored: Array<{ venue: VenueId; reason: string }>;
  
  /** Venue agreement score (0..1) */
  venueAgreement: number;
  
  /** Price dispersion across venues (%) */
  priceDispersion: number;
  
  /** Which venue is "leading" */
  dominantVenue: VenueId;
  
  /** Resolution timestamp */
  resolvedAt: number;
  
  /** Data quality indicator */
  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'DEGRADED';
  
  /** Human-readable resolution reason */
  resolutionNote: string;
}

// ═══════════════════════════════════════════════════════════════
// ML FEATURES FROM MULTI-VENUE
// ═══════════════════════════════════════════════════════════════

export interface VenueMLFeatures {
  /** How much venues agree on price (0..1) */
  venueAgreementScore: number;
  
  /** Price dispersion across venues */
  venueDispersion: number;
  
  /** Current dominant venue */
  dominantVenue: string;
  
  /** Confidence in current price */
  venueConfidence: number;
  
  /** Did dominant venue change recently? */
  venueSwitch: boolean;
  
  /** Number of active venues */
  activeVenueCount: number;
  
  /** Average latency across venues */
  avgLatencyMs: number;
}

// ═══════════════════════════════════════════════════════════════
// ASSET UNIVERSE
// ═══════════════════════════════════════════════════════════════

export interface AssetUniverse {
  /** Version */
  version: string;
  
  /** Last rebuild timestamp */
  lastRebuild: number;
  
  /** Total assets */
  totalAssets: number;
  
  /** Assets by liquidity profile */
  byProfile: Record<LiquidityProfile, number>;
  
  /** Assets by venue */
  byVenue: Partial<Record<VenueId, number>>;
  
  /** List of tracked assets */
  assets: CanonicalAsset[];
}

console.log('[Assets] Types loaded');
