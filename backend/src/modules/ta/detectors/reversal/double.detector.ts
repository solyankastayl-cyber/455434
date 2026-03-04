/**
 * Double Top/Bottom Detector
 * 
 * Phase 8.1: Reversal Patterns
 * 
 * Detects:
 * - DOUBLE_TOP (bearish reversal)
 * - DOUBLE_BOTTOM (bullish reversal)
 * 
 * Uses pivots to find M/W formations with neckline validation.
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, Pivot, TAContext, PatternType } from '../../domain/types.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type DoubleDetectorConfig = {
  lookbackPivots: number;      // e.g. 24
  minAmplitudeAtr: number;     // e.g. 2.0 (height >= 2*ATR)
  levelTolAtrMult: number;     // e.g. 0.8 (H1~H2 within 0.8*ATR)
  minValleyBounceAtr: number;  // e.g. 0.8 (bounce from neckline)
  maxAsymmetry: number;        // e.g. 0.65 (time symmetry)
  minBarsBetweenPeaks: number; // e.g. 5
  maxBarsBetweenPeaks: number; // e.g. 120
};

export const DEFAULT_DOUBLE_CONFIG: DoubleDetectorConfig = {
  lookbackPivots: 24,
  minAmplitudeAtr: 2.0,
  levelTolAtrMult: 0.8,
  minValleyBounceAtr: 0.8,
  maxAsymmetry: 0.65,
  minBarsBetweenPeaks: 5,
  maxBarsBetweenPeaks: 120,
};

type DT = {
  type: 'DOUBLE_TOP' | 'DOUBLE_BOTTOM';
  a: Pivot; // first extreme
  b: Pivot; // neckline pivot
  c: Pivot; // second extreme
};

// ═══════════════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════════════

export class DoubleDetector implements Detector {
  public readonly id = 'double.detector.v1';
  public readonly name = 'Double Top/Bottom Detector';
  public readonly types: PatternType[] = ['DOUBLE_TOP', 'DOUBLE_BOTTOM'];
  public readonly version = '1.0.0';

  constructor(private cfg: DoubleDetectorConfig = DEFAULT_DOUBLE_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const pivots = ctx.pivots;
    if (!pivots || pivots.length < 7) return [];

    const recent = pivots.slice(-this.cfg.lookbackPivots);
    const atrNow = ctx.atr[ctx.atr.length - 1] || 0;
    if (atrNow <= 0) return [];

    const candidates: CandidatePattern[] = [];

    // Scan triples: H-L-H (double top) and L-H-L (double bottom)
    for (let i = 0; i < recent.length - 2; i++) {
      const p1 = recent[i];
      const p2 = recent[i + 1];
      const p3 = recent[i + 2];

      // Double Top: HIGH, LOW, HIGH
      if (p1.type === 'HIGH' && p2.type === 'LOW' && p3.type === 'HIGH') {
        const dt: DT = { type: 'DOUBLE_TOP', a: p1, b: p2, c: p3 };
        const cand = this.tryBuild(ctx, dt, atrNow);
        if (cand) candidates.push(cand);
      }

      // Double Bottom: LOW, HIGH, LOW
      if (p1.type === 'LOW' && p2.type === 'HIGH' && p3.type === 'LOW') {
        const db: DT = { type: 'DOUBLE_BOTTOM', a: p1, b: p2, c: p3 };
        const cand = this.tryBuild(ctx, db, atrNow);
        if (cand) candidates.push(cand);
      }
    }

    return candidates;
  }

  private tryBuild(ctx: TAContext, d: DT, atr: number): CandidatePattern | null {
    const { a, b, c } = d;

    // Bars constraints
    const barsBetween = Math.abs(c.i - a.i);
    if (barsBetween < this.cfg.minBarsBetweenPeaks) return null;
    if (barsBetween > this.cfg.maxBarsBetweenPeaks) return null;

    // Level similarity of a and c (peaks/valleys)
    const levelTol = this.cfg.levelTolAtrMult * atr;
    const sameLevel = Math.abs(a.price - c.price) <= levelTol;
    if (!sameLevel) return null;

    // Amplitude: distance from extreme to neckline
    const extremeAvg = 0.5 * (a.price + c.price);
    const height = d.type === 'DOUBLE_TOP' 
      ? (extremeAvg - b.price) 
      : (b.price - extremeAvg);

    if (height < this.cfg.minAmplitudeAtr * atr) return null;
    if (height < this.cfg.minValleyBounceAtr * atr) return null;

    // Symmetry (time)
    const t1 = Math.abs(b.i - a.i);
    const t2 = Math.abs(c.i - b.i);
    const asym = Math.abs(t1 - t2) / Math.max(1, t1 + t2);
    if (asym > this.cfg.maxAsymmetry) return null;

    // Neckline
    const neckline = b.price;

    // Trade plan
    const buffer = 0.15 * atr;
    let direction: 'BEARISH' | 'BULLISH';
    let entry: number;
    let stop: number;
    let target: number;

    if (d.type === 'DOUBLE_TOP') {
      direction = 'BEARISH';
      entry = neckline - buffer;
      stop = Math.max(a.price, c.price) + buffer;
      target = entry - height;
    } else {
      direction = 'BULLISH';
      entry = neckline + buffer;
      stop = Math.min(a.price, c.price) - buffer;
      target = entry + height;
    }

    const rr = this.riskReward(entry, stop, target, direction);
    if (!Number.isFinite(rr) || rr <= 0.2) return null;

    const startIdx = a.i;
    const endIdx = c.i;

    const id = this.makeId(ctx.series.asset, '1D', d.type, startIdx, endIdx, a.price, b.price, c.price);

    return {
      id,
      type: d.type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: ctx.series.candles[startIdx]?.ts ?? ctx.series.candles[0].ts,
      endTs: ctx.series.candles[endIdx]?.ts ?? ctx.series.candles[ctx.series.candles.length - 1].ts,
      startIdx,
      endIdx,
      direction,
      geometry: {
        pivots: [a, b, c],
        points: {
          A: { x: a.i, y: a.price },
          B: { x: b.i, y: b.price },
          C: { x: c.i, y: c.price },
        },
        neckline: {
          y: neckline,
          x1: startIdx,
          x2: endIdx,
        },
        measuredMove: {
          height,
          direction,
        },
      },
      metrics: {
        geometryScore: 1 - asym,
        touchScore: 1.0,
        symmetryScore: 1 - asym,
        durationScore: Math.min(1, barsBetween / 60),
        noiseScore: 0.8,
        totalScore: 0.7,
        height,
        heightAtr: atr > 0 ? height / atr : 0,
        levelDelta: Math.abs(a.price - c.price),
        levelDeltaAtr: atr > 0 ? Math.abs(a.price - c.price) / atr : 0,
        asymmetry: asym,
        barsBetween,
        rr,
      },
      context: {
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
      },
      trade: {
        entry,
        stop,
        target1: target,
        riskReward: rr,
      },
    };
  }

  private riskReward(entry: number, stop: number, target: number, dir: 'BULLISH' | 'BEARISH'): number {
    if (dir === 'BULLISH') {
      const risk = entry - stop;
      const reward = target - entry;
      if (risk <= 0 || reward <= 0) return 0;
      return reward / risk;
    } else {
      const risk = stop - entry;
      const reward = entry - target;
      if (risk <= 0 || reward <= 0) return 0;
      return reward / risk;
    }
  }

  private makeId(asset: string, tf: string, type: string, s: number, e: number, a: number, b: number, c: number): string {
    const payload = JSON.stringify({ asset, tf, type, s, e, a: this.round(a), b: this.round(b), c: this.round(c) });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  private round(x: number): number {
    return Math.round(x * 1e6) / 1e6;
  }
}
