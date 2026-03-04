/**
 * BLOCK 65 — Volatility Attribution Service
 * 
 * Performance metrics by regime:
 * - Raw equity (without vol scaling)
 * - Scaled equity (with vol scaling)
 * - Comparison: MaxDD, Sharpe, WorstDay deltas
 * 
 * BTC-only for now.
 */

import type { VolatilityRegime } from '../regime/regime.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface EquityPoint {
  t: string;  // date
  v: number;  // equity value
}

export interface PerformanceMetrics {
  cagr: number;
  sharpe: number;
  maxDD: number;
  worstDay: number;
  trades: number;
}

export interface RegimePerformance {
  regime: VolatilityRegime;
  countDays: number;
  trades: number;
  hitRate: number;
  expectancy: number;
  avgRealized: number;
  maxDD: number;
  worstDay: number;
  avgSizeBeforeVol: number;
  avgSizeAfterVol: number;
  avgVolMult: number;
}

export interface AttributionResult {
  symbol: string;
  asof: string;
  sample: {
    snapshotsTotal: number;
    resolvedTotal: number;
    from: string;
    to: string;
    minRequiredResolved: number;
    verdict: 'OK' | 'INSUFFICIENT_DATA';
  };
  summary: {
    raw: PerformanceMetrics;
    scaled: PerformanceMetrics;
    delta: {
      maxDD_pp: number;
      sharpe: number;
      worstDay_pp: number;
    };
  };
  byRegime: RegimePerformance[];
  equity: {
    base: number;
    raw: EquityPoint[];
    scaled: EquityPoint[];
  };
  notes: string[];
}

export interface TimelineEntry {
  t: string;
  regime: VolatilityRegime;
  rv30: number | null;
  rv90: number | null;
  atr14Pct: number | null;
  z: number | null;
}

export interface TimelineResult {
  symbol: string;
  count: number;
  timeline: TimelineEntry[];
}

// ═══════════════════════════════════════════════════════════════
// METRICS UTILS
// ═══════════════════════════════════════════════════════════════

function calcReturns(equity: EquityPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].v;
    const curr = equity[i].v;
    if (prev > 0) {
      returns.push(curr / prev - 1);
    }
  }
  return returns;
}

function calcMaxDD(equity: EquityPoint[]): number {
  let maxDD = 0;
  let peak = equity[0]?.v || 1;

  for (const point of equity) {
    if (point.v > peak) {
      peak = point.v;
    }
    const dd = (peak - point.v) / peak;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }
  return maxDD;
}

function calcSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252); // Annualized
}

function calcWorstDay(returns: number[]): number {
  if (returns.length === 0) return 0;
  return Math.min(...returns);
}

function calcCagr(equity: EquityPoint[]): number {
  if (equity.length < 2) return 0;
  const start = equity[0].v;
  const end = equity[equity.length - 1].v;
  const days = equity.length;
  if (start <= 0 || days <= 1) return 0;
  return Math.pow(end / start, 365 / days) - 1;
}

// ═══════════════════════════════════════════════════════════════
// LEDGER ENTRY (for attribution)
// ═══════════════════════════════════════════════════════════════

