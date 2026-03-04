/**
 * Phase T: Trend Geometry Detector
 * 
 * Patterns:
 * - CHANNEL_HORIZONTAL: Horizontal price channel (range)
 * - TRENDLINE_BREAK: Price breaking through established trendline
 * - PITCHFORK_ANDREWS: Andrews Pitchfork pattern
 * - EXPANDING_FORMATION: Megaphone / expanding triangle
 */

import { Detector, TAContext, CandidatePattern, Pivot } from '../../domain/types.js';
import { fitLineLS, Line, Point } from '../../core/fit.js';
import { getRNG } from '../../infra/rng.js';

export interface TrendGeometryConfig {
  minChannelBars: number;      // Minimum bars for channel
  channelTolerance: number;    // % tolerance for parallel lines
  trendlineMinTouches: number; // Minimum touches for valid trendline
  pitchforkMinBars: number;    // Minimum bars for pitchfork
  expandingMinBars: number;    // Minimum bars for expanding formation
}

export const DEFAULT_TREND_GEOMETRY_CONFIG: TrendGeometryConfig = {
  minChannelBars: 15,
  channelTolerance: 2.0,
  trendlineMinTouches: 3,
  pitchforkMinBars: 20,
  expandingMinBars: 15,
};

export class TrendGeometryDetector implements Detector {
  id = 'phase_t_trend_geometry';
  name = 'Trend Geometry Detector';
  version = '1.0.0';
  types = ['CHANNEL_HORIZONTAL', 'TRENDLINE_BREAK', 'PITCHFORK_ANDREWS', 'EXPANDING_FORMATION'];

