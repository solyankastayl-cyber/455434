/**
 * Rankings V2 Types
 * 
 * DTOs and interfaces for Rankings V2 system
 */

export type SubjectKind = 'entity' | 'actor' | 'wallet';
export type RankWindow = '1h' | '6h' | '24h' | '7d';
export type RankBucket = 'BUY' | 'WATCH' | 'SELL' | 'NEUTRAL';

/**
 * Input from Engine V2 for ranking calculation
 */
export interface RankingsV2Input {
  subject: {
    kind: SubjectKind;
    id: string;
    symbol?: string;
    address?: string;
    name?: string;
  };
  window: RankWindow;

  // Engine V2 truth scores
  coverage: number;     // 0..100
  evidence: number;     // 0..100
  direction: number;    // -100..100
  risk: number;         // 0..100
  confidence: number;   // 0..100

  // Anti-manipulation + quality metrics
  clusterPassRate: number; // 0..1
  avgDominance: number;    // 0..1
  penaltyRate: number;     // 0..1

  // Activity + lifecycle
  activeSignals: number;
  lifecycleMix: {
    active: number;    // 0..1
    cooldown: number;  // 0..1
    resolved: number;  // 0..1
  };

  // Freshness
  avgSignalAgeHours: number;
  freshnessScore?: number;

  // Attribution (top signals)
  topSignals: TopSignalAttribution[];
}

/**
 * Top signal attribution for explainability
 */
export interface TopSignalAttribution {
  signalId: string;
  kind: string;
  contribution: number; // 0..1
  confidence: number;
  ageHours: number;
  direction: number;    // -1..1
}

/**
 * Rank calculation trace (explainability)
 */
export interface RankTrace {
  baseEvidence: number;
  lifecycleFactor: number;
  freshnessFactor: number;
  clusterFactor: number;
  penaltyFactor: number;
  antiSpamFactor: number;
  scoreRaw: number;
}

/**
 * Full ranking result
 */
export interface RankingResult {
  subject: {
    kind: SubjectKind;
    id: string;
    symbol?: string;
    address?: string;
  };
  window: RankWindow;
  computedAt: string;

  rankScore: number;
  bucket: RankBucket;
  bucketReason: string;

  engine: {
    coverage: number;
    evidence: number;
    direction: number;
    risk: number;
    confidence: number;
  };

  quality: {
    clusterPassRate: number;
    avgDominance: number;
    penaltyRate: number;
    activeSignals: number;
  };

  freshness: {
    avgSignalAgeHours: number;
    freshnessFactor: number;
  };

  lifecycleMix: {
    active: number;
    cooldown: number;
    resolved: number;
  };

  rankTrace: RankTrace;

  topSignals: TopSignalAttribution[];
}

/**
 * Rankings summary for API response
 */
export interface RankingsSummary {
  total: number;
  BUY: number;
  WATCH: number;
  SELL: number;
  NEUTRAL: number;
}
