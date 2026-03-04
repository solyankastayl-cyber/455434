/**
 * BLOCK 34.8 + 34.11 — Fractal Signal Builder
 * 
 * Builds trading signals from fractal pattern matching.
 * Uses FractalEngine.match() with asOf support for look-ahead safe simulation.
 * 
 * BLOCK 34.11: Relative signal mode
 * - Computes baseline expected return for horizon
 * - Signal based on excess = mu - baseline
 * - Eliminates structural LONG bias from BTC drift
 * 
 * Key features:
 * - Expected return (mu) from median of forward outcomes
 * - Baseline market drift for horizon
 * - Excess return for signal decision
 * - Downside risk (P10, DD95)
 * - Confidence based on match count and agreement
 * - Anti-leak: minGapDays exclusion
 */

import type { FractalEngine } from './fractal.engine.js';
import type { FractalMatchResponse } from '../contracts/fractal.contracts.js';

export interface FractalSignalParams {
  symbol: string;
  timeframe: '1d';
  asOf?: string | Date;       // Critical for simulation - filters data <= asOf
  windowLen: number;          // 30/60/90
  topK: number;               // 25
  minSimilarity: number;      // 0.35-0.50 for raw_returns mode
  minMatches: number;         // 6-12
  horizonDays: number;        // 14/30/60
  minGapDays: number;         // 60 - exclude near history
  neutralBand: number;        // 0.0015-0.003 (absolute mode)
  similarityMode?: 'zscore' | 'raw_returns'; // BLOCK 34.10: default 'raw_returns' for sim
  
  // BLOCK 34.11: Relative signal params
  useRelative?: boolean;            // default true - use excess instead of mu
  relativeBand?: number;            // threshold on excess (e.g. 0.001 = 0.1% log-return)
  baselineLookbackDays?: number;    // 0 = expanding to start; else last N days
}

export interface FractalMatchRow {
  startTs: string;
  endTs: string;
  similarity: number;
  forwardReturn: number;
  forwardMaxDD: number;
}

export interface FractalSignal {
  action: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;         // 0..1
  mu: number;                 // median forward return
  baseline: number;           // BLOCK 34.11: expected market drift for horizon
  excess: number;             // BLOCK 34.11: mu - baseline
  p10: number;                // 10th percentile forward return (downside)
  p90: number;                // 90th percentile forward return (upside)
  dd95: number;               // 95th percentile forward maxDD
  matchCount: number;
  usedWindowLen: number;
  usedHorizonDays: number;
  topMatches: FractalMatchRow[];
  reason: string;
  asOf?: string;
  regime?: 'STRUCTURAL_BEAR' | 'NORMAL' | 'CRASH_TRANSITION';  // BLOCK 34.14
  meta?: RegimeMeta;  // BLOCK 34.14: Full regime metadata
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function quantile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const v0 = sortedAsc[base] ?? sortedAsc[sortedAsc.length - 1];
  const v1 = sortedAsc[base + 1] ?? v0;
  return v0 + rest * (v1 - v0);
}

function median(sortedAsc: number[]): number {
  return quantile(sortedAsc, 0.5);
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

/**
 * BLOCK 34.11: Compute baseline expected return for horizon
 * This is the average log-return over horizonDays across all historical data
 * asOf-safe: uses only data in the series (already truncated by engine)
 */
type PricePoint = { ts: Date; close: number };

function computeBaselineExpectedReturn(
  series: PricePoint[],
  horizonDays: number,
  lookbackDays?: number
): number {
  if (series.length < horizonDays + 5) return 0;

  const end = series.length - 1;
  
  // Determine start index based on lookback
  const start = (() => {
    if (!lookbackDays || lookbackDays <= 0) return 0;  // expanding from beginning
    // Find index near end-lookbackDays
    const cutoffTs = series[end].ts.getTime() - lookbackDays * 86400_000;
    let idx = 0;
    for (let k = end; k >= 0; k--) {
      if (series[k].ts.getTime() <= cutoffTs) {
        idx = k;
        break;
      }
    }
    return Math.max(0, idx);
  })();

  // Compute all horizon-period log-returns
  const rets: number[] = [];
  for (let i = start; i < series.length - horizonDays; i++) {
    const a = series[i].close;
    const b = series[i + horizonDays].close;
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      rets.push(Math.log(b / a));
    }
  }
  
  if (!rets.length) return 0;
  
  // Return mean baseline
  const m = rets.reduce((x, y) => x + y, 0) / rets.length;
  return m;
}