interface LedgerEntry {
  t: string;
  regime: VolatilityRegime;
  decision: string;
  expectedReturn: number;
  realizedReturn: number;
  size: number;
  sizeBeforeVol: number;
  volMult: number;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class VolatilityAttributionService {
  /**
   * Build attribution from snapshots.
   * For now, generates mock data since we don't have enough resolved snapshots yet.
   */
  async buildAttribution(symbol: string): Promise<AttributionResult> {
    // In production, this would query SignalSnapshotModel
    // For now, return structure with mock/empty data
    
    const asof = new Date().toISOString().slice(0, 10);
    
    // Generate sample equity curves (placeholder)
    const sampleDays = 90;
    const rawEquity: EquityPoint[] = [];
    const scaledEquity: EquityPoint[] = [];
    let rawEq = 1.0;
    let scaledEq = 1.0;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - sampleDays);
    
    for (let i = 0; i < sampleDays; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().slice(0, 10);
      
      // Simulate some returns
      const rawReturn = (Math.random() - 0.48) * 0.03;
      const scaledReturn = rawReturn * 0.7; // Scaled is more conservative
      
      rawEq *= (1 + rawReturn);
      scaledEq *= (1 + scaledReturn);
      
      rawEquity.push({ t: dateStr, v: rawEq });
      scaledEquity.push({ t: dateStr, v: scaledEq });
    }
    
    const rawReturns = calcReturns(rawEquity);
    const scaledReturns = calcReturns(scaledEquity);
    
    const rawMetrics: PerformanceMetrics = {
      cagr: calcCagr(rawEquity),
      sharpe: calcSharpe(rawReturns),
      maxDD: calcMaxDD(rawEquity),
      worstDay: calcWorstDay(rawReturns),
      trades: sampleDays,
    };
    
    const scaledMetrics: PerformanceMetrics = {
      cagr: calcCagr(scaledEquity),
      sharpe: calcSharpe(scaledReturns),
      maxDD: calcMaxDD(scaledEquity),
      worstDay: calcWorstDay(scaledReturns),
      trades: sampleDays,
    };
    
    // Generate regime performance (placeholder)
    const byRegime: RegimePerformance[] = [
      { regime: 'LOW', countDays: 30, trades: 10, hitRate: 0.55, expectancy: 0.002, avgRealized: 0.004, maxDD: 0.06, worstDay: -0.02, avgSizeBeforeVol: 0.34, avgSizeAfterVol: 0.36, avgVolMult: 1.05 },
      { regime: 'NORMAL', countDays: 40, trades: 15, hitRate: 0.53, expectancy: 0.001, avgRealized: 0.003, maxDD: 0.08, worstDay: -0.03, avgSizeBeforeVol: 0.32, avgSizeAfterVol: 0.32, avgVolMult: 1.00 },
      { regime: 'HIGH', countDays: 15, trades: 5, hitRate: 0.40, expectancy: -0.001, avgRealized: -0.002, maxDD: 0.10, worstDay: -0.05, avgSizeBeforeVol: 0.30, avgSizeAfterVol: 0.21, avgVolMult: 0.70 },
      { regime: 'CRISIS', countDays: 5, trades: 2, hitRate: 0.50, expectancy: 0.000, avgRealized: -0.001, maxDD: 0.12, worstDay: -0.04, avgSizeBeforeVol: 0.28, avgSizeAfterVol: 0.07, avgVolMult: 0.25 },
    ];
    
    return {
      symbol,
      asof,
      sample: {
        snapshotsTotal: sampleDays,
        resolvedTotal: sampleDays,
        from: rawEquity[0]?.t || asof,
        to: rawEquity[rawEquity.length - 1]?.t || asof,
        minRequiredResolved: 30,
        verdict: sampleDays >= 30 ? 'OK' : 'INSUFFICIENT_DATA',
      },
      summary: {
        raw: rawMetrics,
        scaled: scaledMetrics,
        delta: {
          maxDD_pp: (scaledMetrics.maxDD - rawMetrics.maxDD) * 100,
          sharpe: scaledMetrics.sharpe - rawMetrics.sharpe,
          worstDay_pp: (scaledMetrics.worstDay - rawMetrics.worstDay) * 100,
        },
      },
      byRegime,
      equity: {
        base: 1.0,
        raw: rawEquity,
        scaled: scaledEquity,
      },
      notes: [
        'raw = assume volMult=1.0',
        'scaled = uses stored volMult from snapshots',
        'trades derived from decision != HOLD and finalSize > 0',
        'NOTE: Currently showing simulated data until enough resolved snapshots accumulate',
      ],
    };
  }

  /**
   * Build timeline from snapshots.
   */
  async buildTimeline(symbol: string, limit: number = 365): Promise<TimelineResult> {
    // In production, query SignalSnapshotModel
    // For now, generate sample timeline
    
    const timeline: TimelineEntry[] = [];
    const regimes: VolatilityRegime[] = ['LOW', 'NORMAL', 'NORMAL', 'HIGH', 'NORMAL', 'CRISIS', 'HIGH', 'NORMAL'];
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - limit);
    
    for (let i = 0; i < Math.min(limit, 90); i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      
      const regime = regimes[i % regimes.length];
      const rv30 = 0.4 + Math.random() * 0.4;
      const rv90 = 0.35 + Math.random() * 0.25;
      
      timeline.push({
        t: date.toISOString().slice(0, 10),
        regime,
        rv30,
        rv90,
        atr14Pct: 0.02 + Math.random() * 0.03,
        z: (rv30 - 0.5) / 0.15,
      });
    }
    
    return {
      symbol,
      count: timeline.length,
      timeline,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: VolatilityAttributionService | null = null;

export function getVolatilityAttributionService(): VolatilityAttributionService {
  if (!_instance) {
    _instance = new VolatilityAttributionService();
  }
  return _instance;
}
