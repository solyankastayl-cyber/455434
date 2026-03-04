/**
 * A3.7 — 90d Calibration Grid Types
 * 
 * Types for DXY 90d horizon calibration
 */

import type { WeightMode } from './dxy-walk.types.js';

// ═══════════════════════════════════════════════════════════════
// GRID CONFIG
// ═══════════════════════════════════════════════════════════════

export interface Grid90dRequest {
  oosFrom: string;          // YYYY-MM-DD
  oosTo: string;
  stepDays?: number;
  focus: '90d';
  topK?: number;
  grid: {
    windowLen: number[];
    threshold: number[];
    weightMode: WeightMode[];
  };
}

export interface ConfigUsed {
  windowLen: number;
  threshold: number;
  weightMode: WeightMode;
  topK: number;
  focus: string;
}

export interface GridConfigResult {
  configUsed: ConfigUsed;
  equityFinal: number;
  maxDD: number;
  hitRate: number;
  bias: number;
  actionableRate: number;
  trades: number;
  passed: boolean;          // meets acceptance criteria
}

export interface Grid90dResponse {
  ok: boolean;
  runId: string;
  oosFrom: string;
  oosTo: string;
  stepDays: number;
  focus: string;
  totalConfigs: number;
  passedConfigs: number;
  results: GridConfigResult[];
  top5: GridConfigResult[];
  best: GridConfigResult | null;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// CALIBRATION RUN DOCUMENT
// ═══════════════════════════════════════════════════════════════

export interface CalibrationRunDoc {
  runId: string;
  runKey: string;           // For idempotent upsert
  createdAt: Date;
  focus: string;
  oosFrom: string;
  oosTo: string;
  stepDays: number;
  gridConfig: {
    windowLen: number[];
    threshold: number[];
    weightMode: WeightMode[];
    topK: number;
  };
  results: GridConfigResult[];
  best: GridConfigResult | null;
}

// ═══════════════════════════════════════════════════════════════
// ACCEPTANCE CRITERIA FOR 90d
// ═══════════════════════════════════════════════════════════════

export const ACCEPTANCE_90D = {
  equityFinalMin: 0.95,     // Adjusted for 90d (was 1.0)
  maxDDMax: 0.50,           // Adjusted for 90d long horizon (was 0.45)
  biasAbsMax: 0.02,
  tradesMin: 80,
} as const;