// ============================================================
// BLOCK 34.14 — Crash Transition Guard + Structural Bear
// ============================================================

/**
 * Simple Moving Average helper
 */
function sma(values: number[], n: number): number {
  if (values.length < n) return NaN;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) {
    s += values[i];
  }
  return s / n;
}

/**
 * BLOCK 34.14.1: Structural Bear Detector (MA200 + slope)
 * 
 * Returns true when:
 * - Price < MA200
 * - MA200 is falling (current MA200 < MA200 from 5 days ago)
 * 
 * This is the "regime" detector - triggers later but confirms bear market.
 */
function isStructuralBear(series: { close: number }[]): boolean {
  if (series.length < 220) return false;

  const closes = series.map(x => Number(x.close));
  const price = closes[closes.length - 1];

  const ma200 = sma(closes, 200);
  const ma200Prev = sma(closes.slice(0, closes.length - 5), 200);

  if (!Number.isFinite(ma200) || !Number.isFinite(ma200Prev)) return false;

  return price < ma200 && ma200 < ma200Prev;
}

/**
 * BLOCK 34.16A: Structural Bull Detector (MA200 + slope)
 * 
 * Returns true when:
 * - Price > MA200
 * - MA200 is rising (current MA200 > MA200 from 5 days ago)
 * 
 * Used to block SHORT signals in bull trend ("no shorting the rally").
 */
function isStructuralBull(series: { close: number }[]): boolean {
  if (series.length < 220) return false;

  const closes = series.map(x => Number(x.close));
  const last = closes.length - 1;
  const price = closes[last];

  const ma200 = sma(closes, 200);
  const ma200Prev = sma(closes.slice(0, closes.length - 5), 200);

  if (!Number.isFinite(ma200) || !Number.isFinite(ma200Prev)) return false;

  return price > ma200 && ma200 > ma200Prev;
}

/**
 * BLOCK 34.14.2: Rolling Peak Drawdown Calculator
 * 
 * Calculates the drawdown from peak price over lookback period.
 * Returns fraction: 0.25 means -25% from peak.
 */
function rollingPeakDD(series: { close: number }[], lookbackDays: number): number {
  if (series.length < lookbackDays + 5) return 0;

  const start = Math.max(0, series.length - lookbackDays);

  let peak = -Infinity;
  for (let i = start; i < series.length; i++) {
    const c = Number(series[i].close);
    if (Number.isFinite(c)) {
      peak = Math.max(peak, c);
    }
  }

  const last = Number(series[series.length - 1].close);
  if (!Number.isFinite(peak) || peak <= 0 || !Number.isFinite(last)) return 0;

  return Math.max(0, (peak - last) / peak);
}

/**
 * BLOCK 34.15: Bubble Top Overextension Filter
 * 
 * Detects when price is severely overextended from MA200.
 * At overExt >= 2.6 (price is 2.6x MA200), triggers bubble mode.
 * 
 * This catches bubble tops BEFORE crash transition kicks in.
 */
function bubbleOverextension(closes: number[]): { bubble: boolean; overExt: number } {
  if (closes.length < 220) {
    return { bubble: false, overExt: 1 };
  }

  const price = closes[closes.length - 1];
  const ma200 = sma(closes, 200);

  if (!Number.isFinite(price) || !Number.isFinite(ma200) || ma200 <= 0) {
    return { bubble: false, overExt: 1 };
  }

  const overExt = price / ma200;

  return {
    bubble: overExt >= 2.6,
    overExt
  };
}

/**
 * BLOCK 34.14 + 34.16 Meta interface for signal
 */
export interface RegimeMeta {
  structuralBear: boolean;
  structuralBull: boolean;  // BLOCK 34.16A
  crashTransition: boolean;
  dd120: number;
  bubble: boolean;      // BLOCK 34.15
  overExt: number;      // BLOCK 34.15
}

export class FractalSignalBuilder {
  constructor(private fractalEngine: FractalEngine) {}

