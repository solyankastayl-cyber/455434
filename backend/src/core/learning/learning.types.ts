/**
 * Learning Types
 * 
 * Type definitions for ETAP 3 Learning Intelligence.
 * Ground truth data structures - NO interpretations.
 */

export type Bucket = 'BUY' | 'WATCH' | 'SELL';
export type Horizon = '1d' | '7d' | '30d';
export type DriftLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ==================== PREDICTION SNAPSHOT ====================

export interface TokenInfo {
  address: string;
  symbol: string;
}

export interface DecisionState {
  bucket: Bucket;
  score: number;
  confidence: number;
  risk: number;
}

export interface EngineContext {
  engineVersion: string;
  engineMode: 'rules' | 'rules_with_actors';
  actorSignalScore: number;
}

export interface LiveContext {
  driftLevel: DriftLevel;
  driftScore: number;
}

export interface MarketState {
  priceAtDecision: number;
  volumeAtDecision: number;
  marketCapAtDecision?: number;
}

// ==================== OUTCOME OBSERVATION ====================

export interface OutcomePoint {
  price: number;
  returnPct: number;
  volume: number;
  volumeChangePct: number;
  maxDrawdownPct: number;
  resolvedAt: Date;
}

export interface OutcomeHorizons {
  '1d'?: OutcomePoint;
  '7d'?: OutcomePoint;
  '30d'?: OutcomePoint;
}

// ==================== HORIZON CONFIG ====================

export const HORIZON_MS: Record<Horizon, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export const HORIZONS: Horizon[] = ['1d', '7d', '30d'];

// ==================== FAILURE TAXONOMY ====================

export type OutcomeLabel = 
  | 'TRUE_POSITIVE'     // BUY → went up
  | 'TRUE_NEGATIVE'     // SELL → went down
  | 'FALSE_POSITIVE'    // BUY → went down
  | 'FALSE_NEGATIVE'    // SELL → went up
  | 'DELAYED_TRUE'      // BUY → down 1d, up 30d
  | 'NO_SIGNAL'         // WATCH → flat
  | 'PENDING';          // Not enough time passed

export const RETURN_THRESHOLDS = {
  SIGNIFICANT_UP: 0.10,    // +10%
  SIGNIFICANT_DOWN: -0.10, // -10%
  FLAT_RANGE: 0.05,        // ±5%
};
