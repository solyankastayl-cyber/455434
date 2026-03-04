/**
 * Candle Pack Detector
 * 
 * Phase 8.4: Candlestick Patterns
 * 
 * Detects:
 * - CANDLE_ENGULF_BULL / CANDLE_ENGULF_BEAR (Engulfing)
 * - CANDLE_HAMMER / CANDLE_SHOOTING_STAR (Pin Bars)
 * - CANDLE_INSIDE (Inside Bar / NR4)
 * 
 * All patterns include trade plan for outcome evaluation.
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, TAContext, Candle, PatternType } from '../../domain/types.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type CandlePackConfig = {
  lookbackBars: number;            // e.g. 80
  atrMultBodyMin: number;          // e.g. 0.25 (body >= 0.25*ATR for engulf)
  atrMultWickMin: number;          // e.g. 0.80 (wick >= 0.8*ATR for pinbar)
  insideBarMaxRangePct: number;    // e.g. 0.95 (range today <= 95% of prev range)
  entryBufferAtrMult: number;      // e.g. 0.10
  stopBufferAtrMult: number;       // e.g. 0.15
  minRR: number;                   // e.g. 0.6
  requireContextConfluence: boolean; // e.g. false
};

export const DEFAULT_CANDLE_CONFIG: CandlePackConfig = {
  lookbackBars: 80,
  atrMultBodyMin: 0.25,
  atrMultWickMin: 0.80,
  insideBarMaxRangePct: 0.95,
  entryBufferAtrMult: 0.10,
  stopBufferAtrMult: 0.15,
  minRR: 0.6,
  requireContextConfluence: false,
};

// ═══════════════════════════════════════════════════════════════
// Detector
// ═══════════════════════════════════════════════════════════════

export class CandlePackDetector implements Detector {
  public readonly id = 'candle_pack.detector.v1';
  public readonly name = 'Candle Pack Detector';
  public readonly types: PatternType[] = [
    'CANDLE_ENGULF_BULL',
    'CANDLE_ENGULF_BEAR',
    'CANDLE_HAMMER',
    'CANDLE_SHOOTING_STAR',
    'CANDLE_INSIDE',
  ];
  public readonly version = '1.0.0';

  constructor(private cfg: CandlePackConfig = DEFAULT_CANDLE_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const candles = ctx.series.candles;
    const n = candles.length;
    if (n < 10) return [];

    const atr = ctx.atr[n - 1] || 0;
    if (atr <= 0) return [];

    const out: CandidatePattern[] = [];
    const start = Math.max(2, n - this.cfg.lookbackBars);

    for (let i = start; i < n; i++) {
      const prev = candles[i - 1];
      const cur = candles[i];

      // Context confluence gate (optional)
      if (this.cfg.requireContextConfluence) {
        if (!this.isNearAnyLevel(ctx, cur.close, atr)) continue;
      }

      // Engulfing patterns
      const bullEng = this.isBullEngulf(prev, cur, atr);
      if (bullEng) {
        const cand = this.buildCandleTrade(ctx, i, 'CANDLE_ENGULF_BULL', 'BULLISH', atr, bullEng);
        if (cand) out.push(cand);
      }

      const bearEng = this.isBearEngulf(prev, cur, atr);
      if (bearEng) {
        const cand = this.buildCandleTrade(ctx, i, 'CANDLE_ENGULF_BEAR', 'BEARISH', atr, bearEng);
        if (cand) out.push(cand);
      }

      // Pin bars
      const hammer = this.isHammer(cur, atr);
      if (hammer) {
        const cand = this.buildCandleTrade(ctx, i, 'CANDLE_HAMMER', 'BULLISH', atr, hammer);
        if (cand) out.push(cand);
      }

      const star = this.isShootingStar(cur, atr);
      if (star) {
        const cand = this.buildCandleTrade(ctx, i, 'CANDLE_SHOOTING_STAR', 'BEARISH', atr, star);
        if (cand) out.push(cand);
      }

      // Inside bar
      if (this.isInsideBar(prev, cur)) {
        const dir = this.pickInsideBarDirection(ctx);
        const cand = this.buildInsideBarTrade(ctx, i, dir, atr);
        if (cand) out.push(cand);
      }
    }

    return out;
  }

  // ═══════════════════════════════════════════════════════════════
  // Pattern Detection
  // ═══════════════════════════════════════════════════════════════

  private isBullEngulf(prev: Candle, cur: Candle, atr: number): { strength: number; bodyAtr: number } | null {
    const prevBear = prev.close < prev.open;
    const curBull = cur.close > cur.open;
    if (!prevBear || !curBull) return null;

    const prevBodyLow = Math.min(prev.open, prev.close);
    const prevBodyHigh = Math.max(prev.open, prev.close);
    const curBodyLow = Math.min(cur.open, cur.close);
    const curBodyHigh = Math.max(cur.open, cur.close);

    const engulf = curBodyLow <= prevBodyLow && curBodyHigh >= prevBodyHigh;
    if (!engulf) return null;

    const body = Math.abs(cur.close - cur.open);
    const bodyAtr = body / atr;
    if (bodyAtr < this.cfg.atrMultBodyMin) return null;

    const strength = this.clamp01((bodyAtr - this.cfg.atrMultBodyMin) / 1.0);
    return { strength, bodyAtr };
  }

  private isBearEngulf(prev: Candle, cur: Candle, atr: number): { strength: number; bodyAtr: number } | null {
    const prevBull = prev.close > prev.open;
    const curBear = cur.close < cur.open;
    if (!prevBull || !curBear) return null;

    const prevBodyLow = Math.min(prev.open, prev.close);
    const prevBodyHigh = Math.max(prev.open, prev.close);
    const curBodyLow = Math.min(cur.open, cur.close);
    const curBodyHigh = Math.max(cur.open, cur.close);

    const engulf = curBodyLow <= prevBodyLow && curBodyHigh >= prevBodyHigh;
    if (!engulf) return null;

    const body = Math.abs(cur.close - cur.open);
    const bodyAtr = body / atr;
    if (bodyAtr < this.cfg.atrMultBodyMin) return null;

    const strength = this.clamp01((bodyAtr - this.cfg.atrMultBodyMin) / 1.0);
    return { strength, bodyAtr };
  }

  private isHammer(c: Candle, atr: number): { wickAtr: number; bodyPct: number } | null {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range <= 0) return null;

    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);

    const wickAtr = lowerWick / atr;
    const bodyPct = body / range;

    if (wickAtr < this.cfg.atrMultWickMin) return null;
    if (bodyPct > 0.35) return null;
    if (upperWick > lowerWick * 0.6) return null;

    return { wickAtr, bodyPct };
  }

  private isShootingStar(c: Candle, atr: number): { wickAtr: number; bodyPct: number } | null {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range <= 0) return null;

    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    const wickAtr = upperWick / atr;
    const bodyPct = body / range;

    if (wickAtr < this.cfg.atrMultWickMin) return null;
    if (bodyPct > 0.35) return null;
    if (lowerWick > upperWick * 0.6) return null;

    return { wickAtr, bodyPct };
  }

  private isInsideBar(prev: Candle, cur: Candle): boolean {
    const inside = cur.high <= prev.high && cur.low >= prev.low;
    if (!inside) return false;

    const prevRange = prev.high - prev.low;
    const curRange = cur.high - cur.low;
    if (prevRange <= 0) return false;

    return (curRange / prevRange) <= this.cfg.insideBarMaxRangePct;
  }

  // ═══════════════════════════════════════════════════════════════
  // Trade Builders
  // ═══════════════════════════════════════════════════════════════

  private buildCandleTrade(
    ctx: TAContext,
    i: number,
    type: PatternType,
    direction: 'BULLISH' | 'BEARISH',
    atr: number,
    extra: Record<string, number>
  ): CandidatePattern | null {
    const candles = ctx.series.candles;
    const c = candles[i];

    const bufferE = this.cfg.entryBufferAtrMult * atr;
    const bufferS = this.cfg.stopBufferAtrMult * atr;

    let entry: number, stop: number, target: number;

    if (direction === 'BULLISH') {
      entry = c.high + bufferE;
      stop = c.low - bufferS;
      target = entry + 2.0 * (entry - stop);
    } else {
      entry = c.low - bufferE;
      stop = c.high + bufferS;
      target = entry - 2.0 * (stop - entry);
    }

    const rr = this.riskReward(entry, stop, target, direction);
    if (rr < this.cfg.minRR) return null;

    const id = this.makeId(ctx.series.asset, '1D', type, i, c.open, c.high, c.low, c.close);

    return {
      id,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: c.ts,
      endTs: c.ts,
      startIdx: i,
      endIdx: i,
      direction,
      geometry: {
        candleIndex: i,
        candle: { open: c.open, high: c.high, low: c.low, close: c.close },
      },
      metrics: {
        geometryScore: extra.strength ?? 0.7,
        touchScore: 0.8,
        symmetryScore: 0.8,
        durationScore: 0.5,
        noiseScore: 0.8,
        totalScore: 0.6,
        rr,
        ...extra,
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

  private buildInsideBarTrade(
    ctx: TAContext,
    i: number,
    direction: 'BULLISH' | 'BEARISH',
    atr: number
  ): CandidatePattern | null {
    const candles = ctx.series.candles;
    const prev = candles[i - 1];
    const cur = candles[i];

    const bufferE = this.cfg.entryBufferAtrMult * atr;
    const bufferS = this.cfg.stopBufferAtrMult * atr;

    let entry: number, stop: number, target: number;

    if (direction === 'BULLISH') {
      entry = cur.high + bufferE;
      stop = cur.low - bufferS;
      target = entry + 2.0 * (entry - stop);
    } else {
      entry = cur.low - bufferE;
      stop = cur.high + bufferS;
      target = entry - 2.0 * (stop - entry);
    }

    const rr = this.riskReward(entry, stop, target, direction);
    if (rr < this.cfg.minRR) return null;

    const id = this.makeId(ctx.series.asset, '1D', 'CANDLE_INSIDE', i, prev.high, prev.low, cur.high, cur.low);

    return {
      id,
      type: 'CANDLE_INSIDE',
      tf: '1D',
      asset: ctx.series.asset,
      startTs: cur.ts,
      endTs: cur.ts,
      startIdx: i - 1,
      endIdx: i,
      direction,
      geometry: {
        inside: {
          prevHigh: prev.high,
          prevLow: prev.low,
          curHigh: cur.high,
          curLow: cur.low,
        },
      },
      metrics: {
        geometryScore: 0.7,
        touchScore: 0.8,
        symmetryScore: 0.8,
        durationScore: 0.5,
        noiseScore: 0.8,
        totalScore: 0.6,
        rr,
        insideRangePct: (cur.high - cur.low) / Math.max(1e-9, prev.high - prev.low),
        chosenDirection: direction === 'BULLISH' ? 1 : -1,
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

  private pickInsideBarDirection(ctx: TAContext): 'BULLISH' | 'BEARISH' {
    const r = ctx.structure?.regime ?? 'TRANSITION';
    if (r === 'TREND_UP') return 'BULLISH';
    if (r === 'TREND_DOWN') return 'BEARISH';
    const a = ctx.featuresPack?.ma?.alignment ?? 'MIXED';
    if (a === 'BULL') return 'BULLISH';
    if (a === 'BEAR') return 'BEARISH';
    return 'BULLISH';
  }

  private isNearAnyLevel(ctx: TAContext, price: number, atr: number): boolean {
    const zones = ctx.levels ?? [];
    const tol = 0.6 * atr;
    for (const z of zones) {
      const low = z.price - (z.band ?? 0);
      const high = z.price + (z.band ?? 0);
      if (price >= low - tol && price <= high + tol) return true;
    }
    return false;
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

  private makeId(asset: string, tf: string, type: string, i: number, a: number, b: number, c: number, d: number): string {
    const payload = JSON.stringify({ asset, tf, type, i, a: this.round(a), b: this.round(b), c: this.round(c), d: this.round(d) });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  private round(x: number): number {
    return Math.round(x * 1e6) / 1e6;
  }

  private clamp01(x: number): number {
    return Math.max(0, Math.min(1, x));
  }
}