  constructor(private config: TrendGeometryConfig = DEFAULT_TREND_GEOMETRY_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const { candles, pivots } = ctx;
    if (!candles || candles.length < this.config.minChannelBars) return [];

    const patterns: CandidatePattern[] = [];
    const rng = getRNG();

    // ═══════════════════════════════════════════════════════════════
    // CHANNEL_HORIZONTAL Detection
    // ═══════════════════════════════════════════════════════════════
    
    const horizChannels = this.detectHorizontalChannel(candles, pivots);
    for (const hc of horizChannels) {
      patterns.push({
        id: `channel_horiz_${hc.endIndex}_${rng.nextInt(1000, 9999)}`,
        type: 'CHANNEL_HORIZONTAL',
        direction: 'NEUTRAL',
        startIndex: hc.startIndex,
        endIndex: hc.endIndex,
        keyPrices: {
          top: hc.top,
          bottom: hc.bottom,
          mid: (hc.top + hc.bottom) / 2,
        },
        metrics: {
          channelWidth: (hc.top - hc.bottom) / hc.bottom * 100,
          bars: hc.endIndex - hc.startIndex,
          totalScore: hc.score,
          geometryScore: hc.score,
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // TRENDLINE_BREAK Detection
    // ═══════════════════════════════════════════════════════════════
    
    if (pivots && pivots.length >= this.config.trendlineMinTouches) {
      const trendBreaks = this.detectTrendlineBreaks(candles, pivots);
      for (const tb of trendBreaks) {
        patterns.push({
          id: `trendline_break_${tb.breakIndex}_${rng.nextInt(1000, 9999)}`,
          type: 'TRENDLINE_BREAK',
          direction: tb.direction,
          startIndex: tb.startIndex,
          endIndex: tb.breakIndex,
          keyPrices: {
            trendlineStart: tb.lineStart,
            trendlineEnd: tb.lineEnd,
            breakPrice: tb.breakPrice,
          },
          metrics: {
            slope: tb.slope,
            touches: tb.touches,
            totalScore: tb.score,
            geometryScore: tb.score,
          },
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PITCHFORK_ANDREWS Detection
    // ═══════════════════════════════════════════════════════════════
    
    if (pivots && pivots.length >= 5) {
      const pitchforks = this.detectPitchforks(candles, pivots);
      for (const pf of pitchforks) {
        patterns.push({
          id: `pitchfork_${pf.endIndex}_${rng.nextInt(1000, 9999)}`,
          type: 'PITCHFORK_ANDREWS',
          direction: pf.direction,
          startIndex: pf.startIndex,
          endIndex: pf.endIndex,
          keyPrices: {
            pivot1: pf.p1,
            pivot2: pf.p2,
            pivot3: pf.p3,
            medianLine: pf.medianPrice,
          },
          metrics: {
            totalScore: pf.score,
            geometryScore: pf.score,
          },
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // EXPANDING_FORMATION Detection (Megaphone)
    // ═══════════════════════════════════════════════════════════════
    
    if (pivots && pivots.length >= 6) {
      const expanding = this.detectExpandingFormation(candles, pivots);
      for (const ef of expanding) {
        patterns.push({
          id: `expanding_${ef.endIndex}_${rng.nextInt(1000, 9999)}`,
          type: 'EXPANDING_FORMATION',
          direction: 'BOTH',
          startIndex: ef.startIndex,
          endIndex: ef.endIndex,
          keyPrices: {
            upperSlope: ef.upperSlope,
            lowerSlope: ef.lowerSlope,
            currentTop: ef.currentTop,
            currentBottom: ef.currentBottom,
          },
          metrics: {
            expansion: ef.expansion,
            totalScore: ef.score,
            geometryScore: ef.score,
          },
        });
      }
    }

    return patterns;
  }

  private detectHorizontalChannel(candles: any[], pivots?: Pivot[]): any[] {
    const results: any[] = [];
    const windowSize = this.config.minChannelBars;

    for (let end = windowSize; end <= candles.length; end++) {
      const start = end - windowSize;
      const window = candles.slice(start, end);
      
      const highs = window.map(c => c.high);
      const lows = window.map(c => c.low);
      
      const maxHigh = Math.max(...highs);
      const minLow = Math.min(...lows);
      const range = maxHigh - minLow;
      const mid = (maxHigh + minLow) / 2;
      
      // Check if range is relatively tight (horizontal)
      const rangePercent = range / mid * 100;
      
      // Horizontal channel if range is less than 5% typically
      if (rangePercent < 5 && rangePercent > 0.5) {
        // Calculate how flat the highs and lows are
        const highVariance = this.variance(highs);
        const lowVariance = this.variance(lows);
        const avgPrice = (maxHigh + minLow) / 2;
        const normalizedVariance = (highVariance + lowVariance) / (avgPrice * avgPrice);
        
        if (normalizedVariance < 0.001) {
          const score = 0.68 + (0.001 - normalizedVariance) * 100;
          
          results.push({
            startIndex: start,
            endIndex: end - 1,
            top: maxHigh,
            bottom: minLow,
            score: Math.min(score, 0.88),
          });
        }
      }
    }

    return results;
  }

  private detectTrendlineBreaks(candles: any[], pivots: Pivot[]): any[] {
    const results: any[] = [];
    
    // Separate high and low pivots
    const highPivots = pivots.filter(p => p.type === 'H' || p.type === 'high').slice(-10);
    const lowPivots = pivots.filter(p => p.type === 'L' || p.type === 'low').slice(-10);

    // Check for resistance trendline break (bullish)
    if (highPivots.length >= this.config.trendlineMinTouches) {
      const points: Point[] = highPivots.map(p => ({ x: p.index, y: p.price }));
      const line = fitLineLS(points);
      
      if (line && line.slope < 0) { // Downward sloping resistance
        const lastIdx = candles.length - 1;
        const trendlinePrice = line.slope * lastIdx + line.intercept;
        const currentClose = candles[lastIdx].close;
        
        if (currentClose > trendlinePrice * 1.005) { // Break above
          results.push({
            startIndex: highPivots[0].index,
            breakIndex: lastIdx,
            direction: 'BULL',
            lineStart: line.intercept,
            lineEnd: trendlinePrice,
            breakPrice: currentClose,
            slope: line.slope,
            touches: highPivots.length,
            score: 0.72 + Math.min(highPivots.length * 0.02, 0.1),
          });
        }
      }
    }

    // Check for support trendline break (bearish)
    if (lowPivots.length >= this.config.trendlineMinTouches) {
      const points: Point[] = lowPivots.map(p => ({ x: p.index, y: p.price }));
      const line = fitLineLS(points);
      
      if (line && line.slope > 0) { // Upward sloping support
        const lastIdx = candles.length - 1;
        const trendlinePrice = line.slope * lastIdx + line.intercept;
        const currentClose = candles[lastIdx].close;
        
        if (currentClose < trendlinePrice * 0.995) { // Break below
          results.push({
            startIndex: lowPivots[0].index,
            breakIndex: lastIdx,
            direction: 'BEAR',
            lineStart: line.intercept,
            lineEnd: trendlinePrice,
            breakPrice: currentClose,
            slope: line.slope,
            touches: lowPivots.length,
            score: 0.72 + Math.min(lowPivots.length * 0.02, 0.1),
          });
        }
      }
    }

    return results;
  }

  private detectPitchforks(candles: any[], pivots: Pivot[]): any[] {
    const results: any[] = [];
    if (pivots.length < 3) return results;

    // Take last 3 significant pivots
    const recentPivots = pivots.slice(-5);
    
    for (let i = 0; i < recentPivots.length - 2; i++) {
      const p1 = recentPivots[i];
      const p2 = recentPivots[i + 1];
      const p3 = recentPivots[i + 2];
      
      // P1 should be opposite type from P2/P3
      if (p1.type === p2.type) continue;
      
      // Calculate median line from P1 through midpoint of P2-P3
      const midPoint = (p2.price + p3.price) / 2;
      const midIndex = (p2.index + p3.index) / 2;
      
      // Direction based on P1 to midpoint
      const direction = midPoint > p1.price ? 'BULL' : 'BEAR';
      
      results.push({
        startIndex: p1.index,
        endIndex: p3.index,
        p1: p1.price,
        p2: p2.price,
        p3: p3.price,
        medianPrice: midPoint,
        direction,
        score: 0.65,
      });
    }

    return results;
  }

  private detectExpandingFormation(candles: any[], pivots: Pivot[]): any[] {
    const results: any[] = [];
    
    const highPivots = pivots.filter(p => p.type === 'H' || p.type === 'high').slice(-5);
    const lowPivots = pivots.filter(p => p.type === 'L' || p.type === 'low').slice(-5);
    
    if (highPivots.length < 3 || lowPivots.length < 3) return results;

    // Fit lines to highs and lows
    const highPoints: Point[] = highPivots.map(p => ({ x: p.index, y: p.price }));
    const lowPoints: Point[] = lowPivots.map(p => ({ x: p.index, y: p.price }));
    
    const highLine = fitLineLS(highPoints);
    const lowLine = fitLineLS(lowPoints);
    
    if (!highLine || !lowLine) return results;

    // Expanding: highs going up, lows going down (diverging)
    if (highLine.slope > 0 && lowLine.slope < 0) {
      const lastIdx = candles.length - 1;
      const currentTop = highLine.slope * lastIdx + highLine.intercept;
      const currentBottom = lowLine.slope * lastIdx + lowLine.intercept;
      
      results.push({
        startIndex: Math.min(highPivots[0].index, lowPivots[0].index),
        endIndex: lastIdx,
        upperSlope: highLine.slope,
        lowerSlope: lowLine.slope,
        currentTop,
        currentBottom,
        expansion: currentTop - currentBottom,
        score: 0.62,
      });
    }

    return results;
  }

  private variance(arr: number[]): number {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  }
}

export const TREND_GEOMETRY_DETECTOR = new TrendGeometryDetector();
