/**
 * Channel / Trendline Detector — Production-grade trend detection
 * 
 * Detects:
 * - CHANNEL_UP (parallel upward channel)
 * - CHANNEL_DOWN (parallel downward channel)
 * - CHANNEL_HORIZONTAL (range/rectangle)
 * - TRENDLINE_UP (support trendline)
 * - TRENDLINE_DOWN (resistance trendline)
 * 
 * Algorithm:
 * 1. Fit lines through HIGH pivots (resistance) and LOW pivots (support)
 * 2. Check parallelism for channel
 * 3. If not parallel enough, try single trendline
 * 4. Score by touches, parallelism, channel width
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, TAContext, PatternType, Pivot } from '../domain/types.js';
import { fitLineRobust, yOnLine, distancePointLine, Point, Line } from './fit.js';

export type ChannelDetectorConfig = {
  lookbackPivots: number;       // e.g. 16
  minTouches: number;           // e.g. 2
  parallelTolerance: number;    // slope diff threshold (e.g. 0.0005)
  maxChannelWidthAtr: number;   // max width in ATR units (e.g. 5)
  toleranceAtrMult: number;     // line tolerance = ATR * mult (e.g. 0.6)
  ransacIters: number;          // e.g. 64
};

export const DEFAULT_CHANNEL_CONFIG: ChannelDetectorConfig = {
  lookbackPivots: 16,
  minTouches: 2,
  parallelTolerance: 0.0005,
  maxChannelWidthAtr: 5,
  toleranceAtrMult: 0.6,
  ransacIters: 64,
};

export class ChannelDetector implements Detector {
  public readonly id = 'channel.detector.v1';
  public readonly name = 'Channel/Trendline Detector';
  public readonly types: PatternType[] = [
    'CHANNEL_UP', 'CHANNEL_DOWN', 'CHANNEL_HORIZONTAL',
    'TRENDLINE_BREAK'
  ];
  public readonly version = '1.0.0';

  constructor(private cfg: ChannelDetectorConfig = DEFAULT_CHANNEL_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const pivots = ctx.pivots;
    if (!pivots || pivots.length < 6) return [];

    const recent = pivots.slice(-this.cfg.lookbackPivots);
    const highs = recent.filter(p => p.type === 'HIGH');
    const lows = recent.filter(p => p.type === 'LOW');

    if (highs.length < 2 || lows.length < 2) return [];

    const lastIdx = ctx.series.candles.length - 1;
    const atr = ctx.atr[lastIdx] || 0;
    const currentPrice = ctx.series.candles[lastIdx].close;
    const tol = Math.max(atr * this.cfg.toleranceAtrMult, currentPrice * 0.001);

    const highPts: Point[] = highs.map(p => ({ x: p.i, y: p.price }));
    const lowPts: Point[] = lows.map(p => ({ x: p.i, y: p.price }));

    const highFit = fitLineRobust(highPts, tol, this.cfg.ransacIters);
    const lowFit = fitLineRobust(lowPts, tol, this.cfg.ransacIters);

    if (!highFit || !lowFit) return [];

    const upper = highFit.line;
    const lower = lowFit.line;

    const slopeDiff = Math.abs(upper.slope - lower.slope);
    const isParallel = slopeDiff < this.cfg.parallelTolerance;

    const windowStart = Math.min(...recent.map(p => p.i));
    const windowEnd = Math.max(...recent.map(p => p.i));

    const widthStart = yOnLine(upper, windowStart) - yOnLine(lower, windowStart);
    const widthEnd = yOnLine(upper, windowEnd) - yOnLine(lower, windowEnd);

    if (widthStart <= 0 || widthEnd <= 0) return [];

    const channelWidth = Math.max(widthStart, widthEnd);

    // Check channel width constraint
    if (atr > 0 && channelWidth > atr * this.cfg.maxChannelWidthAtr) return [];

    const touchesUpper = this.countTouches(highPts, upper, tol);
    const touchesLower = this.countTouches(lowPts, lower, tol);

    // If not enough touches for channel, try trendline
    if (touchesUpper < this.cfg.minTouches || touchesLower < this.cfg.minTouches) {
      return this.tryTrendline(ctx, highs, lows, tol, windowStart, windowEnd);
    }

    // Classify channel type
    let type: PatternType;
    const avgSlope = (upper.slope + lower.slope) / 2;
    const slopeThreshold = 0.00005;

    if (avgSlope > slopeThreshold) {
      type = 'CHANNEL_UP';
    } else if (avgSlope < -slopeThreshold) {
      type = 'CHANNEL_DOWN';
    } else {
      type = 'CHANNEL_HORIZONTAL';
    }

    // Calculate score
    const score = this.calculateScore(
      touchesUpper, touchesLower, slopeDiff, channelWidth, isParallel, atr
    );

    const id = this.makeId(ctx.series.asset, type, windowStart, windowEnd);
    const durationBars = windowEnd - windowStart;

    return [{
      id,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs: ctx.series.candles[windowStart].ts,
      endTs: ctx.series.candles[windowEnd].ts,
      startIdx: windowStart,
      endIdx: windowEnd,
      direction: type === 'CHANNEL_UP' ? 'BULLISH' : type === 'CHANNEL_DOWN' ? 'BEARISH' : 'NEUTRAL',
      geometry: {
        upperLine: upper,
        lowerLine: lower,
        lines: [
          { x1: windowStart, y1: yOnLine(upper, windowStart), x2: windowEnd, y2: yOnLine(upper, windowEnd) },
          { x1: windowStart, y1: yOnLine(lower, windowStart), x2: windowEnd, y2: yOnLine(lower, windowEnd) },
        ],
        zones: [
          { price: yOnLine(upper, windowEnd), band: tol },
          { price: yOnLine(lower, windowEnd), band: tol },
        ],
      },
      metrics: {
        geometryScore: isParallel ? 0.8 : 0.5,
        touchScore: Math.min(1, (touchesUpper + touchesLower) / 8),
        symmetryScore: 1 - Math.min(1, slopeDiff / this.cfg.parallelTolerance),
        durationScore: Math.min(1, durationBars / 50),
        noiseScore: 0.7,
        totalScore: score,
        touchesUpper,
        touchesLower,
        slopeDiff,
        channelWidth,
        avgSlope,
        isParallel,
      },
      context: {
        regime: ctx.structure.regime,
        atr,
        currentPrice,
        maContext: {
          priceVsMa50: ctx.features.priceVsMa50 ?? 0,
          priceVsMa200: ctx.features.priceVsMa200 ?? 0,
          ma50VsMa200: ctx.features.ma50VsMa200 ?? 0,
          maSlope50: ctx.maSlope50[lastIdx] ?? 0,
          maSlope200: ctx.maSlope200[lastIdx] ?? 0,
        },
      },
      trade: this.calculateTrade(type, upper, lower, windowEnd, currentPrice, atr),
    }];
  }

  private tryTrendline(
    ctx: TAContext,
    highs: Pivot[],
    lows: Pivot[],
    tol: number,
    windowStart: number,
    windowEnd: number
  ): CandidatePattern[] {
    const lastIdx = ctx.series.candles.length - 1;
    const atr = ctx.atr[lastIdx] || 0;
    const currentPrice = ctx.series.candles[lastIdx].close;

    // Try support trendline (upward)
    if (lows.length >= 3) {
      const lowPts = lows.map(p => ({ x: p.i, y: p.price }));
      const fit = fitLineRobust(lowPts, tol, this.cfg.ransacIters);

      if (fit && fit.line.slope > 0) {
        const touches = this.countTouches(lowPts, fit.line, tol);
        if (touches >= 3) {
          return [{
            id: this.makeId(ctx.series.asset, 'TRENDLINE_BREAK', lows[0].i, lows[lows.length - 1].i),
            type: 'TRENDLINE_BREAK',
            tf: '1D',
            asset: ctx.series.asset,
            startTs: ctx.series.candles[lows[0].i].ts,
            endTs: ctx.series.candles[lows[lows.length - 1].i].ts,
            startIdx: lows[0].i,
            endIdx: lows[lows.length - 1].i,
            direction: 'BULLISH',
            geometry: {
              line: fit.line,
              lineType: 'SUPPORT',
              lines: [{
                x1: lows[0].i,
                y1: yOnLine(fit.line, lows[0].i),
                x2: lows[lows.length - 1].i,
                y2: yOnLine(fit.line, lows[lows.length - 1].i),
              }],
            },
            metrics: {
              geometryScore: 0.6,
              touchScore: Math.min(1, touches / 5),
              symmetryScore: 0.5,
              durationScore: 0.5,
              noiseScore: 0.6,
              totalScore: Math.min(1, touches / 5) * 0.7,
              touches,
              slope: fit.line.slope,
            },
            context: {
              regime: ctx.structure.regime,
              atr,
              currentPrice,
            },
          }];
        }
      }
    }

    // Try resistance trendline (downward)
    if (highs.length >= 3) {
      const highPts = highs.map(p => ({ x: p.i, y: p.price }));
      const fit = fitLineRobust(highPts, tol, this.cfg.ransacIters);

      if (fit && fit.line.slope < 0) {
        const touches = this.countTouches(highPts, fit.line, tol);
        if (touches >= 3) {
          return [{
            id: this.makeId(ctx.series.asset, 'TRENDLINE_BREAK', highs[0].i, highs[highs.length - 1].i),
            type: 'TRENDLINE_BREAK',
            tf: '1D',
            asset: ctx.series.asset,
            startTs: ctx.series.candles[highs[0].i].ts,
            endTs: ctx.series.candles[highs[highs.length - 1].i].ts,
            startIdx: highs[0].i,
            endIdx: highs[highs.length - 1].i,
            direction: 'BEARISH',
            geometry: {
              line: fit.line,
              lineType: 'RESISTANCE',
              lines: [{
                x1: highs[0].i,
                y1: yOnLine(fit.line, highs[0].i),
                x2: highs[highs.length - 1].i,
                y2: yOnLine(fit.line, highs[highs.length - 1].i),
              }],
            },
            metrics: {
              geometryScore: 0.6,
              touchScore: Math.min(1, touches / 5),
              symmetryScore: 0.5,
              durationScore: 0.5,
              noiseScore: 0.6,
              totalScore: Math.min(1, touches / 5) * 0.7,
              touches,
              slope: fit.line.slope,
            },
            context: {
              regime: ctx.structure.regime,
              atr,
              currentPrice,
            },
          }];
        }
      }
    }

    return [];
  }

  private calculateScore(
    touchesUpper: number,
    touchesLower: number,
    slopeDiff: number,
    channelWidth: number,
    isParallel: boolean,
    atr: number
  ): number {
    const touchScore = this.clamp01((touchesUpper + touchesLower) / 6) * 1.5;
    const parallelScore = this.clamp01(1 - slopeDiff / this.cfg.parallelTolerance) * 1.0;
    const widthScore = atr > 0 ? this.clamp01(1 - channelWidth / (atr * this.cfg.maxChannelWidthAtr)) * 0.5 : 0.5;

    return (touchScore + parallelScore + widthScore) / 3;
  }

  private calculateTrade(
    type: PatternType,
    upper: Line,
    lower: Line,
    endIdx: number,
    currentPrice: number,
    atr: number
  ): CandidatePattern['trade'] {
    const upperLevel = yOnLine(upper, endIdx);
    const lowerLevel = yOnLine(lower, endIdx);
    const channelHeight = upperLevel - lowerLevel;

    // Trade depends on position in channel
    const positionInChannel = (currentPrice - lowerLevel) / channelHeight;

    let entry: number, stop: number, target1: number, target2: number;

    if (positionInChannel < 0.3) {
      // Near support - potential long
      entry = lowerLevel * 1.002;
      stop = lowerLevel - atr * 0.5;
      target1 = upperLevel * 0.98;
      target2 = upperLevel + channelHeight * 0.5;
    } else if (positionInChannel > 0.7) {
      // Near resistance - potential short or breakout
      entry = upperLevel * 0.998;
      stop = upperLevel + atr * 0.5;
      target1 = lowerLevel * 1.02;
      target2 = lowerLevel - channelHeight * 0.5;
    } else {
      // Middle of channel - wait
      entry = currentPrice;
      stop = type === 'CHANNEL_UP' ? lowerLevel : upperLevel;
      target1 = type === 'CHANNEL_UP' ? upperLevel : lowerLevel;
      target2 = target1;
    }

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

  private clamp01(x: number): number {
    return Math.max(0, Math.min(1, x));
  }

  private makeId(asset: string, type: string, start: number, end: number): string {
    const payload = JSON.stringify({ asset, type, start, end });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }
}
