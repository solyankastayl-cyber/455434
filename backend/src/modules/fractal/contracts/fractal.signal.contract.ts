/**
 * FRACTAL SIGNAL CONTRACT v2.1.1
 * 
 * FROZEN: This contract is immutable.
 * Any changes require a new version (v2.1.2+).
 * 
 * v2.1.1 Changes:
 * - Added Alert System (BLOCK 67-68)
 * - Frozen alert policy table
 * - Frozen quota limits
 * - Frozen cooldown periods
 * - Frozen severity mapping
 * 
 * Used by:
 * - Frontend (Research Terminal)
 * - MetaBrain (Orchestration)
 * - Admin Panel
 */

export const FRACTAL_CONTRACT_VERSION = 'v2.1.1' as const;
export const FRACTAL_CONTRACT_FROZEN = true as const;

// ═══════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════

export type FractalAction = 'LONG' | 'SHORT' | 'HOLD';
export type FractalHorizon = 7 | 14 | 30;
export type FractalPreset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type ReliabilityBadge = 'HIGH' | 'WARN' | 'DEGRADED' | 'CRITICAL';
export type TailBadge = 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL';
export type GovernanceMode = 'NORMAL' | 'PROTECTION' | 'FROZEN_ONLY' | 'HALT';
export type MarketPhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN' | 'TRANSITION';
export type SMA200Position = 'ABOVE' | 'BELOW' | 'NEAR';

// ═══════════════════════════════════════════════════════════════
// MAIN CONTRACT (FROZEN)
// ═══════════════════════════════════════════════════════════════

export interface FractalSignalContract {
  // Contract metadata (required)
  contract: {
    module: 'fractal';
    version: typeof FRACTAL_CONTRACT_VERSION;
    frozen: true;
    horizons: readonly [7, 14, 30];
    symbol: 'BTC';
    generatedAt: string;      // ISO datetime
    asofCandleTs: number;     // Unix ms of last candle close
    contractHash: string;     // SHA256 of schema
  };

  // Primary decision (what MBrain/Frontend uses)
  decision: {
    action: FractalAction;
    confidence: number;       // 0..1 (calibrated)
    reliability: number;      // 0..1 (module health)
    sizeMultiplier: number;   // 0..1 (position sizing factor)
    preset: FractalPreset;    // Which preset produced this
  };

  // Per-horizon breakdown
  horizons: Array<{
    h: FractalHorizon;
    action: FractalAction;
    expectedReturn: number;   // Decimal (e.g., 0.016 = 1.6%)
    confidence: number;       // 0..1
    weight: number;           // 0..1 (contribution to final)
    dominant: boolean;        // Is this the primary horizon?
  }>;

  // Risk metrics (for orchestration)
  risk: {
    maxDD_WF: number;         // Walk-forward max drawdown
    mcP95_DD: number;         // Monte Carlo 95th percentile DD
    entropy: number;          // 0..1 (signal uncertainty)
    tailBadge: TailBadge;
  };

  // Reliability assessment
  reliability: {
    score: number;            // 0..1
    badge: ReliabilityBadge;
    effectiveN: number;       // Effective sample size
    driftScore: number;       // 0..1 (higher = more drift)
  };

  // Market context
  market: {
    phase: MarketPhase;
    sma200: SMA200Position;
    currentPrice: number;
    volatility: number;       // Recent volatility measure
  };

  // Explainability (for UI/logging)
  explain: {
    topMatches: Array<{
      id: string;
      similarity: number;
      phase: MarketPhase;
      stability: number;
      outcome7d?: number;
    }>;
    noTradeReasons: string[]; // e.g., ['HIGH_ENTROPY', 'LOW_CONFIDENCE']
    influence: Array<{
      h: FractalHorizon;
      weight: number;
      contribution: number;
    }>;
  };

  // Governance state
  governance: {
    mode: GovernanceMode;
    frozenVersionId: string;
    guardLevel: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
  };
}

// ═══════════════════════════════════════════════════════════════
// DTO FOR METABRAIN (Simplified)
// ═══════════════════════════════════════════════════════════════

export interface FractalSignalDTO {
  contract: FractalSignalContract['contract'];
  decision: FractalSignalContract['decision'];
  horizons: FractalSignalContract['horizons'];
  risk: FractalSignalContract['risk'];
  market: FractalSignalContract['market'];
  explain: FractalSignalContract['explain'];
  governance: FractalSignalContract['governance'];
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT HASH (for verification)
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'crypto';

const CONTRACT_SCHEMA_STRING = JSON.stringify({
  version: FRACTAL_CONTRACT_VERSION,
  frozen: FRACTAL_CONTRACT_FROZEN,
  fields: [
    'contract', 'decision', 'horizons', 'risk',
    'reliability', 'market', 'explain', 'governance'
  ],
  horizons: [7, 14, 30],
  symbol: 'BTC',
  // v2.1.1: Alert System frozen parameters
  alertPolicy: {
    quotaMax: 3,
    quotaResetHours: 24,
    cooldownInfoHighMs: 21600000,  // 6h
    cooldownCriticalMs: 3600000,   // 1h
    alertTypes: ['REGIME_SHIFT', 'CRISIS_ENTER', 'CRISIS_EXIT', 'HEALTH_DROP', 'TAIL_SPIKE'],
    alertLevels: ['INFO', 'HIGH', 'CRITICAL']
  }
});

export const FRACTAL_CONTRACT_HASH = createHash('sha256')
  .update(CONTRACT_SCHEMA_STRING)
  .digest('hex')
  .slice(0, 16);

console.log(`[Fractal] Contract ${FRACTAL_CONTRACT_VERSION} loaded, hash: ${FRACTAL_CONTRACT_HASH}`);
