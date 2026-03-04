/**
 * BLOCK 37.3 — Phase Classifier
 * 
 * Classifies market phase based on:
 * - MA20/MA200 slopes and distances
 * - Volatility z-score
 * - Rolling drawdown
 * - Price extension vs MA200
 */

import {
  PhaseBucket,
  PhaseClassifierConfig,
  DEFAULT_PHASE_CLASSIFIER_CONFIG,
} from '../contracts/phase.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Math Utilities
// ═══════════════════════════════════════════════════════════════

function sma(x: number[], n: number): number {
  if (x.length < n) return x[x.length - 1] || 0;
  let s = 0;
  for (let i = x.length - n; i < x.length; i++) {
    s += x[i];
  }
  return s / n;
}

function smaSeries(x: number[], n: number, lastK: number): number[] {
  const out: number[] = [];
  for (let k = lastK; k >= 1; k--) {
    const slice = x.slice(0, x.length - (k - 1));
    if (slice.length < n) continue;
    out.push(sma(slice, n));
  }
  return out;
}

function slope(y: number[]): number {
  if (y.length < 2) return 0;
  return (y[y.length - 1] - y[0]) / (y.length - 1);
}

function returns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev > 0 && cur > 0) {
      r.push((cur / prev) - 1);
    } else {
      r.push(0);
    }
  }
  return r;
}

function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const variance = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
  return Math.sqrt(variance);
}

/**
 * Realized volatility z-score vs long baseline
 * @param closes - price series
 * @param lb - lookback for recent vol
 * @param annual - annualization factor (252 for daily)
 */
function realizedVolZ(closes: number[], lb: number, annual: number): number {
  const r = returns(closes);
  if (r.length < lb) return 0;
  
  const recent = r.slice(-lb);
  const baseline = r.slice(-Math.min(r.length, 5 * annual)); // ~5y baseline if exists
  
  const v1 = std(recent) * Math.sqrt(annual);
  const v0 = std(baseline) * Math.sqrt(annual);
  
  if (v0 === 0) return 0;
  return (v1 - v0) / v0; // relative z-ish
}

/**
 * Rolling peak drawdown over lookback period
 */
function rollingPeakDrawdown(closes: number[], lb: number): number {
  const start = Math.max(0, closes.length - lb);
  let peak = closes[start];
  let maxDD = 0;
  
  for (let i = start + 1; i < closes.length; i++) {
    peak = Math.max(peak, closes[i]);
    const dd = (peak - closes[i]) / peak;
    maxDD = Math.max(maxDD, dd);
  }
  return maxDD;
}

// ═══════════════════════════════════════════════════════════════
// Phase Classification
// ═══════════════════════════════════════════════════════════════

/**
 * Classify market phase based on technical indicators
 * 
 * Phases:
 * - ACCUMULATION: low vol, sideways, moderate DD
 * - MARKUP: uptrend, moderate vol
 * - DISTRIBUTION: peak/overbought, vol rising, weakness
 * - MARKDOWN: downtrend, high vol/dd
 * - CAPITULATION: extreme dd/vol, panic
 * - RECOVERY: exit from dd, uptrend but vol still high
 */
export function classifyPhase(
  closes: number[],
  cfg: PhaseClassifierConfig = DEFAULT_PHASE_CLASSIFIER_CONFIG
): PhaseBucket {
  const minLen = Math.max(cfg.maSlow, cfg.ddLookback) + 5;
  if (closes.length < minLen) return "UNKNOWN";

  const p = closes[closes.length - 1];

  // Moving averages
  const ma20 = sma(closes, cfg.maFast);
  const ma200 = sma(closes, cfg.maSlow);

  // MA200 slope over last 20 days
  const ma200Series = smaSeries(closes, cfg.maSlow, 20);
  const ma200Slope = slope(ma200Series);

  // Volatility z-score vs baseline
  const vol = realizedVolZ(closes, cfg.volLookback, 252);

  // Rolling drawdown
  const dd90 = rollingPeakDrawdown(closes, cfg.ddLookback);

  // Price extension vs MA200
  const overExt = ma200 > 0 ? (p / ma200) : 1;

  // ═══════════════════════════════════════════════════════════════
  // Classification Logic (priority order)
  // ═══════════════════════════════════════════════════════════════

  // CAPITULATION: extreme dd + high vol (panic selling)
  if (dd90 >= cfg.ddCapitulation && vol >= cfg.volHighZ) {
    return "CAPITULATION";
  }

  // MARKDOWN: downtrend slope + elevated dd
  if (ma200Slope <= cfg.trendDownSlope && dd90 >= cfg.ddMarkdown) {
    return "MARKDOWN";
  }

  // RECOVERY: price back above ma20 but still high vol / recent dd
  if (p > ma20 && dd90 >= cfg.ddMarkdown && vol >= 0.5) {
    return "RECOVERY";
  }

  // DISTRIBUTION: overextension + rising vol + slope flattening
  if (overExt >= cfg.overExtBubble && vol >= 0.5 && Math.abs(ma200Slope) < 0.0002) {
    return "DISTRIBUTION";
  }

  // MARKUP: up slope + price above ma20/ma200
  if (ma200Slope >= cfg.trendUpSlope && p > ma20 && p > ma200) {
    return "MARKUP";
  }

  // ACCUMULATION: price near ma200, low vol, low dd
  if (Math.abs(p / ma200 - 1) < 0.08 && vol < 0.3 && dd90 < cfg.ddMarkdown) {
    return "ACCUMULATION";
  }

  return "UNKNOWN";
}

/**
 * Get phase classification with diagnostic details
 */
export function classifyPhaseDetailed(
  closes: number[],
  cfg: PhaseClassifierConfig = DEFAULT_PHASE_CLASSIFIER_CONFIG
): {
  phase: PhaseBucket;
  metrics: {
    price: number;
    ma20: number;
    ma200: number;
    ma200Slope: number;
    volZ: number;
    dd90: number;
    overExtension: number;
  };
} {
  const minLen = Math.max(cfg.maSlow, cfg.ddLookback) + 5;
  if (closes.length < minLen) {
    return {
      phase: "UNKNOWN",
      metrics: {
        price: closes[closes.length - 1] || 0,
        ma20: 0,
        ma200: 0,
        ma200Slope: 0,
        volZ: 0,
        dd90: 0,
        overExtension: 1,
      },
    };
  }

  const p = closes[closes.length - 1];
  const ma20 = sma(closes, cfg.maFast);
  const ma200 = sma(closes, cfg.maSlow);
  const ma200Series = smaSeries(closes, cfg.maSlow, 20);
  const ma200Slope = slope(ma200Series);
  const vol = realizedVolZ(closes, cfg.volLookback, 252);
  const dd90 = rollingPeakDrawdown(closes, cfg.ddLookback);
  const overExt = ma200 > 0 ? (p / ma200) : 1;

  return {
    phase: classifyPhase(closes, cfg),
    metrics: {
      price: Math.round(p * 100) / 100,
      ma20: Math.round(ma20 * 100) / 100,
      ma200: Math.round(ma200 * 100) / 100,
      ma200Slope: Math.round(ma200Slope * 100000) / 100000,
      volZ: Math.round(vol * 1000) / 1000,
      dd90: Math.round(dd90 * 1000) / 1000,
      overExtension: Math.round(overExt * 1000) / 1000,
    },
  };
}
