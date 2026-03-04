/**
 * Triangle Detector — Production-grade chart pattern detector
 * 
 * Detects:
 * - TRIANGLE_ASC (ascending triangle)
 * - TRIANGLE_DESC (descending triangle)
 * - TRIANGLE_SYM (symmetrical triangle)
 * - WEDGE_RISING
 * - WEDGE_FALLING
 * 
 * Algorithm:
 * 1. Take recent pivots
 * 2. Separate HIGH and LOW pivots
 * 3. Fit two trendlines (upper through HIGHs, lower through LOWs)
 * 4. Check convergence, touches, apex position
 * 5. Classify by slope patterns
 * 6. Return CandidatePattern with geometry and metrics
 */

import crypto from 'crypto';
import { CandidatePattern, Detector, TAContext, PatternType, Pivot } from '../domain/types.js';
import { fitLineRobust, lineIntersection, yOnLine, distancePointLine, Point, Line } from './fit.js';

export type TriangleDetectorConfig = {
  lookbackPivots: number;      // pivots window (e.g. 16)
  minTouches: number;          // minimum touches per line (e.g. 2)
  minDurationBars: number;     // minimum pattern duration (e.g. 20)
  maxDurationBars: number;     // maximum pattern duration (e.g. 220)
  slopeFlatEps: number;        // slope threshold for "flat" (e.g. 1e-4)
  convergenceMin: number;      // minimum convergence ratio (e.g. 0.15 = 15%)
  apexMaxBarsAhead: number;    // max bars until apex (e.g. 60)
  toleranceAtrMult: number;    // line tolerance = ATR * mult (e.g. 0.6)
  ransacIters: number;         // RANSAC iterations (e.g. 64)
};

export const DEFAULT_TRIANGLE_CONFIG: TriangleDetectorConfig = {
  lookbackPivots: 16,
  minTouches: 2,
  minDurationBars: 20,
  maxDurationBars: 220,
  slopeFlatEps: 1e-4,
  convergenceMin: 0.15,
  apexMaxBarsAhead: 60,
  toleranceAtrMult: 0.6,
  ransacIters: 64,
};

export class TriangleDetector implements Detector {
  public readonly id = 'triangle.detector.v1';
  public readonly name = 'Triangle/Wedge Detector';
  public readonly types: PatternType[] = [
    'TRIANGLE_ASC', 'TRIANGLE_DESC', 'TRIANGLE_SYM',
    'WEDGE_RISING', 'WEDGE_FALLING'
  ];
  public readonly version = '1.0.0';

