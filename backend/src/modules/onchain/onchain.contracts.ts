/**
 * C2.1 — Onchain Data Contracts
 * =============================
 * 
 * CANONICAL CONTRACTS — LOCKED v1
 * 
 * PURPOSE:
 * - Measure what money is doing (not what people say)
 * - Provide truth-layer for Exchange validation
 * - NO signals, NO predictions, NO trading recommendations
 * 
 * GOLDEN RULES:
 * - Onchain does NOT know about Sentiment
 * - Onchain does NOT know about Exchange Verdict
 * - Onchain measures and stores — nothing more
 * - NO_DATA is valid, not an error
 */

// ═══════════════════════════════════════════════════════════════
// ENUMS & CONSTANTS
// ═══════════════════════════════════════════════════════════════

export type OnchainSourceType = 'mock' | 'api' | 'node';
export type OnchainProviderStatus = 'UP' | 'DEGRADED' | 'DOWN';
export type OnchainChain = 'ethereum' | 'bitcoin' | 'solana' | 'arbitrum' | 'base';
export type OnchainWindow = '1h' | '4h' | '24h' | '7d';

export const SOURCE_QUALITY: Record<OnchainSourceType, number> = {
  node: 1.0,
  api: 0.8,
  mock: 0.3,
} as const;

export const ONCHAIN_THRESHOLDS = {
  LARGE_TRANSFER_USD: 100_000,
  MIN_USABLE_CONFIDENCE: 0.4,
  Z_SCORE_K: 2.0,
  BASELINE_WINDOW: 30,
} as const;

// ═══════════════════════════════════════════════════════════════
// 1. ONCHAIN SNAPSHOT (Raw Data)
// ═══════════════════════════════════════════════════════════════

export interface OnchainSnapshot {
  symbol: string;
  chain: OnchainChain;
  t0: number;
  snapshotTimestamp: number;
  window: OnchainWindow;
  
  exchangeInflowUsd: number;
  exchangeOutflowUsd: number;
  exchangeNetUsd: number;
  
  netInflowUsd: number;
  netOutflowUsd: number;
  netFlowUsd: number;
  
  activeAddresses: number;
  txCount: number;
  feesUsd: number;
  
  largeTransfersCount: number;
  largeTransfersVolumeUsd: number;
  topHolderDeltaUsd?: number;
  
  source: OnchainSourceType;
  sourceProvider?: string;
  sourceQuality: number;
  missingFields: string[];
  rawDataPoints?: Record<string, number | string>;
}

// ═══════════════════════════════════════════════════════════════
// 2. ONCHAIN METRICS (Normalized)
// ═══════════════════════════════════════════════════════════════

export interface OnchainMetrics {
  symbol: string;
  t0: number;
  window: OnchainWindow;
  
  // Core metrics (LOCKED v1)
  flowScore: number;           // [-1..+1] net flow direction
  exchangePressure: number;    // [-1..+1] sell vs withdraw pressure
  whaleActivity: number;       // [0..1] large holder activity
  networkHeat: number;         // [0..1] network congestion/activity
  velocity: number;            // [0..1] capital movement speed
  distributionSkew: number;    // [0..1] activity concentration
  
  // Quality metrics
  dataCompleteness: number;    // [0..1]
  confidence: number;          // [0..1]
  
  // Explainability
  drivers: string[];
  missing: string[];
  
  // Debug data
  rawScores?: {
    flowRaw: number;
    exchangeRaw: number;
    whaleRaw: number;
    heatRaw: number;
    velocityRaw: number;
    skewRaw: number;
  };
}

/**
 * On-chain state interpretation (for C2.2 validation)
 * Derived from metrics, NOT a verdict
 */
export type OnchainState = 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' | 'NO_DATA';

/**
 * Derive state from metrics (pure function)
 */
export function deriveOnchainState(metrics: OnchainMetrics): OnchainState {
  if (metrics.confidence < 0.4) return 'NO_DATA';
  
  // flowScore + exchangePressure determine state
  const netSignal = metrics.flowScore - metrics.exchangePressure;
  
  if (netSignal > 0.2) return 'ACCUMULATION';
  if (netSignal < -0.2) return 'DISTRIBUTION';
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// 3. ONCHAIN OBSERVATION (Persisted)
// ═══════════════════════════════════════════════════════════════

export interface OnchainObservation {
  id: string;
  symbol: string;
  t0: number;
  window: OnchainWindow;
  snapshot: OnchainSnapshot;
  metrics: OnchainMetrics;
  diagnostics: {
    calculatedAt: number;
    processingTimeMs: number;
    provider: string;
    warnings: string[];
    baseline?: {
      windowSize: number;
      medianFlowUsd: number;
      madFlowUsd: number;
      medianExchangeNetUsd: number;
      madExchangeNetUsd: number;
    };
  };
  createdAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// 4. PROVIDER HEALTH
// ═══════════════════════════════════════════════════════════════

export interface OnchainProviderHealth {
  providerId: string;
  providerName: string;
  status: OnchainProviderStatus;
  chains: OnchainChain[];
  lastSuccessAt: number;
  lastError?: string;
  lastErrorAt?: number;
  successRate24h: number;
  avgLatencyMs: number;
  checkedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// 5. API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface OnchainHealthResponse {
  ok: boolean;
  status: OnchainProviderStatus;
  providers: OnchainProviderHealth[];
  timestamp: number;
}

export interface OnchainSnapshotResponse {
  ok: boolean;
  snapshot: OnchainSnapshot | null;
  source: OnchainSourceType;
  confidence: number;
  dataAvailable: boolean;
}

export interface OnchainHistoryResponse {
  ok: boolean;
  observations: OnchainObservation[];
  count: number;
  range: { from: number; to: number };
}

console.log('[C2.1] Onchain Contracts loaded');
