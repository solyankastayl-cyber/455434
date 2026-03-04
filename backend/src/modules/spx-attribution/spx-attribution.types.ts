/**
 * SPX ATTRIBUTION — Types
 * 
 * BLOCK B6.2 — Attribution metrics and breakdowns
 */

export type SpxWindow = '30d' | '90d' | '365d' | 'all';
export type SpxSource = 'LIVE' | 'VINTAGE' | 'ALL';
export type SpxCohort = 'LIVE' | 'V1950' | 'V1990' | 'V2008' | 'V2020' | 'ALL';
export type SpxPreset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type SpxHorizon = '7d' | '14d' | '30d' | '90d' | '180d' | '365d';
export type Tier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';
export type DivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F';

// ═══════════════════════════════════════════════════════════════
// HEADLINE KPIs
// ═══════════════════════════════════════════════════════════════

export interface SpxKpis {
  totalOutcomes: number;
  hitRate: number;           // 0-100%
  expectancy: number;        // avg return per trade (decimal)
  avgReturn: number;         // % 
  sharpe: number;
  maxDD: number;             // decimal (e.g., -0.12 = -12%)
  calibration?: number;      // optional: confidence vs actual
}

// ═══════════════════════════════════════════════════════════════
// BREAKDOWN ITEM
// ═══════════════════════════════════════════════════════════════

export interface BreakdownItem {
  key: string;
  label: string;
  outcomes: number;
  hits: number;
  hitRate: number;
  avgReturn: number;
  expectancy: number;
  sharpe?: number;
  grade?: string;
}

// ═══════════════════════════════════════════════════════════════
// INSIGHT
// ═══════════════════════════════════════════════════════════════

export interface SpxInsight {
  type: 'INFO' | 'WARNING' | 'RECOMMENDATION';
  title: string;
  description: string;
  metric?: string;
  delta?: number;
}

// ═══════════════════════════════════════════════════════════════
// FULL ATTRIBUTION RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface SpxAttributionResponse {
  ok: boolean;
  symbol: 'SPX';
  filters: {
    window: SpxWindow;
    source: SpxSource;
    cohort: SpxCohort;
    preset: SpxPreset;
  };
  kpis: SpxKpis;
  breakdowns: {
    tier: BreakdownItem[];
    horizon: BreakdownItem[];
    phase: BreakdownItem[];
    divergence: BreakdownItem[];
  };
  counts: {
    total: number;
    bySource: Record<string, number>;
    byCohort: Record<string, number>;
  };
  insights: SpxInsight[];
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// QUERY PARAMS
// ═══════════════════════════════════════════════════════════════

export interface SpxAttributionQuery {
  window?: SpxWindow;
  source?: SpxSource;
  cohort?: SpxCohort;
  preset?: SpxPreset;
}
