/**
 * DXY MODULE TYPES
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

// ═══════════════════════════════════════════════════════════════
// CANDLE TYPES
// ═══════════════════════════════════════════════════════════════

export interface DxyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  source?: string;
}

export interface DxyCandleMeta {
  source: string;
  startDate: string;
  endDate: string;
  count: number;
  lastIngestAt: string;
  checksum: string;
}

// ═══════════════════════════════════════════════════════════════
// FRACTAL TYPES
// ═══════════════════════════════════════════════════════════════

export interface DxyMatch {
  similarity: number;
  startIndex: number;
  endIndex: number;
  startDate: string;
  endDate: string;
}

export interface DxyReplayPack {
  windowNormalized: number[];
  aftermathNormalized: number[];
  similarity: number;
  startDate: string;
  endDate: string;
}

export interface DxyFocusPack {
  horizon: string;
  matches: DxyMatch[];
  replay: DxyReplayPack[];
  path: number[];
  bands: {
    p10: number[];
    p50: number[];
    p90: number[];
  };
  diagnostics: {
    similarity: number;
    entropy: number;
    coverageYears: number;
    matchCount: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface DxyChartResponse {
  ok: boolean;
  symbol: 'DXY';
  candles: DxyCandle[];
  meta?: DxyCandleMeta;
}

export interface DxyIngestResponse {
  ok: boolean;
  source: string;
  written: number;
  updated: number;
  range: {
    from: string;
    to: string;
  };
}

export interface DxyFractalResponse {
  ok: boolean;
  symbol: 'DXY';
  focus: string;
  processingTimeMs: number;
  data: DxyFocusPack;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON CONFIG
// ═══════════════════════════════════════════════════════════════

export const DXY_HORIZONS = ['7d', '14d', '30d', '90d', '180d', '365d'] as const;
export type DxyHorizon = typeof DXY_HORIZONS[number];

export function isValidDxyHorizon(h: string): h is DxyHorizon {
  return DXY_HORIZONS.includes(h as DxyHorizon);
}

export function horizonToDays(h: DxyHorizon): number {
  return parseInt(h.replace('d', ''));
}

// ═══════════════════════════════════════════════════════════════
// SCAN CONFIG (DXY-specific, lower volatility than BTC)
// ═══════════════════════════════════════════════════════════════

export const DXY_SCAN_CONFIG = {
  windowLength: 120,
  similarityThreshold: 0.85,
  topK: 5,
  minHistoryDays: 1000,
} as const;
