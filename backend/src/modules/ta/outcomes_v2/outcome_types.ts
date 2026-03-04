/**
 * Phase H: Outcome Types
 */

export type OutcomeStatus = 'PENDING' | 'WIN' | 'LOSS' | 'TIMEOUT' | 'NO_ENTRY';

export interface OutcomeRecord {
  runId: string;
  asset: string;
  timeframe: string;
  scenarioId: string;
  hypothesisId: string;
  createdAt: Date;

  // Trade plan prices
  entry: number | null;
  stop: number | null;
  target1: number | null;

  status: OutcomeStatus;

  // Diagnostics
  timeToEntryBars?: number | null;
  timeToHitBars?: number | null;

  // Excursion metrics
  mfe?: number | null;  // Max Favorable Excursion (abs)
  mae?: number | null;  // Max Adverse Excursion (abs)
  mfePct?: number | null;
  maePct?: number | null;

  // Which boundary hit first
  hit?: 'STOP' | 'TARGET1' | 'TIMEOUT' | 'NONE';

  // Debug
  reason?: string;
  computedAt: Date;
}
