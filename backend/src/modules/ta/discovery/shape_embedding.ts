/**
 * Phase AF4: Shape Embedding
 * 
 * Converts market structures to feature vectors for clustering.
 * This normalizes different price levels to comparable shapes.
 */

import { v4 as uuid } from 'uuid';
import { 
  StructurePivot, 
  ShapeEmbedding,
  DEFAULT_DISCOVERY_CONFIG
} from './discovery_types.js';
import { pivotsToSegments, calculateStructureMetrics } from './segment_engine.js';

// ═══════════════════════════════════════════════════════════════
// NORMALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize prices to percentage changes from first point
 */
export function normalizePrices(pivots: StructurePivot[]): number[] {
  if (pivots.length === 0) return [];
  
  const basePrice = pivots[0].price;
  return pivots.map(p => (p.price - basePrice) / basePrice);
}

/**
 * Normalize to 0-1 range
 */
function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  
  if (range === 0) return values.map(() => 0.5);
  
  return values.map(v => (v - min) / range);
}

// ═══════════════════════════════════════════════════════════════
// FEATURE EXTRACTION
// ═══════════════════════════════════════════════════════════════

export interface ShapeFeatures {
  // Price features
  totalMove: number;
  maxDrawdown: number;
  maxRunup: number;
  
  // Shape features
  pivotCount: number;
  symmetry: number;
  compression: number;
  
  // Time features
  duration: number;
  avgSegmentLength: number;
  
  // Volatility features
  volatilityRatio: number;
  
  // Pattern features
  retracementDepth: number;
  trendStrength: number;
}

/**
 * Extract features from structure
 */
export function extractShapeFeatures(pivots: StructurePivot[]): ShapeFeatures {
  if (pivots.length < 2) {
    return {
      totalMove: 0,
      maxDrawdown: 0,
      maxRunup: 0,
      pivotCount: 0,
      symmetry: 0,
      compression: 0,
      duration: 0,
      avgSegmentLength: 0,
      volatilityRatio: 0,
      retracementDepth: 0,
      trendStrength: 0,
    };
  }
  
  const segments = pivotsToSegments(pivots);
  const metrics = calculateStructureMetrics(segments);
  
  const firstPrice = pivots[0].price;
  const lastPrice = pivots[pivots.length - 1].price;
  const prices = pivots.map(p => p.price);
  
  // Total move
  const totalMove = (lastPrice - firstPrice) / firstPrice;
  
  // Max drawdown and runup
  let maxDrawdown = 0;
  let maxRunup = 0;
  let peak = firstPrice;
  let trough = firstPrice;
  
  for (const p of pivots) {
    if (p.price > peak) peak = p.price;
    if (p.price < trough) trough = p.price;
    
    const drawdown = (peak - p.price) / peak;
    const runup = (p.price - trough) / trough;
    
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    if (runup > maxRunup) maxRunup = runup;
  }
  
  // Compression: how tight is the range relative to first price
  const range = Math.max(...prices) - Math.min(...prices);
  const compression = 1 - Math.min(1, range / firstPrice / 0.2); // Normalized to 20%
  
  // Duration and segment length
  const duration = pivots[pivots.length - 1].index - pivots[0].index;
  const avgSegmentLength = segments.length > 0 
    ? segments.reduce((sum, s) => sum + s.bars, 0) / segments.length 
    : 0;
  
  // Volatility ratio
  const volatilityRatio = metrics.volatility / 0.05; // Normalized to 5%
  
  // Retracement depth
  const upSegments = segments.filter(s => s.direction === 'UP');
  const downSegments = segments.filter(s => s.direction === 'DOWN');
  const avgUpMove = upSegments.length > 0
    ? upSegments.reduce((sum, s) => sum + s.magnitude, 0) / upSegments.length
    : 0;
  const avgDownMove = downSegments.length > 0
    ? Math.abs(downSegments.reduce((sum, s) => sum + s.magnitude, 0) / downSegments.length)
    : 0;
  const retracementDepth = avgUpMove > 0 ? avgDownMove / avgUpMove : 0;
  
  // Trend strength
  const trendStrength = Math.abs(totalMove);
  
  return {
    totalMove: Math.min(1, Math.max(-1, totalMove)),
    maxDrawdown: Math.min(1, maxDrawdown),
    maxRunup: Math.min(1, maxRunup),
    pivotCount: Math.min(1, pivots.length / 20),
    symmetry: metrics.symmetry,
    compression,
    duration: Math.min(1, duration / 200),
    avgSegmentLength: Math.min(1, avgSegmentLength / 50),
    volatilityRatio: Math.min(1, volatilityRatio),
    retracementDepth: Math.min(1, retracementDepth),
    trendStrength: Math.min(1, trendStrength),
  };
}

// ═══════════════════════════════════════════════════════════════
// EMBEDDING BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build shape embedding from pivots
 */
export function buildShapeEmbedding(pivots: StructurePivot[]): ShapeEmbedding {
  const features = extractShapeFeatures(pivots);
  
  // Build feature vector for clustering
  const vector = [
    features.totalMove,
    features.maxDrawdown,
    features.maxRunup,
    features.pivotCount,
    features.symmetry,
    features.compression,
    features.duration,
    features.avgSegmentLength,
    features.volatilityRatio,
    features.retracementDepth,
    features.trendStrength,
  ];
  
  return {
    structureId: uuid(),
    features,
    vector,
  };
}

/**
 * Calculate similarity between two embeddings (cosine similarity)
 */
export function calculateSimilarity(a: ShapeEmbedding, b: ShapeEmbedding): number {
  const va = a.vector;
  const vb = b.vector;
  
  if (va.length !== vb.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < va.length; i++) {
    dotProduct += va[i] * vb[i];
    normA += va[i] * va[i];
    normB += vb[i] * vb[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

/**
 * Calculate Euclidean distance between embeddings
 */
export function calculateDistance(a: ShapeEmbedding, b: ShapeEmbedding): number {
  const va = a.vector;
  const vb = b.vector;
  
  if (va.length !== vb.length) return Infinity;
  
  let sumSquares = 0;
  for (let i = 0; i < va.length; i++) {
    sumSquares += Math.pow(va[i] - vb[i], 2);
  }
  
  return Math.sqrt(sumSquares);
}
