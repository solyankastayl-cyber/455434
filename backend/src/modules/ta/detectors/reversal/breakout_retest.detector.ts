/**
 * Breakout / Retest Detector
 * 
 * Phase 8.3: Level-Based Patterns
 * 
 * Detects:
 * - LEVEL_BREAKOUT (BREAKOUT_RETEST_BULL) - resistance break + retest as support
 * - LEVEL_RETEST (BREAKOUT_RETEST_BEAR) - support break + retest as resistance
 * 
 * Uses S/R levels from levels engine with breakout confirmation and retest validation.
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, TAContext, LevelZone, PatternType, Candle } from '../../domain/types.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type BreakoutRetestConfig = {
  minLevelStrength: number;       // e.g. 0.55
  maxLevels: number;              // e.g. 8
  breakoutConfirmBars: number;    // e.g. 2
  breakoutMinAtr: number;         // e.g. 0.6
  retestMaxBars: number;          // e.g. 18
  retestTouchTolAtrMult: number;  // e.g. 0.6
  retestMinReactionAtr: number;   // e.g. 0.5
  entryBufferAtrMult: number;     // e.g. 0.10
  stopBufferAtrMult: number;      // e.g. 0.20
  minRR: number;                  // e.g. 0.7
};

export const DEFAULT_BREAKOUT_CONFIG: BreakoutRetestConfig = {
  minLevelStrength: 0.55,
  maxLevels: 8,
  breakoutConfirmBars: 2,
  breakoutMinAtr: 0.6,
  retestMaxBars: 18,
  retestTouchTolAtrMult: 0.6,
  retestMinReactionAtr: 0.5,
  entryBufferAtrMult: 0.10,
  stopBufferAtrMult: 0.20,
  minRR: 0.7,
};

// ═══════════════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════════════

export class BreakoutRetestDetector implements Detector {
  public readonly id = 'breakout_retest.detector.v1';
  public readonly name = 'Breakout/Retest Detector';
  public readonly types: PatternType[] = ['LEVEL_BREAKOUT', 'LEVEL_RETEST'];
  public readonly version = '1.0.0';

  constructor(private cfg: BreakoutRetestConfig = DEFAULT_BREAKOUT_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const zones = (ctx.levels ?? []).slice()
      .filter(z => (z.strength ?? 0) >= this.cfg.minLevelStrength)
      .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
      .slice(0, this.cfg.maxLevels);

    if (zones.length === 0) return [];

    const candles = ctx.series.candles;
    const n = candles.length;
    if (n < 80) return [];

    const atr = ctx.atr[n - 1] || 0;
    if (atr <= 0) return [];

    const out: CandidatePattern[] = [];

    for (const z of zones) {
      const bull = this.tryBull(ctx, z, atr);
      if (bull) out.push(bull);

      const bear = this.tryBear(ctx, z, atr);
      if (bear) out.push(bear);
    }

    return out;
  }

  private tryBull(ctx: TAContext, z: LevelZone, atr: number): CandidatePattern | null {
    const candles = ctx.series.candles;
    const n = candles.length;

    const { low, high, mid } = this.zoneBands(z);
    const tol = this.cfg.retestTouchTolAtrMult * atr;
    const K = this.cfg.breakoutConfirmBars;
    const minBeyond = this.cfg.breakoutMinAtr * atr;

    // 1) Find breakout: close above zoneHigh by minAtr
    const breakoutI = this.findLastIndexFromEnd(candles, 200, (i) => {
      if (i + K >= n) return false;
      for (let k = 0; k < K; k++) {
        if (candles[i + k].close <= high + minBeyond) return false;
      }
      const pre = candles[Math.max(0, i - 1)].close;
      if (pre > high) return false;
      return true;
    });

    if (breakoutI == null) return null;

    // 2) Retest within window
    const afterBreak = breakoutI + K;
    const retestEnd = Math.min(n - 1, afterBreak + this.cfg.retestMaxBars);

    let touchI: number | null = null;
    for (let i = afterBreak; i <= retestEnd; i++) {
      const c = candles[i];
      const touched = c.low <= high + tol && c.high >= low - tol;
      const notFailed = c.close >= low - tol;
      if (touched && notFailed) { touchI = i; break; }
    }
    if (touchI == null) return null;

    // 3) Reaction bounce
    const reactNeed = this.cfg.retestMinReactionAtr * atr;
    const reactWindowEnd = Math.min(n - 1, touchI + 5);
    const maxAfter = this.maxHigh(candles, touchI, reactWindowEnd);
    const reacted = (maxAfter - candles[touchI].close) >= reactNeed;
    if (!reacted) return null;

    // 4) Trade plan
    const bufferE = this.cfg.entryBufferAtrMult * atr;
    const bufferS = this.cfg.stopBufferAtrMult * atr;

    const entry = maxAfter + bufferE;
    const stop = low - bufferS;
    const target = this.pickBullTarget(ctx, entry, atr) ?? (entry + 2.0 * (entry - stop));

    const rr = (entry - stop) > 0 ? (target - entry) / (entry - stop) : 0;
    if (rr < this.cfg.minRR) return null;

    const id = this.makeId(ctx.series.asset, '1D', 'LEVEL_BREAKOUT', z.id ?? String(mid), breakoutI, touchI);

    return {
      id,
      type: 'LEVEL_BREAKOUT',
      tf: '1D',
      asset: ctx.series.asset,
      startTs: candles[Math.max(0, breakoutI - 5)]?.ts ?? candles[0].ts,
      endTs: candles[touchI]?.ts ?? candles[n - 1].ts,
      startIdx: Math.max(0, breakoutI - 5),
      endIdx: touchI,
      direction: 'BULLISH',
      geometry: {
        zone: { low, high, mid, strength: z.strength ?? 0 },
        breakout: { index: breakoutI, price: candles[breakoutI].close },
        retest: { index: touchI, price: candles[touchI].close },
      },
      metrics: {
        geometryScore: 0.7,
        touchScore: z.touches / 5,
        symmetryScore: 0.8,
        durationScore: 0.7,
        noiseScore: 0.8,
        totalScore: 0.7,
        zoneStrength: z.strength ?? 0,
        breakoutConfirmBars: K,
        breakoutBeyondAtr: (candles[breakoutI + K - 1].close - high) / atr,
        retestBarsAfter: touchI - afterBreak,
        reactionAtr: (maxAfter - candles[touchI].close) / atr,
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

  private tryBear(ctx: TAContext, z: LevelZone, atr: number): CandidatePattern | null {
    const candles = ctx.series.candles;
    const n = candles.length;

    const { low, high, mid } = this.zoneBands(z);
    const tol = this.cfg.retestTouchTolAtrMult * atr;
    const K = this.cfg.breakoutConfirmBars;
    const minBeyond = this.cfg.breakoutMinAtr * atr;

    // 1) Breakdown: close below zoneLow
    const breakoutI = this.findLastIndexFromEnd(candles, 200, (i) => {
      if (i + K >= n) return false;
      for (let k = 0; k < K; k++) {
        if (candles[i + k].close >= low - minBeyond) return false;
      }
      const pre = candles[Math.max(0, i - 1)].close;
      if (pre < low) return false;
      return true;
    });
    if (breakoutI == null) return null;

    const afterBreak = breakoutI + K;
    const retestEnd = Math.min(n - 1, afterBreak + this.cfg.retestMaxBars);

    // 2) Retest
    let touchI: number | null = null;
    for (let i = afterBreak; i <= retestEnd; i++) {
      const c = candles[i];
      const touched = c.high >= low - tol && c.low <= high + tol;
      const notReclaimed = c.close <= high + tol;
      if (touched && notReclaimed) { touchI = i; break; }
    }
    if (touchI == null) return null;

    // 3) Reaction
    const reactNeed = this.cfg.retestMinReactionAtr * atr;
    const reactWindowEnd = Math.min(n - 1, touchI + 5);
    const minAfter = this.minLow(candles, touchI, reactWindowEnd);
    const reacted = (candles[touchI].close - minAfter) >= reactNeed;
    if (!reacted) return null;

    // 4) Trade plan
    const bufferE = this.cfg.entryBufferAtrMult * atr;
    const bufferS = this.cfg.stopBufferAtrMult * atr;

    const entry = minAfter - bufferE;
    const stop = high + bufferS;
    const target = this.pickBearTarget(ctx, entry, atr) ?? (entry - 2.0 * (stop - entry));
    const rr = (stop - entry) > 0 ? (entry - target) / (stop - entry) : 0;
    if (rr < this.cfg.minRR) return null;

    const id = this.makeId(ctx.series.asset, '1D', 'LEVEL_RETEST', z.id ?? String(mid), breakoutI, touchI);

    return {
      id,
      type: 'LEVEL_RETEST',
      tf: '1D',
      asset: ctx.series.asset,
      startTs: candles[Math.max(0, breakoutI - 5)]?.ts ?? candles[0].ts,
      endTs: candles[touchI]?.ts ?? candles[n - 1].ts,
      startIdx: Math.max(0, breakoutI - 5),
      endIdx: touchI,
      direction: 'BEARISH',
      geometry: {
        zone: { low, high, mid, strength: z.strength ?? 0 },
        breakdown: { index: breakoutI, price: candles[breakoutI].close },
        retest: { index: touchI, price: candles[touchI].close },
      },
      metrics: {
        geometryScore: 0.7,
        touchScore: z.touches / 5,
        symmetryScore: 0.8,
        durationScore: 0.7,
        noiseScore: 0.8,
        totalScore: 0.7,
        zoneStrength: z.strength ?? 0,
        breakoutConfirmBars: K,
        breakoutBeyondAtr: (low - candles[breakoutI + K - 1].close) / atr,
        retestBarsAfter: touchI - afterBreak,
        reactionAtr: (candles[touchI].close - minAfter) / atr,
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

  private zoneBands(z: LevelZone): { low: number; high: number; mid: number } {
    const low = z.price - (z.band ?? 0);
    const high = z.price + (z.band ?? 0);
    const mid = z.price;
    return { low, high, mid };
  }

  private findLastIndexFromEnd(candles: Candle[], maxLookback: number, pred: (i: number) => boolean): number | null {
    const n = candles.length;
    const start = Math.max(0, n - maxLookback);
    for (let i = n - 1; i >= start; i--) {
      if (pred(i)) return i;
    }
    return null;
  }

  private maxHigh(candles: Candle[], a: number, b: number): number {
    let m = -Infinity;
    for (let i = a; i <= b; i++) m = Math.max(m, candles[i].high);
    return m;
  }

  private minLow(candles: Candle[], a: number, b: number): number {
    let m = Infinity;
    for (let i = a; i <= b; i++) m = Math.min(m, candles[i].low);
    return m;
  }

  private pickBullTarget(ctx: TAContext, entry: number, atr: number): number | null {
    const zones = (ctx.levels ?? []).slice().sort((a, b) => a.price - b.price);
    for (const z of zones) {
      const mid = z.price;
      if (mid > entry + 0.5 * atr && (z.strength ?? 0) >= 0.55) return mid;
    }
    return null;
  }

  private pickBearTarget(ctx: TAContext, entry: number, atr: number): number | null {
    const zones = (ctx.levels ?? []).slice().sort((a, b) => b.price - a.price);
    for (const z of zones) {
      const mid = z.price;
      if (mid < entry - 0.5 * atr && (z.strength ?? 0) >= 0.55) return mid;
    }
    return null;
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

  private makeId(asset: string, tf: string, type: string, zoneKey: string, breakoutI: number, retestI: number): string {
    const payload = JSON.stringify({ asset, tf, type, zoneKey, breakoutI, retestI });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }
}
