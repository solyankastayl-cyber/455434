/**
 * Fractal Module Contracts
 * Type definitions for pattern matching and historical analysis
 */

// ═══════════════════════════════════════════════════════════════
// OHLCV Types
// ═══════════════════════════════════════════════════════════════

export interface OhlcvCandle {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RawOhlcvDocument {
  meta: {
    symbol: string;
    timeframe: string;
    source: string;
  };
  ts: Date;
  ohlcv: {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  };
  quality: {
    sanity_ok: boolean;
    flags: string[];
  };
  ingestedAt: Date;
}

export interface CanonicalOhlcvDocument {
  meta: {
    symbol: string;
    timeframe: string;
  };
  ts: Date;
  ohlcv: {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  };
  provenance: {
    chosenSource: string;
    candidates: Array<{ source: string }>;
  };
  quality: {
    qualityScore: number;
    flags: string[];
    sanity_ok: boolean;
  };
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// State Types
// ═══════════════════════════════════════════════════════════════

export interface FractalState {
  _id: string;
  symbol: string;
  timeframe: string;
  bootstrap: {
    done: boolean;
    startedAt?: Date;
    finishedAt?: Date;
  };
  lastCanonicalTs?: Date;
  lastUpdateAt?: Date;
  gaps: {
    count: number;
    lastScanAt?: Date;
  };
  sources: {
    primary: string;
    fallback: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// Pattern Matching Types
// ═══════════════════════════════════════════════════════════════

export interface FractalWindow {
  startTs: Date;
  endTs: Date;
  values: number[]; // normalized log returns
}

export interface FractalMatch {
  startTs: Date;
  endTs: Date;
  score: number; // similarity score (0-1)
  rank: number;
}

export interface ForwardOutcome {
  returnPct: number;
  maxDrawdownPct: number;
}

export interface ForwardStats {
  horizonDays: number;
  return: {
    p10: number;
    p50: number;
    p90: number;
    mean: number;
  };
  maxDrawdown: {
    p10: number;
    p50: number;
    p90: number;
  };
}

export interface FractalConfidence {
  sampleSize: number;
  stabilityScore: number; // 0-1, based on dispersion
}

// ═══════════════════════════════════════════════════════════════
// API Request/Response Types
// ═══════════════════════════════════════════════════════════════

export interface FractalMatchRequest {
  symbol?: string; // default: BTC
  timeframe?: '1d'; // only 1d supported for now
  windowLen?: 30 | 60 | 90; // default: 30
  topK?: number; // default: 25
  forwardHorizon?: number; // default: 30
  asOf?: Date; // optional, defaults to latest
  similarityMode?: 'zscore' | 'raw_returns'; // BLOCK 34.10: default 'raw_returns' for sim
  includeSeriesUsed?: boolean; // BLOCK 34.11: return truncated series for relative signal
}

export interface FractalMatchResponse {
  ok: boolean;
  asOf: Date;
  pattern: {
    windowLen: number;
    timeframe: string;
    representation: 'log_returns_zscore';
  };
  matches: FractalMatch[];
  forwardStats: ForwardStats;
  confidence: FractalConfidence;
  safety: {
    excludedFromTraining: true;
    contextOnly: true;
    notes: string[];
  };
  // BLOCK 34.11: Optional series data for relative signal calculation
  seriesUsed?: Array<{ ts: Date; close: number }>;
}

export interface FractalHealthResponse {
  ok: boolean;
  enabled: boolean;
  bootstrapDone: boolean;
  lastCanonicalTs: Date | null;
  candleCount: number;
  gaps: number;
  lagDays?: number | null;
  dataIntegrity: 'OK' | 'GAPS_DETECTED' | 'BOOTSTRAP_NEEDED';
  sources: {
    primary: string;
    fallback: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// Provider Interface
// ═══════════════════════════════════════════════════════════════

export interface HistoricalSourceProvider {
  name: string;
  fetchRange(
    symbol: string,
    timeframe: '1d',
    from: Date,
    to: Date
  ): Promise<OhlcvCandle[]>;
}
