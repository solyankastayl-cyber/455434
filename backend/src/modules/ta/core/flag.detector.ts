/**
 * Flag/Pennant Detector — Production-grade continuation pattern detector
 * 
 * Detects:
 * - FLAG_BULL (bull flag)
 * - FLAG_BEAR (bear flag)
 * - PENNANT (small triangle after impulse)
 * 
 * Algorithm:
 * 1. Find strong impulse (flagpole): move >= N*ATR in few bars
 * 2. After impulse, look for consolidation (flag canvas):
 *    - Flag: parallel channel against trend
 *    - Pennant: small triangle (convergence)
 * 3. Check retrace, duration, touches
 * 4. Return CandidatePattern with geometry and metrics
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, TAContext, PatternType } from '../domain/types.js';
import { fitLineRobust, yOnLine, distancePointLine, Point, Line } from './fit.js';

export type FlagDetectorConfig = {
  // Flagpole detection
  poleLookbackBars: number;     // e.g. 20
  poleMinMoveAtr: number;       // e.g. 3.0 (move >= 3*ATR)
  poleMinMovePct: number;       // e.g. 0.03 (>=3%)
  poleMaxBars: number;          // e.g. 12 (impulse should be sharp)

  // Flag canvas window
  flagMinBars: number;          // e.g. 5
  flagMaxBars: number;          // e.g. 25
  flagMaxRetrace: number;       // e.g. 0.55 (<=55% retrace)
  flagMaxHeightAtr: number;     // e.g. 2.0 (canvas height <= 2*ATR)

  // Fitting tolerance
  toleranceAtrMult: number;     // e.g. 0.6
  ransacIters: number;          // e.g. 64

  // Classification
  slopeFlatEps: number;         // e.g. 1e-4
  pennantConvergenceMin: number;// e.g. 0.12
};

export const DEFAULT_FLAG_CONFIG: FlagDetectorConfig = {
  poleLookbackBars: 20,
  poleMinMoveAtr: 3.0,
  poleMinMovePct: 0.03,
  poleMaxBars: 12,
  flagMinBars: 5,
  flagMaxBars: 25,
  flagMaxRetrace: 0.55,
  flagMaxHeightAtr: 2.0,
  toleranceAtrMult: 0.6,
  ransacIters: 64,
  slopeFlatEps: 1e-4,
  pennantConvergenceMin: 0.12,
};

type Pole = {
  dir: 'BULL' | 'BEAR';
  startI: number;
  endI: number;
  startPrice: number;
  endPrice: number;
  moveAbs: number;
  movePct: number;
  moveAtr: number;
};

export class FlagDetector implements Detector {
  public readonly id = 'flag.detector.v1';
  public readonly name = 'Flag/Pennant Detector';
  public readonly types: PatternType[] = ['FLAG_BULL', 'FLAG_BEAR'];
  public readonly version = '1.0.0';

  constructor(private cfg: FlagDetectorConfig = DEFAULT_FLAG_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const c = ctx.series.candles;
    const n = c.length;
    if (n < 60) return [];

    const poles = this.findPoles(ctx);
    if (poles.length === 0) return [];

    // Sort by impulse strength, take best
    poles.sort((a, b) => b.moveAtr - a.moveAtr);
    const pole = poles[0];

    const candidates: CandidatePattern[] = [];

    // After pole.endI, look for flag canvas
    for (let len = this.cfg.flagMinBars; len <= this.cfg.flagMaxBars; len++) {
      const startI = pole.endI + 1;
      const endI = startI + len;
      if (endI >= n) break;

      const cand = this.tryBuildFlagCandidate(ctx, pole, startI, endI);
      if (cand) candidates.push(cand);
    }

    if (candidates.length === 0) return [];

    // Return best candidate
    candidates.sort((a, b) => (b.metrics.totalScore ?? 0) - (a.metrics.totalScore ?? 0));
    return [candidates[0]];
  }

  private findPoles(ctx: TAContext): Pole[] {
    const c = ctx.series.candles;
    const atr = ctx.atr;
    const n = c.length;

    const lookback = this.cfg.poleLookbackBars;
    const poles: Pole[] = [];

    // Look for recent impulses
    const startEnd = Math.max(lookback + 10, n - 160);
    
    for (let endI = startEnd; endI < n - (this.cfg.flagMinBars + 2); endI++) {
      // Look for sharp impulse (limited bars)
      for (let bars = 3; bars <= this.cfg.poleMaxBars; bars++) {
        const startI = endI - bars;
        if (startI < 0) continue;

        const startPrice = c[startI].close;
        const endPrice = c[endI].close;

        const moveAbs = endPrice - startPrice;
        const dir = moveAbs >= 0 ? 'BULL' : 'BEAR';

        const movePct = startPrice !== 0 ? Math.abs(moveAbs / startPrice) : 0;
        const atrAvg = this.mean(atr.slice(Math.max(0, startI), endI + 1));
        const moveAtr = atrAvg > 0 ? Math.abs(moveAbs) / atrAvg : 0;

        if (moveAtr < this.cfg.poleMinMoveAtr) continue;
        if (movePct < this.cfg.poleMinMovePct) continue;

        poles.push({
          dir,
          startI,
          endI,
          startPrice,
          endPrice,
          moveAbs: Math.abs(moveAbs),
          movePct,
          moveAtr,
        });

        // For this endI, take shortest strong impulse
        break;
      }
    }

    return poles;
  }

  private tryBuildFlagCandidate(
    ctx: TAContext,
    pole: Pole,
    startI: number,
    endI: number
  ): CandidatePattern | null {
    const c = ctx.series.candles;
    const atrNow = ctx.atr[Math.min(ctx.atr.length - 1, endI)] || 0;
    const tol = Math.max(atrNow * this.cfg.toleranceAtrMult, c[endI].close * 0.001);

    // Measure retrace relative to pole
    const poleHigh = pole.dir === 'BULL' ? pole.endPrice : pole.startPrice;
    const poleLow = pole.dir === 'BULL' ? pole.startPrice : pole.endPrice;

    // Max adverse move during canvas
    const canvasSlice = c.slice(startI, endI + 1);
    const canvasHigh = Math.max(...canvasSlice.map(x => x.high));
    const canvasLow = Math.min(...canvasSlice.map(x => x.low));

    const retrace = pole.dir === 'BULL'
      ? (poleHigh - canvasLow) / (poleHigh - poleLow || 1)
      : (canvasHigh - poleLow) / (poleHigh - poleLow || 1);

    if (retrace > this.cfg.flagMaxRetrace) return null;

    // Canvas height constraint
    const height = canvasHigh - canvasLow;
    if (atrNow > 0 && height > this.cfg.flagMaxHeightAtr * atrNow) return null;

    // Build upper/lower lines from candle highs/lows
    const ptsHigh: Point[] = [];
    const ptsLow: Point[] = [];
    for (let i = startI; i <= endI; i++) {
      ptsHigh.push({ x: i, y: c[i].high });
      ptsLow.push({ x: i, y: c[i].low });
    }

    const upperFit = fitLineRobust(ptsHigh, tol, this.cfg.ransacIters);
    const lowerFit = fitLineRobust(ptsLow, tol, this.cfg.ransacIters);
    if (!upperFit || !lowerFit) return null;

    const upper = upperFit.line;
    const lower = lowerFit.line;

    // Check counter-slope (flag moves against impulse direction)
    const isCounterSlope = pole.dir === 'BULL'
      ? (upper.slope < -this.cfg.slopeFlatEps || Math.abs(upper.slope) <= this.cfg.slopeFlatEps)
      : (upper.slope > this.cfg.slopeFlatEps || Math.abs(upper.slope) <= this.cfg.slopeFlatEps);

    if (!isCounterSlope) {
      // Might be pennant
      return this.tryPennant(ctx, pole, startI, endI, tol);
    }

    // Check parallelism (flag = channel)
    const parallel = 1 - Math.min(1, Math.abs(upper.slope - lower.slope) / (Math.abs(upper.slope) + Math.abs(lower.slope) + 1e-9));
    if (parallel < 0.55) {
      return this.tryPennant(ctx, pole, startI, endI, tol);
    }

    const touchesUpper = this.countTouches(ptsHigh, upper, tol);
    const touchesLower = this.countTouches(ptsLow, lower, tol);
    if (touchesUpper < 2 || touchesLower < 2) return null;

    const durationBars = endI - startI;
    
    // Calculate score
    const score = this.calculateScore(pole, retrace, height, atrNow, parallel, touchesUpper, touchesLower, durationBars);

    const type: PatternType = pole.dir === 'BULL' ? 'FLAG_BULL' : 'FLAG_BEAR';
    const id = this.makeId(ctx.series.asset, '1D', type, pole.startI, endI, pole, upper, lower);
    const lastIdx = ctx.series.candles.length - 1;

    return {
      id,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: c[pole.startI].ts,
      endTs: c[endI].ts,
      startIdx: pole.startI,
      endIdx: endI,
      direction: pole.dir === 'BULL' ? 'BULLISH' : 'BEARISH',
      geometry: {
        pole: {
          x1: pole.startI, y1: pole.startPrice,
          x2: pole.endI, y2: pole.endPrice,
        },
        canvas: {
          startIndex: startI,
          endIndex: endI,
          upperLine: upper,
          lowerLine: lower,
        },
        lines: [
          // Pole
          { x1: pole.startI, y1: pole.startPrice, x2: pole.endI, y2: pole.endPrice },
          // Canvas lines
          { x1: startI, y1: yOnLine(upper, startI), x2: endI, y2: yOnLine(upper, endI) },
          { x1: startI, y1: yOnLine(lower, startI), x2: endI, y2: yOnLine(lower, endI) },
        ],
      },
      metrics: {
        geometryScore: parallel,
        touchScore: Math.min(1, (touchesUpper + touchesLower) / 8),
        symmetryScore: parallel,
        durationScore: Math.max(0, 1 - durationBars / this.cfg.flagMaxBars),
        noiseScore: 1 - Math.min(1, height / (atrNow * 3 || 1)),
        totalScore: score,
        poleMoveAtr: pole.moveAtr,
        poleMovePct: pole.movePct,
        retrace,
        canvasHeightAtr: atrNow > 0 ? height / atrNow : 0,
        parallel,
        touchesUpper,
        touchesLower,
        durationBars,
      },
      context: {
        regime: ctx.structure.regime,
        atr: atrNow,
        currentPrice: c[lastIdx].close,
        maContext: {
          priceVsMa50: ctx.features.priceVsMa50 ?? 0,
          priceVsMa200: ctx.features.priceVsMa200 ?? 0,
          ma50VsMa200: ctx.features.ma50VsMa200 ?? 0,
          maSlope50: ctx.maSlope50[lastIdx] ?? 0,
          maSlope200: ctx.maSlope200[lastIdx] ?? 0,
        },
      },
      trade: this.calculateTrade(pole, upper, lower, endI, c[lastIdx].close, atrNow),
    };
  }

  private tryPennant(
    ctx: TAContext,
    pole: Pole,
    startI: number,
    endI: number,
    tol: number
  ): CandidatePattern | null {
    const c = ctx.series.candles;

    const highs: Point[] = [];
    const lows: Point[] = [];
    for (let i = startI; i <= endI; i++) {
      highs.push({ x: i, y: c[i].high });
      lows.push({ x: i, y: c[i].low });
    }

    const upperFit = fitLineRobust(highs, tol, this.cfg.ransacIters);
    const lowerFit = fitLineRobust(lows, tol, this.cfg.ransacIters);
    if (!upperFit || !lowerFit) return null;

    const upper = upperFit.line;
    const lower = lowerFit.line;

    // Convergence requirement
    const hStart = yOnLine(upper, startI) - yOnLine(lower, startI);
    const hEnd = yOnLine(upper, endI) - yOnLine(lower, endI);
    if (hStart <= 0 || hEnd <= 0) return null;

    const convergence = (hStart - hEnd) / hStart;
    if (convergence < this.cfg.pennantConvergenceMin) return null;

    const touchesUpper = this.countTouches(highs, upper, tol);
    const touchesLower = this.countTouches(lows, lower, tol);
    if (touchesUpper < 2 || touchesLower < 2) return null;

    // Retrace check
    const poleHigh = pole.dir === 'BULL' ? pole.endPrice : pole.startPrice;
    const poleLow = pole.dir === 'BULL' ? pole.startPrice : pole.endPrice;
    const canvasSlice = c.slice(startI, endI + 1);
    const canvasHigh = Math.max(...canvasSlice.map(x => x.high));
    const canvasLow = Math.min(...canvasSlice.map(x => x.low));
    const retrace = pole.dir === 'BULL'
      ? (poleHigh - canvasLow) / (poleHigh - poleLow || 1)
      : (canvasHigh - poleLow) / (poleHigh - poleLow || 1);

    if (retrace > this.cfg.flagMaxRetrace) return null;

    const durationBars = endI - startI;
    const atrNow = ctx.atr[endI] || 0;
    
    const score = (
      this.clamp01(pole.moveAtr / 6) * 2.0 +
      (1 - this.clamp01(retrace)) * 1.5 +
      this.clamp01(convergence) * 1.0 +
      this.clamp01((touchesUpper + touchesLower) / 8) * 0.5
    ) / 5;

    // Pennant is just a small triangle after impulse
    // We'll mark it as FLAG_BULL or FLAG_BEAR with pennant geometry
    const type: PatternType = pole.dir === 'BULL' ? 'FLAG_BULL' : 'FLAG_BEAR';
    const id = this.makeId(ctx.series.asset, '1D', type + '_PENNANT', pole.startI, endI, pole, upper, lower);
    const lastIdx = ctx.series.candles.length - 1;

    return {
      id,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: c[pole.startI].ts,
      endTs: c[endI].ts,
      startIdx: pole.startI,
      endIdx: endI,
      direction: pole.dir === 'BULL' ? 'BULLISH' : 'BEARISH',
      geometry: {
        pole: {
          x1: pole.startI, y1: pole.startPrice,
          x2: pole.endI, y2: pole.endPrice,
        },
        pennant: {
          startIndex: startI,
          endIndex: endI,
          upperLine: upper,
          lowerLine: lower,
          convergence,
        },
        lines: [
          { x1: pole.startI, y1: pole.startPrice, x2: pole.endI, y2: pole.endPrice },
          { x1: startI, y1: yOnLine(upper, startI), x2: endI, y2: yOnLine(upper, endI) },
          { x1: startI, y1: yOnLine(lower, startI), x2: endI, y2: yOnLine(lower, endI) },
        ],
      },
      metrics: {
        geometryScore: convergence,
        touchScore: Math.min(1, (touchesUpper + touchesLower) / 8),
        symmetryScore: 0.7,
        durationScore: Math.max(0, 1 - durationBars / this.cfg.flagMaxBars),
        noiseScore: 0.8,
        totalScore: score,
        poleMoveAtr: pole.moveAtr,
        poleMovePct: pole.movePct,
        retrace,
        convergence,
        touchesUpper,
        touchesLower,
        durationBars,
      },
      context: {
        regime: ctx.structure.regime,
        atr: atrNow,
        currentPrice: c[lastIdx].close,
        maContext: {
          priceVsMa50: ctx.features.priceVsMa50 ?? 0,
          priceVsMa200: ctx.features.priceVsMa200 ?? 0,
          ma50VsMa200: ctx.features.ma50VsMa200 ?? 0,
          maSlope50: ctx.maSlope50[lastIdx] ?? 0,
          maSlope200: ctx.maSlope200[lastIdx] ?? 0,
        },
      },
      trade: this.calculateTrade(pole, upper, lower, endI, c[lastIdx].close, atrNow),
    };
  }

  private calculateScore(
    pole: Pole,
    retrace: number,
    height: number,
    atrNow: number,
    parallel: number,
    touchesUpper: number,
    touchesLower: number,
    durationBars: number
  ): number {
    return (
      this.clamp01(pole.moveAtr / 6) * 2.0 +
      (1 - this.clamp01(retrace)) * 1.5 +
      this.clamp01(parallel) * 1.0 +
      this.clamp01((touchesUpper + touchesLower) / 8) * 0.5 +
      this.clamp01((this.cfg.flagMaxBars - durationBars) / this.cfg.flagMaxBars) * 0.5
    ) / 5.5;
  }

  private calculateTrade(
    pole: Pole,
    upper: Line,
    lower: Line,
    endI: number,
    currentPrice: number,
    atr: number
  ): CandidatePattern['trade'] {
    const isLong = pole.dir === 'BULL';
    const breakoutLevel = isLong ? yOnLine(upper, endI) : yOnLine(lower, endI);
    
    const entry = isLong ? breakoutLevel * 1.002 : breakoutLevel * 0.998;
    const stop = isLong ? yOnLine(lower, endI) * 0.99 : yOnLine(upper, endI) * 1.01;
    
    // Target = pole height projected from breakout
    const target1 = isLong ? entry + pole.moveAbs : entry - pole.moveAbs;
    const target2 = isLong ? entry + pole.moveAbs * 1.618 : entry - pole.moveAbs * 1.618;
    
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target1 - entry);
    const riskReward = risk > 0 ? reward / risk : 0;
    
    return {
      entry: Math.round(entry * 100) / 100,
      stop: Math.round(stop * 100) / 100,
      target1: Math.round(target1 * 100) / 100,
      target2: Math.round(target2 * 100) / 100,
      riskReward: Math.round(riskReward * 100) / 100,
    };
  }

  private countTouches(points: Point[], line: Line, tol: number): number {
    let c = 0;
    for (const p of points) {
      if (distancePointLine(p, line) <= tol) c++;
    }
    return c;
  }

  private mean(a: number[]): number {
    if (a.length === 0) return 0;
    return a.reduce((s, x) => s + x, 0) / a.length;
  }

  private clamp01(x: number): number {
    return Math.max(0, Math.min(1, x));
  }

  private makeId(
    asset: string,
    tf: string,
    type: string,
    startI: number,
    endI: number,
    pole: Pole,
    upper: Line,
    lower: Line
  ): string {
    const round = (x: number, d = 6) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
    const payload = JSON.stringify({
      asset, tf, type, startI, endI,
      pole: { s: pole.startI, e: pole.endI, dir: pole.dir, m: round(pole.moveAtr, 2) },
      upper: { slope: round(upper.slope, 8), intercept: round(upper.intercept, 6) },
      lower: { slope: round(lower.slope, 8), intercept: round(lower.intercept, 6) },
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }
}
