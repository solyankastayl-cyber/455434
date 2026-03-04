/**
 * SPX CALIBRATION — Types
 * 
 * BLOCK B6.4 — Historical Calibration Run
 */

export type CalibrationState = 'IDLE' | 'RUNNING' | 'STOPPING' | 'DONE' | 'FAILED';

export interface SpxCalibrationRunDoc {
  _id: string;                  // "SPX_CALIBRATION"
  state: CalibrationState;
  startedAt?: string;
  updatedAt?: string;

  range: { start: string; end: string };
  presets: string[];
  roles: string[];

  // Progress by idx (trading days, not calendar)
  firstIdx: number;
  lastIdx: number;
  cursorIdx: number;            // next idx to process

  chunkSize: number;
  horizons: Array<{ name: string; aftermathDays: number; windowLen: number }>;

  // Counters
  writtenSnapshots: number;
  writtenOutcomes: number;
  skippedNoHistory: number;
  skippedNoOutcome: number;

  // Guards
  stopRequested?: boolean;

  // Audit
  engineVersion: string;
  policyHash: string;
  source: string;               // 'BOOTSTRAP' for calibration
  lastError?: string;
}

export interface ExpectedCountsResponse {
  range: { start: string; end: string };
  D: number;
  presets: string[];
  roles: string[];

  byHorizon: Record<string, {
    validAsOfDays: number;
    expectedSnapshots: number;
    expectedOutcomes: number;
  }>;

  totals: {
    expectedSnapshots: number;
    expectedOutcomes: number;
  };
}

export interface CalibrationLogDoc {
  ts: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  msg: string;
  extra?: any;
}

// Horizon config for SPX
export const SPX_HORIZONS = [
  { name: '7d', aftermathDays: 7, windowLen: 60 },
  { name: '14d', aftermathDays: 14, windowLen: 90 },
  { name: '30d', aftermathDays: 30, windowLen: 120 },
  { name: '90d', aftermathDays: 90, windowLen: 180 },
  { name: '180d', aftermathDays: 180, windowLen: 250 },
  { name: '365d', aftermathDays: 365, windowLen: 365 },
];

export const DEFAULT_PRESETS = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
export const DEFAULT_ROLES = ['USER'];