  constructor(private cfg: TriangleDetectorConfig = DEFAULT_TRIANGLE_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const pivots = ctx.pivots;
    if (!pivots || pivots.length < 6) return [];

    const lookback = this.cfg.lookbackPivots;
    const recent = pivots.slice(-lookback);

    const highs = recent.filter(p => p.type === 'HIGH');
    const lows = recent.filter(p => p.type === 'LOW');
    
    if (highs.length < this.cfg.minTouches || lows.length < this.cfg.minTouches) {
      return [];
    }

    // Convert pivots to points (x = bar index, y = price)
    const highPts: Point[] = highs.map(p => ({ x: p.i, y: p.price }));
    const lowPts: Point[] = lows.map(p => ({ x: p.i, y: p.price }));

    const lastIdx = ctx.series.candles.length - 1;
    const atrNow = ctx.atr[Math.max(0, lastIdx)] || 0;
    const currentPrice = ctx.series.candles[lastIdx].close;
    const tol = Math.max(
      atrNow * this.cfg.toleranceAtrMult,
      currentPrice * 0.001
    );

    // Fit lines
    const upperFit = fitLineRobust(highPts, tol, this.cfg.ransacIters);
    const lowerFit = fitLineRobust(lowPts, tol, this.cfg.ransacIters);
    if (!upperFit || !lowerFit) return [];

    const upper = upperFit.line;
    const lower = lowerFit.line;

    // Window boundaries
    const windowStart = Math.min(...recent.map(p => p.i));
    const windowEnd = Math.max(...recent.map(p => p.i));

    // Upper must be above lower throughout window
    if (!this.isUpperAboveLower(upper, lower, windowStart, windowEnd)) {
      return [];
    }

    // Find apex (intersection point)
    const apex = lineIntersection(upper, lower);
    if (!apex) return [];

    // Apex should be ahead but not too far
    const apexBarsAhead = apex.x - windowEnd;
    if (apexBarsAhead < -2) return [];  // already crossed significantly
    if (apexBarsAhead > this.cfg.apexMaxBarsAhead) return [];

    // Duration constraints
    const durationBars = windowEnd - windowStart;
    if (durationBars < this.cfg.minDurationBars) return [];
    if (durationBars > this.cfg.maxDurationBars) return [];

    // Convergence: compare band height at start vs end
    const hStart = yOnLine(upper, windowStart) - yOnLine(lower, windowStart);
    const hEnd = yOnLine(upper, windowEnd) - yOnLine(lower, windowEnd);
    if (hStart <= 0 || hEnd <= 0) return [];

    const convergence = (hStart - hEnd) / hStart;
    if (convergence < this.cfg.convergenceMin) return [];

    // Count touches
    const touchesUpper = this.countTouches(highPts, upper, tol);
    const touchesLower = this.countTouches(lowPts, lower, tol);
    if (touchesUpper < this.cfg.minTouches || touchesLower < this.cfg.minTouches) {
      return [];
    }

    // Classification
    const type = this.classifyTriangle(upper, lower);

    // Build candidate
    const startTs = ctx.series.candles[windowStart]?.ts ?? ctx.series.candles[0].ts;
    const endTs = ctx.series.candles[windowEnd]?.ts ?? ctx.series.candles[lastIdx].ts;

    const patternId = this.makePatternId(
      ctx.series.asset, '1D', type, windowStart, windowEnd, upper, lower
    );

    // Calculate score
    const score = this.calculateScore({
      touchesUpper, touchesLower, convergence, durationBars,
      apexBarsAhead, upperFit, lowerFit, ctx
    });

    const candidate: CandidatePattern = {
      id: patternId,
      type,
      tf: '1D',
      asset: ctx.series.asset,
      startTs,
      endTs,
      startIdx: windowStart,
      endIdx: windowEnd,
      direction: this.getDirection(type),
      geometry: {
        pivots: recent,
        window: { startIndex: windowStart, endIndex: windowEnd },
        upperLine: upper,
        lowerLine: lower,
        apex: { indexX: apex.x, priceY: apex.y },
        lines: [
          { x1: windowStart, y1: yOnLine(upper, windowStart), x2: windowEnd, y2: yOnLine(upper, windowEnd) },
          { x1: windowStart, y1: yOnLine(lower, windowStart), x2: windowEnd, y2: yOnLine(lower, windowEnd) },
        ],
      },
      metrics: {
        geometryScore: Math.min(1, convergence + 0.3),
        touchScore: Math.min(1, (touchesUpper + touchesLower) / 8),
        symmetryScore: this.getSymmetryScore(upper, lower),
        durationScore: this.getDurationScore(durationBars),
        noiseScore: 1 - Math.min(1, (upperFit.mse + lowerFit.mse) / (atrNow * atrNow || 1)),
        totalScore: score,
        // Raw metrics
        touchesUpper,
        touchesLower,
        convergence,
        durationBars,
        apexBarsAhead,
        upperSlope: upper.slope,
        lowerSlope: lower.slope,
        fitMSEUpper: upperFit.mse,
        fitMSELower: lowerFit.mse,
      },
      context: {
        regime: ctx.structure.regime,
        atr: atrNow,
        currentPrice,
        maContext: {
          priceVsMa50: ctx.features.priceVsMa50 ?? 0,
          priceVsMa200: ctx.features.priceVsMa200 ?? 0,
          ma50VsMa200: ctx.features.ma50VsMa200 ?? 0,
          maSlope50: ctx.maSlope50[lastIdx] ?? 0,
          maSlope200: ctx.maSlope200[lastIdx] ?? 0,
        },
      },
      trade: this.calculateTrade(type, upper, lower, apex, currentPrice, atrNow, windowEnd),
    };

    return [candidate];
  }

  private classifyTriangle(upper: Line, lower: Line): PatternType {
    const uFlat = Math.abs(upper.slope) <= this.cfg.slopeFlatEps;
    const lFlat = Math.abs(lower.slope) <= this.cfg.slopeFlatEps;

    // Ascending: flat top, rising bottom
    if (uFlat && lower.slope > this.cfg.slopeFlatEps) return 'TRIANGLE_ASC';
    
    // Descending: falling top, flat bottom
    if (lFlat && upper.slope < -this.cfg.slopeFlatEps) return 'TRIANGLE_DESC';

    // Wedges: both slopes same direction
    if (upper.slope < -this.cfg.slopeFlatEps && lower.slope < -this.cfg.slopeFlatEps) {
      return 'WEDGE_FALLING';
    }
    if (upper.slope > this.cfg.slopeFlatEps && lower.slope > this.cfg.slopeFlatEps) {
      return 'WEDGE_RISING';
    }

    return 'TRIANGLE_SYM';
  }

