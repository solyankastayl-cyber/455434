/**
 * A3.7.v2 — 90d Controlled Tightening Types
 * 
 * Quality Gate + Replay Winsorization for 90d horizon
 */

import type { WeightMode } from './dxy-walk.types.js';

// ═══════════════════════════════════════════════════════════════
// QUALITY GATE
// ═══════════════════════════════════════════════════════════════

export interface DxyQualityGate {
  enabled: boolean;
  similarityMin: number;      // S_MIN (e.g., 0.72, 0.76, 0.80)
  entropyMax: number;         // E_MAX (e.g., 0.35, 0.45, 0.55)
  absReturnMin: number;       // R_MIN (e.g., 0.008, 0.012, 0.016)
  replayWeightMin: number;    // W_MIN (e.g., 0.10, 0.15)
}

export const DEFAULT_QUALITY_GATE: DxyQualityGate = {
  enabled: false,
  similarityMin: 0.72,
  entropyMax: 0.45,
  absReturnMin: 0.008,
  replayWeightMin: 0.10,
};

// ═══════════════════════════════════════════════════════════════
// REPLAY WINSORIZATION
// ═══════════════════════════════════════════════════════════════

export type ReplayWinsorMode = 'OFF' | 'P10P90' | 'P05P95';

export const WINSOR_QUANTILES: Record<ReplayWinsorMode, [number, number]> = {
  'OFF': [0, 1],
  'P10P90': [0.10, 0.90],
  'P05P95': [0.05, 0.95],
};

// ═══════════════════════════════════════════════════════════════
// GRID V2 REQUEST
// ═══════════════════════════════════════════════════════════════

export interface Grid90dV2Request {
  trainFrom: string;          // "2000-01-01"
  trainTo: string;            // "2016-12-31"
  valFrom: string;            // "2017-01-01"
  valTo: string;              // "2020-12-31"
  oosFrom: string;            // "2021-01-01"
  oosTo: string;              // "2025-12-31"
  stepDays?: number;
  topK?: number;
  grid: {
    windowLen: number[];
    threshold: number[];
    weightMode: WeightMode[];
    winsor: ReplayWinsorMode[];
    similarityMin: number[];
    entropyMax: number[];
    absReturnMin: number[];
    replayWeightMin: number[];
  };
}

// ═══════════════════════════════════════════════════════════════
// PERIOD METRICS
// ═══════════════════════════════════════════════════════════════

export interface PeriodMetrics {
  equityFinal: number;
  maxDD: number;
  hitRate: number;
  bias: number;
  trades: number;
  actionableRate: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG WITH FULL PARAMS
// ═══════════════════════════════════════════════════════════════

export interface ConfigUsedV2 {
  windowLen: number;
  threshold: number;
  weightMode: WeightMode;
  topK: number;
  winsor: ReplayWinsorMode;
  qualityGate: DxyQualityGate;
}

// ═══════════════════════════════════════════════════════════════
// GRID RESULT
// ═══════════════════════════════════════════════════════════════

export interface GridConfigResultV2 {
  configUsed: ConfigUsedV2;
  train: PeriodMetrics;
  val: PeriodMetrics;
  oos: PeriodMetrics;
  passed: boolean;
  passReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// GRID V2 RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface Grid90dV2Response {
  ok: boolean;
  runId: string;
  totalConfigs: number;
  passedConfigs: number;
  results: GridConfigResultV2[];
  top5: GridConfigResultV2[];
  best: GridConfigResultV2 | null;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// ACCEPTANCE CRITERIA V2
// ═══════════════════════════════════════════════════════════════

export const ACCEPTANCE_90D_V2 = {
  train: {
    equityMin: 1.0,
  },
  val: {
    equityMin: 1.0,
    maxDDMax: 0.50,
  },
  oos: {
    equityMin: 1.02,
    maxDDMax: 0.45,
    biasAbsMax: 0.02,
    tradesMin: 80,
  },
} as const;
