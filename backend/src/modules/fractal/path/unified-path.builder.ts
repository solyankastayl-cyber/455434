/**
 * BLOCK 73.3 — Unified Path Builder
 * 
 * Single source of truth for all trajectory rendering.
 * 
 * Key principle: t=0 is ALWAYS NOW (anchorPrice)
 * 
 * This eliminates:
 * - Sync issues between synthetic/replay
 * - Marker calculation discrepancies
 * - "Jump" artifacts when switching horizons
 */

import type { DistributionSeries, OverlayMatch } from '../focus/focus.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PathPoint {
  t: number;      // Day index (0 = NOW)
  price: number;  // Absolute price
  pct: number;    // % from NOW
}

export interface HorizonMarker {
  horizon: string;  // '7d', '14d', '30d', etc.
  t: number;        // Day index in path
  price: number;    // Absolute price
  pct: number;      // % return from NOW
}

export interface UnifiedPath {
  anchorPrice: number;
  anchorTs: number;
  horizonDays: number;
  
  // Main trajectories - ALWAYS length N+1 (t=0..N)
  syntheticPath: PathPoint[];
  replayPath: PathPoint[] | null;
  
  // Confidence bands - same length as paths
  upperBand: PathPoint[];
  lowerBand: PathPoint[];
  
  // Markers computed FROM syntheticPath
  markers: {
    d7?: HorizonMarker;
    d14?: HorizonMarker;
    d30?: HorizonMarker;
    d90?: HorizonMarker;
    d180?: HorizonMarker;
    d365?: HorizonMarker;
  };
  
  // For compatibility with existing frontend
  markersArray: HorizonMarker[];
}

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build unified path for a given horizon
 * 
 * @param anchorPrice - Current price (NOW)
 * @param horizonDays - Forecast horizon (7, 14, 30, 90, 180, 365)
 * @param distribution - Distribution series from overlay
 * @param primaryMatch - Primary historical match (optional)
 */
