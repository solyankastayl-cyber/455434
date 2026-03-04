/**
 * PHASE 1.3 — Backfill Types
 * ===========================
 */

export type BackfillState = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface BackfillRequest {
  symbols: string[];
  days: number;
  timeframe: '1m' | '5m' | '15m';
  provider?: 'BYBIT' | 'BINANCE';
  horizonBars?: number;
  dryRun?: boolean;
}

export interface BackfillProgress {
  runId: string;
  state: BackfillState;
  request: BackfillRequest;
  startedAt?: string;
  finishedAt?: string;
  progress: {
    currentSymbol?: string;
    symbolsTotal: number;
    symbolsDone: number;
    barsTotal: number;
    barsProcessed: number;
    observationsCreated: number;
    truthsCreated: number;
    errors: number;
    lastBarTs?: number;
    eta?: string;
  };
  lastError?: string;
}

export interface BackfillCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

console.log('[Phase 1.3] Backfill Types loaded');
