/**
 * INDEX PACK V2 — Unified Response Contract
 * 
 * Single response type for all indices (DXY/SPX/BTC).
 * Frontend renders blocks conditionally based on dataStatus.
 */

import { IndexSymbol, HorizonDays, DataStatus } from './index.types.js';
import { ReplayPackV2, TopMatch } from './packs/replay.pack.js';
import { SyntheticPackV2 } from './packs/synthetic.pack.js';
import { HybridPackV2 } from './packs/hybrid.pack.js';
import { MacroPackV2 } from './packs/macro.pack.js';
import { AnalyticsPackV2 } from './packs/analytics.pack.js';

// ═══════════════════════════════════════════════════════════════
// INDEX PACK V2 (main response)
// ═══════════════════════════════════════════════════════════════

export interface IndexPackV2 {
  // Identity
  symbol: IndexSymbol;
  asOf: string;                 // ISO timestamp
  horizonDays: HorizonDays;
  
  // Core packs
  replay?: ReplayPackV2;
  synthetic?: SyntheticPackV2;
  hybrid?: HybridPackV2;
  macro?: MacroPackV2;
  analytics?: AnalyticsPackV2;
  
  // Top matches (for UI)
  topMatches?: TopMatch[];
  
  // Data status (for conditional rendering)
  dataStatus: {
    replay: DataStatus;
    synthetic: DataStatus;
    hybrid: DataStatus;
    macro: DataStatus;
    analytics: DataStatus;
  };
  
  // Processing metadata
  processingTimeMs: number;
  version: '2.0';
}

// ═══════════════════════════════════════════════════════════════
// REQUEST OPTIONS
// ═══════════════════════════════════════════════════════════════

export interface IndexPackRequest {
  symbol: IndexSymbol;
  horizon?: HorizonDays;        // default: 30
  view?: 'full' | 'replay' | 'synthetic' | 'hybrid' | 'macro' | 'analytics';
  asOf?: string;                // ISO date for backtesting
  includeMatches?: boolean;     // include topMatches array
  topK?: number;                // number of top matches
}

// ═══════════════════════════════════════════════════════════════
// RE-EXPORT all pack types
// ═══════════════════════════════════════════════════════════════

export * from './index.types.js';
export * from './packs/replay.pack.js';
export * from './packs/synthetic.pack.js';
export * from './packs/hybrid.pack.js';
export * from './packs/macro.pack.js';
export * from './packs/analytics.pack.js';
