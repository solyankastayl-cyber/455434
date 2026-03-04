/**
 * Exchange ML Contracts
 * =====================
 * 
 * Shared types for the two-model Exchange architecture:
 * - Environment Model: USE/IGNORE/WARNING (when to trade)
 * - Direction Model: UP/DOWN/NEUTRAL (where to trade)
 */

// ═══════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════

export type Horizon = '1D' | '7D' | '30D';

export type EnvLabel = 'USE' | 'IGNORE' | 'WARNING';
export type DirLabel = 'UP' | 'DOWN' | 'NEUTRAL';

export type ModelKind = 'ENV' | 'DIR';

// ═══════════════════════════════════════════════════════════════
// INFERENCE INPUTS/OUTPUTS
// ═══════════════════════════════════════════════════════════════

export interface ExchangeInferenceInput {
  symbol: string;
  horizon: Horizon;
  t: number; // unix seconds anchor
}

export interface ExchangeEnvPrediction {
  label: EnvLabel;
  proba: Record<EnvLabel, number>;
  confidence: number;
}

export interface ExchangeDirPrediction {
  label: DirLabel;
  proba: Record<DirLabel, number>;
  confidence: number;
  expectedReturn?: number;
}

export interface ExchangeCombinedVerdict {
  env: ExchangeEnvPrediction;
  dir: ExchangeDirPrediction;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  gate: { passed: boolean; reason?: string };
}

// ═══════════════════════════════════════════════════════════════
// DIRECTION THRESHOLDS (Horizon-adjusted)
// ═══════════════════════════════════════════════════════════════

export const DIR_THRESHOLDS: Record<Horizon, { win: number; neutral: number }> = {
  '1D':  { win: 0.0025, neutral: 0.0012 },  // 0.25%, ±0.12%
  '7D':  { win: 0.0120, neutral: 0.0060 },  // 1.2%, ±0.6%
  '30D': { win: 0.0350, neutral: 0.0180 },  // 3.5%, ±1.8%
};

// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRY TYPES
// ═══════════════════════════════════════════════════════════════

export interface ModelRegistryEntry {
  kind: ModelKind;
  horizon: Horizon;
  symbol?: string; // null = global
  activeModelId: string | null;
  shadowModelId: string | null;
  prevModelId: string | null;
  activeModelVersion: string | null;
  shadowModelVersion: string | null;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// SAMPLE TYPES
// ═══════════════════════════════════════════════════════════════

export type SampleStatus = 'PENDING' | 'RESOLVED' | 'EXPIRED' | 'ERROR';

export interface DirSample {
  _id?: string;
  symbol: string;
  horizon: Horizon;
  t0: Date;
  features: DirFeatureSnapshot;
  featureVersion: string;
  entryPrice: number;
  label: DirLabel | null;
  status: SampleStatus;
  resolveAt: Date;
  resolvedAt: Date | null;
  exitPrice: number | null;
  returnPct: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DirFeatureSnapshot {
  ret_1h: number;
  ret_4h: number;
  ret_24h: number;
  ret_3d: number;
  ret_7d: number;
  sma20_dist: number;
  sma50_dist: number;
  rsi14: number;
  atrN: number;
  flowBias: number;
  // v2.1.0: Added 3 new features for improved accuracy
  emaCrossDist: number;   // EMA(12) - EMA(26) / price
  distToVWAP7: number;    // (price - VWAP7) / price  
  volSpike20: number;     // volume / SMA(volume, 20)
}

console.log('[Exchange ML] Contracts loaded');
