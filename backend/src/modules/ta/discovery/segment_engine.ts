/**
 * Phase AF1: Segment Engine
 * 
 * Extracts structural segments from price data using zigzag algorithm.
 * This is the foundation for pattern discovery.
 */

import { 
  StructurePivot, 
  PriceSegment, 
  MarketStructure,
  DEFAULT_DISCOVERY_CONFIG
} from './discovery_types.js';

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

// ═══════════════════════════════════════════════════════════════
// ZIGZAG ALGORITHM
// ═══════════════════════════════════════════════════════════════

/**
 * Find pivot points using zigzag algorithm
 */
export function findZigzagPivots(
  candles: Candle[],
  threshold: number = DEFAULT_DISCOVERY_CONFIG.zigzagThreshold
): StructurePivot[] {
  if (candles.length < 3) return [];
  
  const pivots: StructurePivot[] = [];
  let lastPivot: StructurePivot | null = null;
  let lastDirection: 'UP' | 'DOWN' | null = null;
  
  // Start with first candle
  const first = candles[0];
  lastPivot = {
    type: 'LOW',
    price: first.low,
    index: 0,
    timestamp: first.time,
  };
  
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    
    if (lastDirection === null || lastDirection === 'DOWN') {
      // Looking for potential HIGH
      if (candle.high > lastPivot!.price * (1 + threshold)) {
        // Found significant move up
        if (lastDirection === 'DOWN') {
          // Confirm LOW pivot
          pivots.push(lastPivot!);
        }
        lastPivot = {
          type: 'HIGH',
          price: candle.high,
          index: i,
          timestamp: candle.time,
        };
        lastDirection = 'UP';
      } else if (candle.low < lastPivot!.price) {
        // Lower low - update pivot
        lastPivot = {
          type: 'LOW',
          price: candle.low,
          index: i,
          timestamp: candle.time,
        };
      }
    }
    
    if (lastDirection === null || lastDirection === 'UP') {
      // Looking for potential LOW
      if (candle.low < lastPivot!.price * (1 - threshold)) {
        // Found significant move down
        if (lastDirection === 'UP') {
          // Confirm HIGH pivot
          pivots.push(lastPivot!);
        }
        lastPivot = {
          type: 'LOW',
          price: candle.low,
          index: i,
          timestamp: candle.time,
        };
        lastDirection = 'DOWN';
      } else if (candle.high > lastPivot!.price) {
        // Higher high - update pivot
        lastPivot = {
          type: 'HIGH',
          price: candle.high,
          index: i,
          timestamp: candle.time,
        };
      }
    }
  }
  
  // Add last pivot
  if (lastPivot && (pivots.length === 0 || pivots[pivots.length - 1].index !== lastPivot.index)) {
    pivots.push(lastPivot);
  }
  
  return pivots;
}

// ═══════════════════════════════════════════════════════════════
// SEGMENT EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Convert pivots to segments
 */
export function pivotsToSegments(pivots: StructurePivot[]): PriceSegment[] {
  const segments: PriceSegment[] = [];
  
  for (let i = 1; i < pivots.length; i++) {
    const prev = pivots[i - 1];
    const curr = pivots[i];
    
    const direction = curr.price > prev.price ? 'UP' : 'DOWN';
    const magnitude = (curr.price - prev.price) / prev.price;
    
    segments.push({
      startIndex: prev.index,
      endIndex: curr.index,
      startPrice: prev.price,
      endPrice: curr.price,
      direction,
      magnitude,
      bars: curr.index - prev.index,
    });
  }
  
  return segments;
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURE METRICS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate structure metrics
 */
export function calculateStructureMetrics(segments: PriceSegment[]): {
  volatility: number;
  symmetry: number;
  rhythm: number;
  complexity: number;
} {
  if (segments.length === 0) {
    return { volatility: 0, symmetry: 0, rhythm: 0, complexity: 0 };
  }
  
  // Volatility: average absolute magnitude
  const avgMagnitude = segments.reduce((sum, s) => sum + Math.abs(s.magnitude), 0) / segments.length;
  
  // Symmetry: balance of up vs down moves
  const upMoves = segments.filter(s => s.direction === 'UP');
  const downMoves = segments.filter(s => s.direction === 'DOWN');
  const upTotal = upMoves.reduce((sum, s) => sum + Math.abs(s.magnitude), 0);
  const downTotal = downMoves.reduce((sum, s) => sum + Math.abs(s.magnitude), 0);
  const totalMoves = upTotal + downTotal;
  const symmetry = totalMoves > 0 ? 1 - Math.abs(upTotal - downTotal) / totalMoves : 0;
  
  // Rhythm: regularity of segment lengths
  const avgBars = segments.reduce((sum, s) => sum + s.bars, 0) / segments.length;
  const barVariance = segments.reduce((sum, s) => sum + Math.pow(s.bars - avgBars, 2), 0) / segments.length;
  const rhythm = avgBars > 0 ? Math.exp(-Math.sqrt(barVariance) / avgBars) : 0;
  
  // Complexity: number of reversals normalized
  const complexity = Math.min(1, segments.length / 20);
  
  return {
    volatility: avgMagnitude,
    symmetry,
    rhythm,
    complexity,
  };
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURE BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build market structure from candles
 */
export function buildMarketStructure(
  candles: Candle[],
  threshold: number = DEFAULT_DISCOVERY_CONFIG.zigzagThreshold
): MarketStructure {
  const pivots = findZigzagPivots(candles, threshold);
  const segments = pivotsToSegments(pivots);
  const metrics = calculateStructureMetrics(segments);
  
  return { pivots, segments, metrics };
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURE WINDOWS
// ═══════════════════════════════════════════════════════════════

/**
 * Extract sliding windows of structure for pattern discovery
 */
export function extractStructureWindows(
  pivots: StructurePivot[],
  minSize: number = DEFAULT_DISCOVERY_CONFIG.minStructureSize,
  maxSize: number = DEFAULT_DISCOVERY_CONFIG.maxStructureSize
): StructurePivot[][] {
  const windows: StructurePivot[][] = [];
  
  for (let windowSize = minSize; windowSize <= maxSize; windowSize++) {
    for (let start = 0; start <= pivots.length - windowSize; start++) {
      const window = pivots.slice(start, start + windowSize);
      windows.push(window);
    }
  }
  
  return windows;
}