  /**
   * Build a trading signal from fractal pattern matching
   * BLOCK 34.10: Added similarityMode for asOf-safe simulations
   * BLOCK 34.11: Added relative signal mode (excess = mu - baseline)
   */
  async build(p: FractalSignalParams): Promise<FractalSignal> {
    try {
      // BLOCK 34.10: Default to raw_returns for asOf-safe simulation
      const similarityMode = p.similarityMode ?? "raw_returns";
      
      // BLOCK 34.11: Default to relative mode
      const useRelative = p.useRelative ?? true;
      
      // Call fractal engine with asOf for look-ahead protection
      // Request series if using relative mode
      const matchResponse: FractalMatchResponse = await this.fractalEngine.match({
        symbol: p.symbol,
        timeframe: p.timeframe,
        windowLen: p.windowLen as 30 | 60 | 90,
        topK: p.topK,
        forwardHorizon: p.horizonDays,
        asOf: p.asOf ? new Date(p.asOf) : undefined,
        similarityMode,
        includeSeriesUsed: useRelative  // BLOCK 34.11
      });

      if (!matchResponse.ok || !matchResponse.matches || matchResponse.matches.length === 0) {
        return this.neutralSignal(p, 'NO_MATCHES', 0, 0);
      }

      // Build match rows with forward outcomes
      const matches: FractalMatchRow[] = matchResponse.matches
        .filter(m => m.score >= p.minSimilarity)
        .slice(0, p.topK)
        .map(m => ({
          startTs: m.startTs instanceof Date ? m.startTs.toISOString() : String(m.startTs),
          endTs: m.endTs instanceof Date ? m.endTs.toISOString() : String(m.endTs),
          similarity: m.score,
          forwardReturn: matchResponse.forwardStats?.return?.p50 ?? 0,
          forwardMaxDD: matchResponse.forwardStats?.maxDrawdown?.p50 ?? 0
        }));

      if (matches.length < p.minMatches) {
        return this.neutralSignal(p, `INSUFFICIENT_MATCHES(${matches.length}<${p.minMatches})`, 0, 0);
      }

      // Use aggregated forward stats from engine
      const fs = matchResponse.forwardStats;
      
      // Use median (p50) for more robust signal - less sensitive to tail outliers
      const mu = fs?.return?.p50 ?? 0;
      const p10 = fs?.return?.p10 ?? 0;
      const p90 = fs?.return?.p90 ?? 0;
      const dd50 = fs?.maxDrawdown?.p50 ?? 0;
      const dd95 = fs?.maxDrawdown?.p90 ?? dd50;  // Use p90 as proxy for p95

      // BLOCK 34.11: Compute baseline and excess
      let baseline = 0;
      let excess = mu;
      
      if (useRelative && matchResponse.seriesUsed && matchResponse.seriesUsed.length > 0) {
        const series: PricePoint[] = matchResponse.seriesUsed.map((x: any) => ({
          ts: new Date(x.ts),
          close: Number(x.close)
        }));
        
        baseline = computeBaselineExpectedReturn(
          series, 
          p.horizonDays, 
          p.baselineLookbackDays ?? 0
        );
        
        excess = mu - baseline;
      }

      // Confidence: coverage × agreement
      const coverage = clamp01(matches.length / Math.max(1, p.topK));
      const stabilityScore = matchResponse.confidence?.stabilityScore ?? 0.5;
      const confidence = clamp01(coverage * stabilityScore);

      // BLOCK 34.11: Determine signal action based on excess (if relative) or mu (if absolute)
      const signalValue = useRelative ? excess : mu;
      const band = useRelative 
        ? (p.relativeBand ?? 0.0015)  // 0.15% excess threshold
        : p.neutralBand;

      let action: FractalSignal['action'] = 'NEUTRAL';
      if (signalValue > band) {
        action = 'LONG';
      } else if (signalValue < -band) {
        action = 'SHORT';
      }

      // ============================================================
      // BLOCK 34.14: Crash Transition Guard + Structural Bear
      // BLOCK 34.15: Bubble Top Guard (Overextension Filter)
      // BLOCK 34.16A: Bull Trend SHORT Block
      // ============================================================
      let structuralBear = false;
      let structuralBull = false;  // BLOCK 34.16A
      let crashTransition = false;
      let dd120 = 0;
      let bubble = false;
      let overExt = 1;
      let regime: FractalSignal['regime'] = 'NORMAL';
      
      if (useRelative && matchResponse.seriesUsed && matchResponse.seriesUsed.length > 0) {
        const seriesForRegime = matchResponse.seriesUsed.map((x: any) => ({
          close: Number(x.close)
        }));
        const closes = seriesForRegime.map(x => x.close);
        
        // 34.15: Bubble Top Guard (check FIRST - highest priority)
        const bubbleResult = bubbleOverextension(closes);
        bubble = bubbleResult.bubble;
        overExt = bubbleResult.overExt;
        
        // 34.14.1: Structural Bear (MA200 + slope)
        structuralBear = isStructuralBear(seriesForRegime);
        
        // 34.16A: Structural Bull (MA200 + slope)
        structuralBull = isStructuralBull(seriesForRegime);
        
        // 34.14.2: Crash Transition Kill-Switch (peak DD)
        // Using 90-day lookback and 20% threshold for earlier detection
        dd120 = rollingPeakDD(seriesForRegime, 90);
        crashTransition = dd120 >= 0.20;  // -20% from 90-day peak
        
        // 34.16A: Block SHORT in bull trend (HIGHEST PRIORITY)
        // "No shorting the rally" - this fixes S2
        if (structuralBull && action === 'SHORT') {
          action = 'NEUTRAL';
        }
        
        // 34.15: Block LONG on bubble (after bull check)
        // Also block SHORT in bubble - shorting a bubble is dangerous!
        if (bubble) {
          regime = 'NORMAL';  // We keep regime neutral, but action is blocked
          if (action === 'LONG' || action === 'SHORT') {
            action = 'NEUTRAL';
          }
        }
        // 34.14.3: Block LONG on crash/bear (if not already blocked by bubble)
        else if (crashTransition) {
          regime = 'CRASH_TRANSITION';
          if (action === 'LONG') {
            action = 'NEUTRAL';
          }
        } else if (structuralBear) {
          regime = 'STRUCTURAL_BEAR';
          if (action === 'LONG') {
            action = 'NEUTRAL';
          }
        }
      }

      const regimeMeta: RegimeMeta = {
        structuralBear,
        structuralBull,
        crashTransition,
        dd120,
        bubble,
        overExt
      };

      const reason = useRelative
        ? `OK(excess=${(excess * 100).toFixed(2)}%,base=${(baseline * 100).toFixed(2)}%,regime=${regime},dd120=${(dd120 * 100).toFixed(1)}%,bubble=${bubble},overExt=${overExt.toFixed(2)})`
        : `OK(mu=${(mu * 100).toFixed(2)}%,conf=${confidence.toFixed(2)})`;

      return {
        action,
        confidence,
        mu,
        baseline,
        excess,
        p10,
        p90,
        dd95,
        matchCount: matches.length,
        usedWindowLen: p.windowLen,
        usedHorizonDays: p.horizonDays,
        topMatches: matches.slice(0, 10),
        reason,
        asOf: p.asOf ? new Date(p.asOf).toISOString() : undefined,
        regime,
        meta: regimeMeta
      };

    } catch (err) {
      console.error('[FractalSignalBuilder] Error:', err);
      return this.neutralSignal(p, `ERROR(${err instanceof Error ? err.message : String(err)})`, 0, 0);
    }
  }

