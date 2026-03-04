/**
 * INDEX ENGINE V2 — Core Types
 * 
 * Unified types for DXY/SPX/BTC index engine.
 * All indices use same contract structure.
 */

export type IndexSymbol = 'DXY' | 'SPX' | 'BTC';

export type HorizonDays = 7 | 14 | 30 | 90 | 180 | 365;

export type RegimeType = 
  | 'EASING' 
  | 'TIGHTENING' 
  | 'STRESS' 
  | 'NEUTRAL' 
  | 'NEUTRAL_MIXED'
  | 'RECOVERY'
  | 'EXPANSION';

export type GuardLevel = 'NONE' | 'SOFT' | 'HARD';

export type RiskLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export type PhaseType = 
  | 'MARKUP' 
  | 'MARKDOWN' 
  | 'ACCUMULATION' 
  | 'DISTRIBUTION' 
  | 'RECOVERY' 
  | 'CAPITULATION';

export type DataStatus = 'OK' | 'MISSING' | 'STALE' | 'PARTIAL';

// ═══════════════════════════════════════════════════════════════
// PATH POINT (unified across all packs)
// ═══════════════════════════════════════════════════════════════

export interface PathPoint {
  t: number;          // 0..H (time index)
  date?: string;      // optional ISO date
  price: number;      // ABSOLUTE price
  ret?: number;       // return from anchor (optional)
}

export interface PathBand {
  p10: PathPoint[];
  p50: PathPoint[];
  p90: PathPoint[];
}
