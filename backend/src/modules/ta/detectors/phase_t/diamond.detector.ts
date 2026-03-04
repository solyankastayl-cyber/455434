/**
 * Phase T: Diamond Pattern Detector
 * 
 * Patterns:
 * - DIAMOND_TOP: Bearish reversal - expanding then contracting formation at top
 * - DIAMOND_BOTTOM: Bullish reversal - expanding then contracting formation at bottom
 */

import { Detector, TAContext, CandidatePattern, Pivot } from '../../domain/types.js';
import { getRNG } from '../../infra/rng.js';

export interface DiamondConfig {
  minBars: number;             // Minimum bars for diamond
  maxBars: number;             // Maximum bars for diamond
  symmetryTolerance: number;   // % tolerance for symmetry
}

export const DEFAULT_DIAMOND_CONFIG: DiamondConfig = {
  minBars: 20,
  maxBars: 60,
  symmetryTolerance: 20,
};

export class DiamondDetector implements Detector {
  id = 'phase_t_diamond';
  name = 'Diamond Pattern Detector';
  version = '1.0.0';
  types = ['DIAMOND_TOP', 'DIAMOND_BOTTOM'];

  constructor(private config: DiamondConfig = DEFAULT_DIAMOND_CONFIG) {}

  detect(ctx: TAContext): CandidatePattern[] {
    const { candles, pivots } = ctx;
    if (!candles || candles.length < this.config.minBars || !pivots || pivots.length < 6) {
      return [];
    }

    const patterns: CandidatePattern[] = [];
    const rng = getRNG();

    // Diamond requires: expanding phase (broadening) then contracting phase (triangle)
    // Need at least 4 highs and 4 lows to form the pattern
    
    const highPivots = pivots.filter(p => p.type === 'H' || p.type === 'high');
    const lowPivots = pivots.filter(p => p.type === 'L' || p.type === 'low');

    if (highPivots.length < 4 || lowPivots.length < 4) return patterns;

    // Check recent pivot sequence for diamond structure
    const recentPivots = pivots.slice(-12);
    
    // Find expanding phase followed by contracting phase
    const diamonds = this.findDiamondStructure(candles, recentPivots);
    
    for (const d of diamonds) {
      patterns.push({
        id: `diamond_${d.type}_${d.endIndex}_${rng.nextInt(1000, 9999)}`,
        type: d.type,
        direction: d.type === 'DIAMOND_TOP' ? 'BEAR' : 'BULL',
        startIndex: d.startIndex,
        endIndex: d.endIndex,
        keyPrices: {
          highestHigh: d.highestHigh,
          lowestLow: d.lowestLow,
          breakoutLevel: d.breakoutLevel,
          midPoint: d.midPoint,
        },
        metrics: {
          bars: d.endIndex - d.startIndex,
          symmetry: d.symmetry,
          totalScore: d.score,
          geometryScore: d.score,
        },
      });
    }

    return patterns;
  }

  private findDiamondStructure(candles: any[], pivots: Pivot[]): any[] {
    const results: any[] = [];
    if (pivots.length < 6) return results;

    // Separate by type
    const highs = pivots.filter(p => p.type === 'H' || p.type === 'high');
    const lows = pivots.filter(p => p.type === 'L' || p.type === 'low');

    if (highs.length < 3 || lows.length < 3) return results;

    // Check if we have expanding then contracting structure
    // Expanding: highs getting higher, lows getting lower
    // Contracting: highs getting lower, lows getting higher

    // Look at last 6+ pivots
    const recentHighs = highs.slice(-4);
    const recentLows = lows.slice(-4);

    if (recentHighs.length >= 3 && recentLows.length >= 3) {
      // Check for expansion in first half
      const firstHalfHighs = recentHighs.slice(0, 2);
      const firstHalfLows = recentLows.slice(0, 2);
      
      const expanding = 
        firstHalfHighs[1].price > firstHalfHighs[0].price && 
        firstHalfLows[1].price < firstHalfLows[0].price;

      // Check for contraction in second half
      const secondHalfHighs = recentHighs.slice(-2);
      const secondHalfLows = recentLows.slice(-2);
      
      const contracting = 
        secondHalfHighs[1].price < secondHalfHighs[0].price && 
        secondHalfLows[1].price > secondHalfLows[0].price;

      if (expanding && contracting) {
        const allPrices = [...recentHighs, ...recentLows].map(p => p.price);
        const highestHigh = Math.max(...recentHighs.map(p => p.price));
        const lowestLow = Math.min(...recentLows.map(p => p.price));
        const midPoint = (highestHigh + lowestLow) / 2;
        
        const startIndex = Math.min(...pivots.slice(-6).map(p => p.index));
        const endIndex = Math.max(...pivots.slice(-6).map(p => p.index));
        
        // Determine if top or bottom based on prior trend
        const priorCandles = candles.slice(Math.max(0, startIndex - 20), startIndex);
        const priorTrend = priorCandles.length > 0 
          ? priorCandles[priorCandles.length - 1].close - priorCandles[0].close 
          : 0;
        
        const type = priorTrend > 0 ? 'DIAMOND_TOP' : 'DIAMOND_BOTTOM';
        
        // Calculate symmetry
        const leftWidth = pivots[Math.floor(pivots.length / 2)].index - startIndex;
        const rightWidth = endIndex - pivots[Math.floor(pivots.length / 2)].index;
        const symmetry = 1 - Math.abs(leftWidth - rightWidth) / Math.max(leftWidth, rightWidth, 1);
        
        // Breakout level
        const breakoutLevel = type === 'DIAMOND_TOP' ? lowestLow : highestHigh;
        
        const score = 0.55 + symmetry * 0.15 + (expanding && contracting ? 0.1 : 0);
        
        results.push({
          type,
          startIndex,
          endIndex,
          highestHigh,
          lowestLow,
          midPoint,
          breakoutLevel,
          symmetry,
          score: Math.min(score, 0.78),
        });
      }
    }

    return results;
  }
}

export const DIAMOND_DETECTOR = new DiamondDetector();
