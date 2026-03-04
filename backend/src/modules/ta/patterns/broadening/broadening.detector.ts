/**
 * Phase R10.D: Broadening Pattern Detector
 * Expanding/Broadening formations
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';

/**
 * Detect broadening triangle (megaphone)
 * Highs getting higher, lows getting lower
 */
export function detectBroadening(pivots: Pivot[]): PatternResult[] {
  const highs = pivots.filter(p => p.kind === 'HIGH');
  const lows = pivots.filter(p => p.kind === 'LOW');
  const results: PatternResult[] = [];
  
  if (highs.length < 2 || lows.length < 2) return results;
  
  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  
  // Expanding: higher highs AND lower lows
  const expanding = h2.price > h1.price && l2.price < l1.price;
  
  if (expanding) {
    // Calculate expansion rate
    const highExpansion = (h2.price - h1.price) / h1.price;
    const lowExpansion = (l1.price - l2.price) / l1.price;
    const avgExpansion = (highExpansion + lowExpansion) / 2;
    
    const conf = Math.min(0.78, 0.60 + avgExpansion * 5);
    
    results.push({
      type: 'BROADENING_TRIANGLE',
      direction: 'NEUTRAL',
      confidence: conf,
      startIndex: Math.min(h1.index, l1.index),
      endIndex: Math.max(h2.index, l2.index),
      priceLevels: [h2.price, l2.price],
      meta: {
        highExpansion,
        lowExpansion,
        avgExpansion,
      },
    });
  }
  
  return results;
}

/**
 * Detect broadening wedge
 * Both trendlines diverging in same general direction
 */
export function detectBroadeningWedge(pivots: Pivot[]): PatternResult[] {
  const highs = pivots.filter(p => p.kind === 'HIGH');
  const lows = pivots.filter(p => p.kind === 'LOW');
  const results: PatternResult[] = [];
  
  if (highs.length < 2 || lows.length < 2) return results;
  
  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  
  // Rising broadening wedge: both rising, but diverging
  if (h2.price > h1.price && l2.price > l1.price) {
    const highSlope = (h2.price - h1.price) / Math.max(1, h2.index - h1.index);
    const lowSlope = (l2.price - l1.price) / Math.max(1, l2.index - l1.index);
    
    // Broadening: high slope > low slope (diverging)
    if (highSlope > lowSlope * 1.2) {
      results.push({
        type: 'BROADENING_WEDGE',
        direction: 'BEAR', // Rising broadening wedge is bearish
        confidence: 0.68,
        startIndex: Math.min(h1.index, l1.index),
        endIndex: Math.max(h2.index, l2.index),
        priceLevels: [h2.price, l2.price],
        meta: { wedgeType: 'rising', highSlope, lowSlope },
      });
    }
  }
  
  // Falling broadening wedge: both falling, but diverging
  if (h2.price < h1.price && l2.price < l1.price) {
    const highSlope = (h1.price - h2.price) / Math.max(1, h2.index - h1.index);
    const lowSlope = (l1.price - l2.price) / Math.max(1, l2.index - l1.index);
    
    // Broadening: low slope > high slope (diverging)
    if (lowSlope > highSlope * 1.2) {
      results.push({
        type: 'BROADENING_WEDGE',
        direction: 'BULL', // Falling broadening wedge is bullish
        confidence: 0.68,
        startIndex: Math.min(h1.index, l1.index),
        endIndex: Math.max(h2.index, l2.index),
        priceLevels: [h2.price, l2.price],
        meta: { wedgeType: 'falling', highSlope, lowSlope },
      });
    }
  }
  
  return results;
}

export function runBroadeningDetectors(pivots: Pivot[]): PatternResult[] {
  return [
    ...detectBroadening(pivots),
    ...detectBroadeningWedge(pivots),
  ];
}
