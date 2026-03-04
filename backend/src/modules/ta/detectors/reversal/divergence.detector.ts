/**
 * Divergence Detector
 * 
 * Phase 8.5: RSI/MACD Divergences
 * 
 * Detects:
 * - DIVERGENCE_BULL_RSI / DIVERGENCE_BEAR_RSI
 * - DIVERGENCE_BULL_MACD / DIVERGENCE_BEAR_MACD
 * 
 * Uses pivots for price extremes and compares with oscillator values.
 * Bullish: price lower low + oscillator higher low
 * Bearish: price higher high + oscillator lower high
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, Pivot, TAContext, PatternType, Candle } from '../../domain/types.js';
import { computeRSI, computeMACD } from '../../core/indicators.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type DivergenceConfig = {
  lookbackPivots: number;     // e.g. 26
  minBarsBetween: number;     // e.g. 6
  maxBarsBetween: number;     // e.g. 120
  minMoveAtr: number;         // e.g. 1.2
  rsiDeltaMin: number;        // e.g. 3.0 for RSI points
  macdDeltaMin: number;       // e.g. 0.05 for MACD histogram
  entryBufferAtrMult: number; // e.g. 0.12
  stopBufferAtrMult: number;  // e.g. 0.20
  minRR: number;              // e.g. 0.6
};

export const DEFAULT_DIVERGENCE_CONFIG: DivergenceConfig = {
  lookbackPivots: 26,
  minBarsBetween: 6,
  maxBarsBetween: 120,
  minMoveAtr: 1.2,
  rsiDeltaMin: 3.0,
  macdDeltaMin: 0.05,
  entryBufferAtrMult: 0.12,
  stopBufferAtrMult: 0.20,
  minRR: 0.6,
};

// ═══════════════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════════════

export class DivergenceDetector implements Detector {
  public readonly id = 'divergence.detector.v1';
  public readonly name = 'Divergence Detector';
  public readonly types: PatternType[] = [
    'DIVERGENCE_BULL_RSI',
    'DIVERGENCE_BEAR_RSI',
    'DIVERGENCE_BULL_MACD',
    'DIVERGENCE_BEAR_MACD',
  ];
  public readonly version = '1.0.0';

  constructor(private cfg: DivergenceConfig = DEFAULT_DIVERGENCE_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const pivots = ctx.pivots;
    if (!pivots || pivots.length < 8) return [];

    const candles = ctx.series.candles;
    const n = candles.length;
    const atr = ctx.atr[n - 1] || 0;
    if (atr <= 0) return [];

    // Compute oscillators
    const rsi = computeRSI(candles, 14);
    const macdData = computeMACD(candles, 12, 26, 9);
    const macdHist = macdData.histogram;

    const out: CandidatePattern[] = [];

    // RSI divergences
    if (rsi.length === n) {
      out.push(...this.detectOneOsc(ctx, 'RSI', rsi, atr, this.cfg.rsiDeltaMin));
    }

    // MACD divergences (normalize histogram by ATR for cross-asset comparability)
    if (macdHist.length === n) {
      const normalizedMacd = macdHist.map((v, i) => (atr > 0 ? v / atr : v));
      out.push(...this.detectOneOsc(ctx, 'MACD', normalizedMacd, atr, this.cfg.macdDeltaMin));
    }

    return out;
  }

  private detectOneOsc(
    ctx: TAContext,
    name: 'RSI' | 'MACD',
    osc: number[],
    atr: number,
    minDelta: number
  ): CandidatePattern[] {
    const pivots = ctx.pivots.slice(-this.cfg.lookbackPivots);

    const lows = pivots.filter(p => p.type === 'LOW');
    const highs = pivots.filter(p => p.type === 'HIGH');

    const out: CandidatePattern[] = [];

    // Bullish divergence: last two lows
    const bullPivots = this.lastTwo(lows);
    if (bullPivots) {
      const [p1, p2] = bullPivots;
      const cand = this.buildBullDiv(ctx, name, osc, p1, p2, atr, minDelta);
      if (cand) out.push(cand);
    }

    // Bearish divergence: last two highs
    const bearPivots = this.lastTwo(highs);
    if (bearPivots) {
      const [p1, p2] = bearPivots;
      const cand = this.buildBearDiv(ctx, name, osc, p1, p2, atr, minDelta);
      if (cand) out.push(cand);
    }

    return out;
  }

  private buildBullDiv(
    ctx: TAContext,
    oscName: 'RSI' | 'MACD',
    osc: number[],
    p1: Pivot,
    p2: Pivot,
    atr: number,
    minDelta: number
  ): CandidatePattern | null {
    const barsBetween = p2.i - p1.i;
    if (barsBetween < this.cfg.minBarsBetween || barsBetween > this.cfg.maxBarsBetween) return null;

    // Price lower low
    if (!(p2.price < p1.price)) return null;

    // Osc higher low
    const o1 = osc[p1.i];
    const o2 = osc[p2.i];
    if (!(o2 > o1)) return null;

    // Filters
    const move = p1.price - p2.price;
    if (move < this.cfg.minMoveAtr * atr) return null;

    const oscDelta = o2 - o1;
    if (Math.abs(oscDelta) < minDelta) return null;

    // Trade: long on break of interim swing high
    const hi = this.maxHighBetween(ctx.series.candles, p1.i, p2.i);
    const bufferE = this.cfg.entryBufferAtrMult * atr;
    const bufferS = this.cfg.stopBufferAtrMult * atr;

    const entry = hi + bufferE;
    const stop = p2.price - bufferS;
    const target = entry + 2.0 * (entry - stop);
    const rr = (entry - stop) > 0 ? (target - entry) / (entry - stop) : 0;
    if (rr < this.cfg.minRR) return null;

    const type: PatternType = oscName === 'RSI' ? 'DIVERGENCE_BULL_RSI' : 'DIVERGENCE_BULL_MACD';
    const id = this.makeId(ctx.series.asset, '1D', type, p1.i, p2.i, p1.price, p2.price, o1, o2);

    return {
      id,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: ctx.series.candles[p1.i]?.ts ?? ctx.series.candles[0].ts,
      endTs: ctx.series.candles[p2.i]?.ts ?? ctx.series.candles[ctx.series.candles.length - 1].ts,
      startIdx: p1.i,
      endIdx: p2.i,
      direction: 'BULLISH',
      geometry: {
        pivots: {
          A: { x: p1.i, y: p1.price },
          B: { x: p2.i, y: p2.price },
        },
        osc: {
          A: { x: p1.i, y: o1 },
          B: { x: p2.i, y: o2 },
        },
        oscType: oscName,
      },
      metrics: {
        geometryScore: 0.7,
        touchScore: 0.8,
        symmetryScore: 0.8,
        durationScore: Math.min(1, barsBetween / 60),
        noiseScore: 0.8,
        totalScore: 0.6,
        barsBetween,
        priceMoveAtr: move / atr,
        oscDelta,
        rr,
      },
      context: this.contextSnapshot(ctx, atr),
      trade: {
        entry,
        stop,
        target1: target,
        riskReward: rr,
      },
    };
  }

  private buildBearDiv(
    ctx: TAContext,
    oscName: 'RSI' | 'MACD',
    osc: number[],
    p1: Pivot,
    p2: Pivot,
    atr: number,
    minDelta: number
  ): CandidatePattern | null {
    const barsBetween = p2.i - p1.i;
    if (barsBetween < this.cfg.minBarsBetween || barsBetween > this.cfg.maxBarsBetween) return null;

    // Price higher high
    if (!(p2.price > p1.price)) return null;

    // Osc lower high
    const o1 = osc[p1.i];
    const o2 = osc[p2.i];
    if (!(o2 < o1)) return null;

    const move = p2.price - p1.price;
    if (move < this.cfg.minMoveAtr * atr) return null;

    const oscDelta = o2 - o1;
    if (Math.abs(oscDelta) < minDelta) return null;

    // Trade: short on break of interim swing low
    const lo = this.minLowBetween(ctx.series.candles, p1.i, p2.i);
    const bufferE = this.cfg.entryBufferAtrMult * atr;
    const bufferS = this.cfg.stopBufferAtrMult * atr;

    const entry = lo - bufferE;
    const stop = p2.price + bufferS;
    const target = entry - 2.0 * (stop - entry);
    const rr = (stop - entry) > 0 ? (entry - target) / (stop - entry) : 0;
    if (rr < this.cfg.minRR) return null;

    const type: PatternType = oscName === 'RSI' ? 'DIVERGENCE_BEAR_RSI' : 'DIVERGENCE_BEAR_MACD';
    const id = this.makeId(ctx.series.asset, '1D', type, p1.i, p2.i, p1.price, p2.price, o1, o2);

    return {
      id,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: ctx.series.candles[p1.i]?.ts ?? ctx.series.candles[0].ts,
      endTs: ctx.series.candles[p2.i]?.ts ?? ctx.series.candles[ctx.series.candles.length - 1].ts,
      startIdx: p1.i,
      endIdx: p2.i,
      direction: 'BEARISH',
      geometry: {
        pivots: {
          A: { x: p1.i, y: p1.price },
          B: { x: p2.i, y: p2.price },
        },
        osc: {
          A: { x: p1.i, y: o1 },
          B: { x: p2.i, y: o2 },
        },
        oscType: oscName,
      },
      metrics: {
        geometryScore: 0.7,
        touchScore: 0.8,
        symmetryScore: 0.8,
        durationScore: Math.min(1, barsBetween / 60),
        noiseScore: 0.8,
        totalScore: 0.6,
        barsBetween,
        priceMoveAtr: move / atr,
        oscDelta,
        rr,
      },
      context: this.contextSnapshot(ctx, atr),
      trade: {
        entry,
        stop,
        target1: target,
        riskReward: rr,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  private lastTwo(arr: Pivot[]): [Pivot, Pivot] | null {
    if (arr.length < 2) return null;
    const a = arr[arr.length - 2];
    const b = arr[arr.length - 1];
    if (b.i <= a.i) return null;
    return [a, b];
  }

  private maxHighBetween(candles: Candle[], a: number, b: number): number {
    let m = -Infinity;
    for (let i = a; i <= b; i++) m = Math.max(m, candles[i].high);
    return m;
  }

  private minLowBetween(candles: Candle[], a: number, b: number): number {
    let m = Infinity;
    for (let i = a; i <= b; i++) m = Math.min(m, candles[i].low);
    return m;
  }

  private contextSnapshot(ctx: TAContext, atr: number): any {
    return {
      regime: ctx.structure?.regime ?? 'TRANSITION',
      atr,
      currentPrice: ctx.series.candles[ctx.series.candles.length - 1]?.close ?? 0,
      maContext: {
        priceVsMa50: ctx.featuresPack?.ma?.dist50 ?? 0,
        priceVsMa200: ctx.featuresPack?.ma?.dist200 ?? 0,
        ma50VsMa200: 0,
        maSlope50: ctx.featuresPack?.ma?.slope50 ?? 0,
        maSlope200: ctx.featuresPack?.ma?.slope200 ?? 0,
      },
    };
  }

  private makeId(
    asset: string, tf: string, type: string, a: number, b: number,
    p1: number, p2: number, o1: number, o2: number
  ): string {
    const payload = JSON.stringify({
      asset, tf, type, a, b,
      p1: this.round(p1), p2: this.round(p2),
      o1: this.round(o1), o2: this.round(o2),
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  private round(x: number): number {
    return Math.round(x * 1e6) / 1e6;
  }
}
