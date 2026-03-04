/**
 * Level Engine — Support/Resistance Zone Detection
 * 
 * Production-level S/R detection using:
 * - Pivot clustering (DBSCAN-like by price with ATR tolerance)
 * - Touch counting and validation
 * - Strength scoring based on touches, recency, and volume
 * - Zone width adaptive to ATR
 * 
 * Outputs LevelZone[] that can be rendered as zones, not just lines.
 */

import { Pivot, LevelZone, LevelConfig, Candle } from '../domain/types.js';
import { generateId } from '../domain/math.js';

/**
 * Default level configuration
 */
export const DEFAULT_LEVEL_CONFIG: LevelConfig = {
  atrBandMult: 0.5,    // zone width = ATR * 0.5
  minTouches: 2,       // minimum touches to form a level
  maxLevels: 10,       // maximum levels to return
  decayFactor: 0.95    // strength decay per bar since last touch
};

/**
 * Compute support/resistance levels from pivots
 */
export function computeLevels(
  candles: Candle[],
  pivots: Pivot[],
  atr: number[],
  cfg: LevelConfig = DEFAULT_LEVEL_CONFIG
): LevelZone[] {
  if (pivots.length < 2) return [];
  
  const currentIdx = candles.length - 1;
  const currentPrice = candles[currentIdx].close;
  const currentATR = atr[currentIdx] || atr[atr.length - 1] || 0;
  const bandWidth = currentATR * cfg.atrBandMult;
  
  // Cluster pivots by price proximity
  const clusters = clusterPivotsByPrice(pivots, bandWidth);
  
  // Convert clusters to levels
  const levels: LevelZone[] = [];
  
  for (const cluster of clusters) {
    if (cluster.length < cfg.minTouches) continue;
    
    // Calculate cluster center (weighted by strength)
    let totalWeight = 0;
    let weightedPrice = 0;
    let lastTouchTs = 0;
    
    for (const p of cluster) {
      const weight = p.strength + 0.1; // prevent zero weights
      totalWeight += weight;
      weightedPrice += p.price * weight;
      if (p.ts > lastTouchTs) lastTouchTs = p.ts;
    }
    
    const centerPrice = totalWeight > 0 ? weightedPrice / totalWeight : cluster[0].price;
    
    // Determine level type based on pivot types in cluster
    const highCount = cluster.filter(p => p.type === "HIGH").length;
    const lowCount = cluster.filter(p => p.type === "LOW").length;
    
    let levelType: LevelZone["type"] = "BOTH";
    if (highCount > lowCount * 2) levelType = "RESISTANCE";
    else if (lowCount > highCount * 2) levelType = "SUPPORT";
    
    // Calculate strength
    const touchScore = Math.min(1, cluster.length / 5); // more touches = stronger
    const avgStrength = cluster.reduce((s, p) => s + p.strength, 0) / cluster.length;
    const recencyScore = calculateRecencyScore(lastTouchTs, currentIdx, candles);
    
    // Distance from current price affects relevance
    const distanceFromPrice = Math.abs(centerPrice - currentPrice) / currentPrice;
    const proximityScore = Math.max(0, 1 - distanceFromPrice * 5); // levels far away get lower score
    
    const strength = (
      touchScore * 0.35 +
      avgStrength / 3 * 0.25 +
      recencyScore * 0.25 +
      proximityScore * 0.15
    );
    
    levels.push({
      id: generateId('level'),
      price: Math.round(centerPrice * 100) / 100,
      band: Math.round(bandWidth * 100) / 100,
      touches: cluster.length,
      lastTouchTs,
      strength: Math.round(strength * 100) / 100,
      type: levelType,
    });
  }
  
  // Sort by strength and limit
  return levels
    .sort((a, b) => b.strength - a.strength)
    .slice(0, cfg.maxLevels);
}

/**
 * Cluster pivots by price proximity (DBSCAN-like)
 */
function clusterPivotsByPrice(pivots: Pivot[], threshold: number): Pivot[][] {
  const clusters: Pivot[][] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < pivots.length; i++) {
    if (used.has(i)) continue;
    
    const cluster: Pivot[] = [pivots[i]];
    used.add(i);
    
    // Find all pivots within threshold
    for (let j = i + 1; j < pivots.length; j++) {
      if (used.has(j)) continue;
      
      // Check if pivot is close to any in cluster
      const isNear = cluster.some(cp => 
        Math.abs(cp.price - pivots[j].price) <= threshold
      );
      
      if (isNear) {
        cluster.push(pivots[j]);
        used.add(j);
      }
    }
    
    clusters.push(cluster);
  }
  
  return clusters;
}

/**
 * Calculate recency score (more recent = higher score)
 */
function calculateRecencyScore(lastTouchTs: number, currentIdx: number, candles: Candle[]): number {
  if (candles.length === 0) return 0;
  
  const currentTs = candles[currentIdx].ts;
  const firstTs = candles[0].ts;
  const totalRange = currentTs - firstTs;
  
  if (totalRange <= 0) return 1;
  
  const age = currentTs - lastTouchTs;
  const ageRatio = age / totalRange;
  
  // More recent touches get higher score
  return Math.max(0, 1 - ageRatio * 0.8);
}

/**
 * Find nearest support level below current price
 */
export function findNearestSupport(levels: LevelZone[], currentPrice: number): LevelZone | null {
  const supports = levels
    .filter(l => (l.type === "SUPPORT" || l.type === "BOTH") && l.price < currentPrice)
    .sort((a, b) => b.price - a.price); // descending by price
  
  return supports[0] || null;
}

/**
 * Find nearest resistance level above current price
 */
export function findNearestResistance(levels: LevelZone[], currentPrice: number): LevelZone | null {
  const resistances = levels
    .filter(l => (l.type === "RESISTANCE" || l.type === "BOTH") && l.price > currentPrice)
    .sort((a, b) => a.price - b.price); // ascending by price
  
  return resistances[0] || null;
}

/**
 * Check if price is at a level (within band)
 */
export function isAtLevel(price: number, level: LevelZone): boolean {
  const halfBand = level.band / 2;
  return price >= level.price - halfBand && price <= level.price + halfBand;
}

/**
 * Get all levels price is currently at
 */
export function getLevelsAtPrice(levels: LevelZone[], price: number): LevelZone[] {
  return levels.filter(l => isAtLevel(price, l));
}

/**
 * Calculate distance to nearest level (in price units)
 */
export function distanceToNearestLevel(levels: LevelZone[], currentPrice: number): {
  toSupport: number | null;
  toResistance: number | null;
} {
  const support = findNearestSupport(levels, currentPrice);
  const resistance = findNearestResistance(levels, currentPrice);
  
  return {
    toSupport: support ? currentPrice - support.price : null,
    toResistance: resistance ? resistance.price - currentPrice : null,
  };
}