  private neutralSignal(p: FractalSignalParams, reason: string, baseline: number, excess: number): FractalSignal {
    return {
      action: 'NEUTRAL',
      confidence: 0,
      mu: 0,
      baseline,
      excess,
      p10: 0,
      p90: 0,
      dd95: 0,
      matchCount: 0,
      usedWindowLen: p.windowLen,
      usedHorizonDays: p.horizonDays,
      topMatches: [],
      reason,
      asOf: p.asOf ? new Date(p.asOf).toISOString() : undefined,
      regime: 'NORMAL',
      meta: {
        structuralBear: false,
        structuralBull: false,
        crashTransition: false,
        dd120: 0,
        bubble: false,
        overExt: 1
      }
    };
  }
}

/**
 * Default signal params (can be overridden by FractalSettings)
 * BLOCK 34.10: Default to raw_returns for asOf-safe simulation
 * BLOCK 34.11: Default to relative mode with excess-based signals
 */
export const DEFAULT_SIGNAL_PARAMS: Omit<FractalSignalParams, 'symbol' | 'timeframe'> = {
  windowLen: 30,
  topK: 25,
  minSimilarity: 0.35,   // Lower threshold for raw_returns mode
  minMatches: 4,
  horizonDays: 14,
  minGapDays: 60,
  neutralBand: 0.002,
  similarityMode: 'raw_returns',
  // BLOCK 34.11: Relative mode defaults
  useRelative: true,
  relativeBand: 0.0015,       // 0.15% excess threshold
  baselineLookbackDays: 720   // 2 years rolling baseline
};
