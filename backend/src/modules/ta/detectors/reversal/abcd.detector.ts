/**
 * AB=CD Harmonic Detector
 * 
 * Phase 8.6: Harmonics Foundation
 * 
 * Detects:
 * - HARMONIC_ABCD_BULL (bullish AB=CD)
 * - HARMONIC_ABCD_BEAR (bearish AB=CD)
 * 
 * Uses 4 pivots with Fibonacci ratio validation:
 * - |CD| ≈ |AB| (length equality)
 * - BC retracement ≈ 0.618 of AB
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, Pivot, TAContext, PatternType } from '../../domain/types.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type ABCDConfig = {
  lookbackPivots: number;      // e.g. 30
  minLegAtr: number;           // e.g. 1.8 (|AB| >= 1.8*ATR)
  abcdLenTol: number;          // e.g. 0.18 (|CD| within 18% of |AB|)
  bcRetraceTarget: number;     // 0.618
  bcRetraceTol: number;        // e.g. 0.20 (±20%)
  minBars: number;             // e.g. 10
  maxBars: number;             // e.g. 220
  entryBufferAtrMult: number;  // e.g. 0.10
  stopBufferAtrMult: number;   // e.g. 0.20
  minRR: number;               // e.g. 0.6
};

export const DEFAULT_ABCD_CONFIG: ABCDConfig = {
  lookbackPivots: 30,
  minLegAtr: 1.8,
  abcdLenTol: 0.18,
  bcRetraceTarget: 0.618,
  bcRetraceTol: 0.20,
  minBars: 10,
  maxBars: 220,
  entryBufferAtrMult: 0.10,
  stopBufferAtrMult: 0.20,
  minRR: 0.6,
};

type P4 = { A: Pivot; B: Pivot; C: Pivot; D: Pivot };

// ═══════════════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════════════

export class ABCDDetector implements Detector {
  public readonly id = 'abcd.detector.v1';
  public readonly name = 'AB=CD Harmonic Detector';
  public readonly types: PatternType[] = ['HARMONIC_ABCD_BULL', 'HARMONIC_ABCD_BEAR'];
  public readonly version = '1.0.0';

  constructor(private cfg: ABCDConfig = DEFAULT_ABCD_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const pivots = ctx.pivots;
    if (!pivots || pivots.length < 9) return [];

    const candles = ctx.series.candles;
    const n = candles.length;
    const atr = ctx.atr[n - 1] || 0;
    if (atr <= 0) return [];

    const recent = pivots.slice(-this.cfg.lookbackPivots);
    const out: CandidatePattern[] = [];

    // Scan 4-pivot windows
    for (let i = 0; i <= recent.length - 4; i++) {
      const A = recent[i];
      const B = recent[i + 1];
      const C = recent[i + 2];
      const D = recent[i + 3];

      const bars = D.i - A.i;
      if (bars < this.cfg.minBars || bars > this.cfg.maxBars) continue;

      const p4: P4 = { A, B, C, D };

      // Try bullish ABCD
      const bull = this.tryBuild(ctx, p4, atr, 'BULL');
      if (bull) out.push(bull);

      // Try bearish ABCD
      const bear = this.tryBuild(ctx, p4, atr, 'BEAR');
      if (bear) out.push(bear);
    }

    return out;
  }

  private tryBuild(
    ctx: TAContext,
    p: P4,
    atr: number,
    dir: 'BULL' | 'BEAR'
  ): CandidatePattern | null {
    const { A, B, C, D } = p;

    // Calculate leg directions
    const AB = B.price - A.price;
    const BC = C.price - B.price;
    const CD = D.price - C.price;

    // Bullish ABCD: AB down, BC up, CD down
    // Bearish ABCD: AB up, BC down, CD up
    if (dir === 'BULL') {
      if (!(AB < 0 && BC > 0 && CD < 0)) return null;
    } else {
      if (!(AB > 0 && BC < 0 && CD > 0)) return null;
    }

    const abLen = Math.abs(AB);
    const cdLen = Math.abs(CD);
    if (abLen < this.cfg.minLegAtr * atr) return null;

    // |CD| ≈ |AB|
    const lenRatio = cdLen / abLen;
    if (Math.abs(lenRatio - 1) > this.cfg.abcdLenTol) return null;

    // BC retracement of AB
    const bcRetr = Math.abs(BC) / abLen;
    if (Math.abs(bcRetr - this.cfg.bcRetraceTarget) > this.cfg.bcRetraceTol) return null;

    // Trade plan: reversal from D
    const bufferE = this.cfg.entryBufferAtrMult * atr;
    const bufferS = this.cfg.stopBufferAtrMult * atr;

    let entry: number, stop: number, target: number;
    let direction: 'BULLISH' | 'BEARISH';

    if (dir === 'BULL') {
      direction = 'BULLISH';
      entry = D.price + bufferE;
      stop = D.price - bufferS;
      target = Math.max(C.price, entry + 1.8 * (entry - stop));
    } else {
      direction = 'BEARISH';
      entry = D.price - bufferE;
      stop = D.price + bufferS;
      target = Math.min(C.price, entry - 1.8 * (stop - entry));
    }

    const rr = this.riskReward(entry, stop, target, direction);
    if (rr < this.cfg.minRR) return null;

    const type: PatternType = dir === 'BULL' ? 'HARMONIC_ABCD_BULL' : 'HARMONIC_ABCD_BEAR';
    const id = this.makeId(ctx.series.asset, '1D', type, A.i, D.i, A.price, B.price, C.price, D.price);

    return {
      id,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: ctx.series.candles[A.i]?.ts ?? ctx.series.candles[0].ts,
      endTs: ctx.series.candles[D.i]?.ts ?? ctx.series.candles[ctx.series.candles.length - 1].ts,
      startIdx: A.i,
      endIdx: D.i,
      direction,
      geometry: {
        pivots: [A, B, C, D],
        points: {
          A: { x: A.i, y: A.price },
          B: { x: B.i, y: B.price },
          C: { x: C.i, y: C.price },
          D: { x: D.i, y: D.price },
        },
        ratios: {
          lenRatio,
          bcRetrace: bcRetr,
        },
      },
      metrics: {
        geometryScore: 1 - Math.abs(lenRatio - 1) / this.cfg.abcdLenTol,
        touchScore: 0.8,
        symmetryScore: 1 - Math.abs(bcRetr - this.cfg.bcRetraceTarget) / this.cfg.bcRetraceTol,
        durationScore: Math.min(1, (D.i - A.i) / 100),
        noiseScore: 0.8,
        totalScore: 0.7,
        abLen,
        cdLen,
        lenRatio,
        bcRetrace: bcRetr,
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
    asset: string, tf: string, type: string, s: number, e: number,
    a: number, b: number, c: number, d: number
  ): string {
    const payload = JSON.stringify({
      asset, tf, type, s, e,
      a: this.round(a), b: this.round(b), c: this.round(c), d: this.round(d),
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  private round(x: number): number {
    return Math.round(x * 1e6) / 1e6;
  }
}