  private getDirection(type: PatternType): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    switch (type) {
      case 'TRIANGLE_ASC': return 'BULLISH';
      case 'TRIANGLE_DESC': return 'BEARISH';
      case 'WEDGE_FALLING': return 'BULLISH';  // usually breaks up
      case 'WEDGE_RISING': return 'BEARISH';   // usually breaks down
      default: return 'NEUTRAL';
    }
  }

  private isUpperAboveLower(upper: Line, lower: Line, x1: number, x2: number): boolean {
    const y1u = yOnLine(upper, x1);
    const y1l = yOnLine(lower, x1);
    const y2u = yOnLine(upper, x2);
    const y2l = yOnLine(lower, x2);
    return y1u > y1l && y2u > y2l;
  }

  private countTouches(points: Point[], line: Line, tol: number): number {
    let c = 0;
    for (const p of points) {
      if (distancePointLine(p, line) <= tol) c++;
    }
    return c;
  }

  private getSymmetryScore(upper: Line, lower: Line): number {
    // Perfect symmetry = slopes are equal magnitude, opposite sign
    const slopeDiff = Math.abs(Math.abs(upper.slope) - Math.abs(lower.slope));
    const avgSlope = (Math.abs(upper.slope) + Math.abs(lower.slope)) / 2;
    return avgSlope > 0 ? Math.max(0, 1 - slopeDiff / avgSlope) : 0.5;
  }

  private getDurationScore(bars: number): number {
    const optMin = 30;
    const optMax = 120;
    if (bars >= optMin && bars <= optMax) return 1.0;
    if (bars < optMin) return 0.5 + 0.5 * (bars / optMin);
    return Math.max(0.3, 0.7 - 0.4 * ((bars - optMax) / optMax));
  }

  private calculateScore(params: any): number {
    const { touchesUpper, touchesLower, convergence, durationBars, apexBarsAhead, ctx } = params;
    
    let score = 0;
    
    // Touches (more = better)
    score += Math.min(1, (touchesUpper + touchesLower) / 8) * 0.25;
    
    // Convergence (15-40% is good)
    score += Math.min(1, convergence / 0.3) * 0.25;
    
    // Duration (30-120 bars optimal)
    score += this.getDurationScore(durationBars) * 0.20;
    
    // Apex proximity (closer = more imminent breakout)
    score += Math.max(0, 1 - apexBarsAhead / this.cfg.apexMaxBarsAhead) * 0.15;
    
    // Compression context
    score += (ctx.structure?.compressionScore ?? 0) * 0.15;
    
    return Math.round(score * 100) / 100;
  }

  private calculateTrade(
    type: PatternType,
    upper: Line,
    lower: Line,
    apex: Point,
    currentPrice: number,
    atr: number,
    endIdx: number
  ): CandidatePattern['trade'] {
    const breakoutLevel = type.includes('ASC') || type.includes('FALLING')
      ? yOnLine(upper, endIdx)  // break upward
      : yOnLine(lower, endIdx); // break downward
    
    const isLong = this.getDirection(type) === 'BULLISH';
    
    const entry = isLong ? breakoutLevel * 1.002 : breakoutLevel * 0.998;
    const stop = isLong
      ? Math.max(yOnLine(lower, endIdx), currentPrice - atr * 2)
      : Math.min(yOnLine(upper, endIdx), currentPrice + atr * 2);
    
    // Target based on pattern height
    const patternHeight = Math.abs(yOnLine(upper, endIdx) - yOnLine(lower, endIdx));
    const target1 = isLong ? entry + patternHeight : entry - patternHeight;
    const target2 = isLong ? entry + patternHeight * 1.618 : entry - patternHeight * 1.618;
    
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

  private makePatternId(
    asset: string,
    tf: string,
    type: string,
    startIndex: number,
    endIndex: number,
    upper: Line,
    lower: Line
  ): string {
    const payload = JSON.stringify({
      asset, tf, type, startIndex, endIndex,
      upper: this.roundLine(upper),
      lower: this.roundLine(lower),
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  }

  private roundLine(l: Line): Line {
    const r = (x: number) => Math.round(x * 1e8) / 1e8;
    return { slope: r(l.slope), intercept: r(l.intercept) };
  }
}
