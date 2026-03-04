/**
 * Head & Shoulders Detector
 * 
 * Phase 8.2: Reversal Patterns
 * 
 * Detects:
 * - HEAD_SHOULDERS (bearish reversal): HIGH-LOW-HIGH-LOW-HIGH
 * - INVERTED_HEAD_SHOULDERS (bullish reversal): LOW-HIGH-LOW-HIGH-LOW
 * 
 * Uses 5 pivots with neckline fitting and symmetry validation.
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, Pivot, TAContext, PatternType } from '../../domain/types.js';
import { fitLineLS, yOnLine, Line } from '../../core/fit.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type HSDetectorConfig = {
  lookbackPivots: number;          // e.g. 32
  shoulderTolAtrMult: number;      // e.g. 1.0 (LS~RS within 1*ATR)
  necklineTolAtrMult: number;      // e.g. 0.7 (L1/L2 closeness check)
  minHeightAtr: number;            // e.g. 2.0
  minBarsLS2RS: number;            // e.g. 10
  maxBarsLS2RS: number;            // e.g. 220
  maxAsymmetry: number;            // e.g. 0.70
  entryBufferAtrMult: number;      // e.g. 0.15
  minRR: number;                   // e.g. 0.6
};

export const DEFAULT_HS_CONFIG: HSDetectorConfig = {
  lookbackPivots: 32,
  shoulderTolAtrMult: 1.0,
  necklineTolAtrMult: 0.7,
  minHeightAtr: 2.0,
  minBarsLS2RS: 10,
  maxBarsLS2RS: 220,
  maxAsymmetry: 0.70,
  entryBufferAtrMult: 0.15,
  minRR: 0.6,
};

type HS5 = {
  type: 'HNS' | 'IHNS';
  s1: Pivot; // LS
  n1: Pivot; // neckline pivot 1
  h: Pivot;  // head
  n2: Pivot; // neckline pivot 2
  s2: Pivot; // RS
};

// ═══════════════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════════════

export class HSDetector implements Detector {
  public readonly id = 'hs.detector.v1';
  public readonly name = 'Head & Shoulders Detector';
  public readonly types: PatternType[] = ['HNS', 'IHNS'];
  public readonly version = '1.0.0';

  constructor(private cfg: HSDetectorConfig = DEFAULT_HS_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const pivots = ctx.pivots;
    if (!pivots || pivots.length < 9) return [];

    const recent = pivots.slice(-this.cfg.lookbackPivots);
    const atrNow = ctx.atr[ctx.atr.length - 1] || 0;
    if (atrNow <= 0) return [];

    const out: CandidatePattern[] = [];

    // Scan 5-pivot windows
    for (let i = 0; i <= recent.length - 5; i++) {
      const p1 = recent[i];
      const p2 = recent[i + 1];
      const p3 = recent[i + 2];
      const p4 = recent[i + 3];
      const p5 = recent[i + 4];

      // H&S: HIGH LOW HIGH LOW HIGH
      if (p1.type === 'HIGH' && p2.type === 'LOW' && p3.type === 'HIGH' && p4.type === 'LOW' && p5.type === 'HIGH') {
        const hs: HS5 = { type: 'HNS', s1: p1, n1: p2, h: p3, n2: p4, s2: p5 };
        const cand = this.tryBuild(ctx, hs, atrNow);
        if (cand) out.push(cand);
      }

      // Inverted H&S: LOW HIGH LOW HIGH LOW
      if (p1.type === 'LOW' && p2.type === 'HIGH' && p3.type === 'LOW' && p4.type === 'HIGH' && p5.type === 'LOW') {
        const ihs: HS5 = { type: 'IHNS', s1: p1, n1: p2, h: p3, n2: p4, s2: p5 };
        const cand = this.tryBuild(ctx, ihs, atrNow);
        if (cand) out.push(cand);
      }
    }

    return out;
  }

  private tryBuild(ctx: TAContext, x: HS5, atr: number): CandidatePattern | null {
    const { s1, n1, h, n2, s2 } = x;

    // Time span constraint
    const bars = s2.i - s1.i;
    if (bars < this.cfg.minBarsLS2RS) return null;
    if (bars > this.cfg.maxBarsLS2RS) return null;

    // 1) Head prominence
    if (x.type === 'HNS') {
      if (!(h.price > s1.price && h.price > s2.price)) return null;
    } else {
      if (!(h.price < s1.price && h.price < s2.price)) return null;
    }

    // 2) Shoulders similarity
    const shoulderTol = this.cfg.shoulderTolAtrMult * atr;
    if (Math.abs(s1.price - s2.price) > shoulderTol) return null;

    // 3) Neckline line through n1, n2
    const neck = fitLineLS([
      { x: n1.i, y: n1.price },
      { x: n2.i, y: n2.price },
    ]);
    if (!neck) return null;

    // Neckline pivots not too far apart vertically
    const neckTol = this.cfg.necklineTolAtrMult * atr;
    if (Math.abs(n1.price - n2.price) > 3 * neckTol) {
      return null;
    }

    // 4) Height (measured move)
    const neckAtHead = yOnLine(neck, h.i);
    const height = x.type === 'HNS' 
      ? (h.price - neckAtHead) 
      : (neckAtHead - h.price);
    if (height < this.cfg.minHeightAtr * atr) return null;

    // 5) Symmetry (LS->Head vs Head->RS)
    const t1 = h.i - s1.i;
    const t2 = s2.i - h.i;
    const asym = Math.abs(t1 - t2) / Math.max(1, t1 + t2);
    if (asym > this.cfg.maxAsymmetry) return null;

    // 6) Trade plan
    const buffer = this.cfg.entryBufferAtrMult * atr;
    let direction: 'BEARISH' | 'BULLISH';
    let entry: number;
    let stop: number;
    let target: number;

    if (x.type === 'HNS') {
      direction = 'BEARISH';
      const neckAtRS = yOnLine(neck, s2.i);
      entry = neckAtRS - buffer;
      stop = Math.max(s1.price, s2.price) + buffer;
      target = entry - height;
    } else {
      direction = 'BULLISH';
      const neckAtRS = yOnLine(neck, s2.i);
      entry = neckAtRS + buffer;
      stop = Math.min(s1.price, s2.price) - buffer;
      target = entry + height;
    }

    const rr = this.riskReward(entry, stop, target, direction);
    if (rr < this.cfg.minRR) return null;

    const startIdx = s1.i;
    const endIdx = s2.i;

    const id = this.makeId(ctx.series.asset, '1D', x.type, startIdx, endIdx, s1.price, h.price, s2.price, n1.price, n2.price);

    return {
      id,
      type: x.type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: ctx.series.candles[startIdx]?.ts ?? ctx.series.candles[0].ts,
      endTs: ctx.series.candles[endIdx]?.ts ?? ctx.series.candles[ctx.series.candles.length - 1].ts,
      startIdx,
      endIdx,
      direction,
      geometry: {
        pivots: [s1, n1, h, n2, s2],
        points: {
          LS: { x: s1.i, y: s1.price },
          N1: { x: n1.i, y: n1.price },
          H: { x: h.i, y: h.price },
          N2: { x: n2.i, y: n2.price },
          RS: { x: s2.i, y: s2.price },
        },
        neckline: {
          line: neck as Line,
          x1: n1.i,
          y1: n1.price,
          x2: n2.i,
          y2: n2.price,
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
        durationScore: Math.min(1, bars / 100),
        noiseScore: 0.8,
        totalScore: 0.7,
        height,
        heightAtr: atr > 0 ? height / atr : 0,
        shoulderDelta: Math.abs(s1.price - s2.price),
        shoulderDeltaAtr: atr > 0 ? Math.abs(s1.price - s2.price) / atr : 0,
        necklineSlope: neck.slope,
        asymmetry: asym,
        barsLS2RS: bars,
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

  private makeId(
    asset: string, tf: string, type: string, s: number, e: number,
    ls: number, head: number, rs: number, n1: number, n2: number
  ): string {
    const payload = JSON.stringify({
      asset, tf, type, s, e,
      ls: this.round(ls), head: this.round(head), rs: this.round(rs),
      n1: this.round(n1), n2: this.round(n2),
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  private round(x: number): number {
    return Math.round(x * 1e6) / 1e6;
  }
}
