/**
 * Actor Types
 * 
 * EPIC A1: Actors Dataset Builder
 * 
 * Actors = Network Participants (observed)
 * NOT predictions, NOT signals - structural profiles
 */

// ============================================
// ACTOR TYPES
// ============================================

export type ActorType = 
  | 'exchange'      // Centralized exchanges
  | 'fund'          // Funds / asset managers
  | 'market_maker'  // MM / liquidity providers
  | 'whale'         // Large individual participants
  | 'trader'        // Active traders
  | 'protocol'      // DeFi protocols (Uniswap, Aave, etc.)
  | 'infra';        // Infrastructure (Circle, Tether, Chainlink)

export const ACTOR_TYPES: ActorType[] = [
  'exchange',
  'fund',
  'market_maker',
  'whale',
  'trader',
  'protocol',
  'infra',
];

// ============================================
// SOURCE LEVELS
// ============================================

export type SourceLevel = 
  | 'verified'     // Etherscan / public disclosure - full trust
  | 'attributed'   // Correlation + behavior - penalty applied
  | 'behavioral';  // Pattern-only - view only, not in aggregates

export const SOURCE_LEVELS: SourceLevel[] = [
  'verified',
  'attributed',
  'behavioral',
];

// ============================================
// COVERAGE
// ============================================

export type CoverageBand = 'High' | 'Medium' | 'Low';

export interface ActorCoverage {
  score: number;      // 0-100
  band: CoverageBand;
  lastUpdated: Date;
}

// ============================================
// ADDRESS STATS
// ============================================

export interface AddressStats {
  verifiedCount: number;
  attributedCount: number;
  behavioralCount: number;
  totalCount: number;
}

// ============================================
// ACTOR MODEL
// ============================================

export interface Actor {
  id: string;
  type: ActorType;
  name?: string;              // Only if verified
  sourceLevel: SourceLevel;
  
  addresses: string[];        // Wallet addresses
  addressStats: AddressStats;
  
  coverage: ActorCoverage;
  
  // Metadata
  entityIds?: string[];       // Link to source entities
  labels?: string[];          // Optional labels
  
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// ACTOR LIST ITEM (for API)
// ============================================

export interface ActorListItem {
  id: string;
  type: ActorType;
  name?: string;
  sourceLevel: SourceLevel;
  coverage: {
    score: number;
    band: CoverageBand;
  };
  addressCount: number;
}

// ============================================
// ACTOR DETAIL (for profile page)
// ============================================

export interface ActorDetail extends Actor {
  // Additional detail fields
  topTokens?: { address: string; symbol: string; volume: number }[];
  recentActivity?: {
    txCount24h: number;
    txCount7d: number;
    volumeUsd24h: number;
    volumeUsd7d: number;
  };
}

// ============================================
// BUILD CONFIG
// ============================================

export interface ActorBuildConfig {
  // Thresholds for whale classification
  whaleVolumeThreshold7d: number;  // USD
  
  // Thresholds for trader classification
  traderTxCountThreshold7d: number;
  
  // Market maker detection
  mmBidirectionalRatio: number;    // 0-1
  mmTokenDiversityMin: number;
  
  // General
  minAddressesPerActor: number;
  refreshExisting: boolean;
}

export const DEFAULT_BUILD_CONFIG: ActorBuildConfig = {
  whaleVolumeThreshold7d: 100_000,    // $100k
  traderTxCountThreshold7d: 50,
  mmBidirectionalRatio: 0.3,          // At least 30% in both directions
  mmTokenDiversityMin: 5,
  minAddressesPerActor: 1,
  refreshExisting: true,
};

// ============================================
// BUILD STATS
// ============================================

export interface ActorBuildStats {
  runId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  
  // Counts
  entitiesProcessed: number;
  walletsProcessed: number;
  actorsCreated: number;
  actorsUpdated: number;
  
  // By type
  byType: Record<ActorType, number>;
  
  // By source
  bySource: Record<SourceLevel, number>;
  
  errors: string[];
}

// ============================================
// QUERY OPTIONS
// ============================================

export interface ActorQueryOptions {
  type?: ActorType;
  sourceLevel?: SourceLevel;
  coverageBand?: CoverageBand;
  search?: string;
  sort?: 'coverage' | 'activity' | 'edge_score' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}
