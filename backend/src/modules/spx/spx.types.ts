/**
 * SPX TERMINAL — Types
 * 
 * BLOCK B1 — SPX Data Foundation
 */

export type SpxCohort = 'V1950' | 'V1990' | 'V2008' | 'V2020' | 'LIVE';

export interface SpxCandle {
  ts: number;              // UTC day start millis (00:00:00)
  date: string;            // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;

  symbol: 'SPX';
  source: 'STOOQ' | 'MANUAL';
  cohort: SpxCohort;

  createdAt?: Date;
  updatedAt?: Date;
}

export interface SpxCandleQuery {
  symbol: 'SPX';
  source: 'stooq';
  tf: '1d';
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  limit?: number;
  cohort?: SpxCohort;
}

export interface SpxIngestResult {
  fetchedRows: number;
  canonicalRows: number;
  written: number;
  skipped: number;
  from?: string;
  to?: string;
}

export interface SpxBackfillProgress {
  jobId: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  lastProcessedTs: number;
  totalInserted: number;
  totalUpdated: number;
  errors: number;
  startedAt?: Date;
  completedAt?: Date;
}