export function buildUnifiedPath(
  anchorPrice: number,
  horizonDays: number,
  distribution: DistributionSeries,
  primaryMatch?: OverlayMatch | null
): UnifiedPath {
  const anchorTs = Date.now();
  const N = horizonDays;
  
  // ═══════════════════════════════════════════════════════════════
  // 1. BUILD SYNTHETIC PATH (t=0..N)
  // ═══════════════════════════════════════════════════════════════
  
  const syntheticPath: PathPoint[] = [];
  
  // t=0 = NOW (anchor)
  syntheticPath.push({
    t: 0,
    price: anchorPrice,
    pct: 0
  });
  
  // t=1..N from distribution median
  for (let t = 1; t <= N; t++) {
    const idx = t - 1; // distribution[0] = day 1
    const pctReturn = distribution.p50[idx] ?? 0;
    syntheticPath.push({
      t,
      price: anchorPrice * (1 + pctReturn),
      pct: pctReturn * 100 // Convert to %
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 2. BUILD CONFIDENCE BANDS (t=0..N)
  // ═══════════════════════════════════════════════════════════════
  
  const upperBand: PathPoint[] = [];
  const lowerBand: PathPoint[] = [];
  
  // t=0 = NOW
  upperBand.push({ t: 0, price: anchorPrice, pct: 0 });
  lowerBand.push({ t: 0, price: anchorPrice, pct: 0 });
  
  // t=1..N
  for (let t = 1; t <= N; t++) {
    const idx = t - 1;
    
    // Upper: blend p75 + 0.5*(p90-p75)
    const p75 = distribution.p75[idx] ?? 0;
    const p90 = distribution.p90[idx] ?? p75;
    const upperPct = p75 + 0.5 * (p90 - p75);
    
    // Lower: blend p25 - 0.5*(p25-p10)
    const p25 = distribution.p25[idx] ?? 0;
    const p10 = distribution.p10[idx] ?? p25;
    const lowerPct = p25 - 0.5 * (p25 - p10);
    
    upperBand.push({
      t,
      price: anchorPrice * (1 + upperPct),
      pct: upperPct * 100
    });
    
    lowerBand.push({
      t,
      price: anchorPrice * (1 + lowerPct),
      pct: lowerPct * 100
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 3. BUILD REPLAY PATH (t=0..N) - from primary match
  // ═══════════════════════════════════════════════════════════════
  
  let replayPath: PathPoint[] | null = null;
  
  if (primaryMatch?.aftermathNormalized?.length) {
    replayPath = [];
    
    // t=0 = NOW (anchor)
    replayPath.push({
      t: 0,
      price: anchorPrice,
      pct: 0
    });
    
    // t=1..N from aftermath normalized returns
    for (let t = 1; t <= N; t++) {
      const idx = t - 1;
      const pctReturn = primaryMatch.aftermathNormalized[idx] ?? 0;
      replayPath.push({
        t,
        price: anchorPrice * (1 + pctReturn),
        pct: pctReturn * 100
      });
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 4. BUILD MARKERS FROM SYNTHETIC PATH
  // ═══════════════════════════════════════════════════════════════
  
  const markerHorizons = [7, 14, 30, 90, 180, 365];
  const markers: UnifiedPath['markers'] = {};
  const markersArray: HorizonMarker[] = [];
  
  for (const h of markerHorizons) {
    if (h > N) continue;
    
    // Get point directly from syntheticPath at t=h
    const point = syntheticPath[h];
    if (!point) continue;
    
    const marker: HorizonMarker = {
      horizon: `${h}d`,
      t: h,
      price: point.price,
      pct: point.pct
    };
    
    // Add to both formats
    const key = `d${h}` as keyof UnifiedPath['markers'];
    markers[key] = marker;
    markersArray.push(marker);
  }
  
  return {
    anchorPrice,
    anchorTs,
    horizonDays,
    syntheticPath,
    replayPath,
    upperBand,
    lowerBand,
    markers,
    markersArray
  };
}

// ═══════════════════════════════════════════════════════════════
// REPLAY PATH BUILDER (for match switching)
// ═══════════════════════════════════════════════════════════════

/**
 * Build replay path for a specific match
 * Used when user clicks on a different match in interactive mode
 */
export function buildReplayPathForMatch(
  anchorPrice: number,
  horizonDays: number,
  match: OverlayMatch
): PathPoint[] {
  const replayPath: PathPoint[] = [];
  const N = horizonDays;
  
  // t=0 = NOW
  replayPath.push({
    t: 0,
    price: anchorPrice,
    pct: 0
  });
  
  // t=1..N
  for (let t = 1; t <= N; t++) {
    const idx = t - 1;
    const pctReturn = match.aftermathNormalized?.[idx] ?? 0;
    replayPath.push({
      t,
      price: anchorPrice * (1 + pctReturn),
      pct: pctReturn * 100
    });
  }
  
  return replayPath;
}

// ═══════════════════════════════════════════════════════════════
// LEGACY ADAPTER (for backward compatibility)
// ═══════════════════════════════════════════════════════════════

/**
 * Convert UnifiedPath to legacy forecast format
 * This allows gradual migration without breaking existing frontend
 */
export function toLegacyForecast(unifiedPath: UnifiedPath) {
  return {
    // Legacy path format (N points, without t=0)
    // Frontend currently expects this
    path: unifiedPath.syntheticPath.slice(1).map(p => p.price),
    pricePath: unifiedPath.syntheticPath.slice(1).map(p => p.price),
    
    // Bands (N points)
    upperBand: unifiedPath.upperBand.slice(1).map(p => p.price),
    lowerBand: unifiedPath.lowerBand.slice(1).map(p => p.price),
    
    // Markers in legacy format
    markers: unifiedPath.markersArray.map(m => ({
      horizon: m.horizon,
      dayIndex: m.t - 1, // Legacy uses 0-indexed from day 1
      expectedReturn: m.pct / 100,
      price: m.price
    })),
    
    currentPrice: unifiedPath.anchorPrice,
    startTs: unifiedPath.anchorTs,
    
    // NEW: Include unified path for frontend upgrade
    unifiedPath: {
      anchorPrice: unifiedPath.anchorPrice,
      syntheticPath: unifiedPath.syntheticPath,
      replayPath: unifiedPath.replayPath,
      markers: unifiedPath.markers
    }
  };
}

export default {
  buildUnifiedPath,
  buildReplayPathForMatch,
  toLegacyForecast
};
