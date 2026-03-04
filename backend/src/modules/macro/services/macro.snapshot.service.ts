/**
 * Macro Snapshot Service
 * 
 * Aggregates data from all macro providers into a unified snapshot
 */

import {
  MacroSnapshot,
  DataQuality,
  DataQualityMode,
} from '../contracts/macro.types.js';
import { fetchFearGreedIndex, getCachedFearGreed } from '../providers/feargreed.provider.js';
import { fetchDominanceData, getCachedDominance } from '../providers/dominance.provider.js';

const SNAPSHOT_CACHE_TTL_MS = 60 * 1000; // 1 minute

// In-memory snapshot cache
let cachedSnapshot: MacroSnapshot | null = null;
let cacheTimestamp = 0;

function determineOverallQuality(
  fearGreedMode: DataQualityMode,
  dominanceMode: DataQualityMode,
  missing: string[]
): DataQuality {
  // If both are NO_DATA, overall is NO_DATA
  if (fearGreedMode === 'NO_DATA' && dominanceMode === 'NO_DATA') {
    return { mode: 'NO_DATA', missing };
  }
  
  // If both are LIVE, overall is LIVE
  if (fearGreedMode === 'LIVE' && dominanceMode === 'LIVE') {
    return { mode: 'LIVE', missing };
  }
  
  // If one is DEGRADED or both are CACHED, overall is DEGRADED
  if (fearGreedMode === 'DEGRADED' || dominanceMode === 'DEGRADED') {
    return { mode: 'DEGRADED', missing };
  }
  
  // Otherwise CACHED
  return { mode: 'CACHED', missing };
}

function determineRiskMode(
  fearGreedLabel: string,
  btcDelta24h?: number,
  stableDelta24h?: number
): { riskMode: 'RISK_ON' | 'RISK_OFF' | 'RANGE' | 'UNKNOWN'; drivers: string[] } {
  const drivers: string[] = [];
  let riskOnScore = 0;
  let riskOffScore = 0;
  
  // Fear & Greed contribution
  if (fearGreedLabel === 'EXTREME_FEAR') {
    riskOffScore += 2;
    drivers.push('Extreme Fear');
  } else if (fearGreedLabel === 'FEAR') {
    riskOffScore += 1;
    drivers.push('Fear');
  } else if (fearGreedLabel === 'GREED') {
    riskOnScore += 1;
    drivers.push('Greed');
  } else if (fearGreedLabel === 'EXTREME_GREED') {
    riskOnScore += 2;
    drivers.push('Extreme Greed');
  }
  
  // BTC Dominance contribution (rising = risk-off, falling = risk-on)
  if (btcDelta24h !== undefined) {
    if (btcDelta24h > 0.5) {
      riskOffScore += 1;
      drivers.push('BTC Dom rising');
    } else if (btcDelta24h < -0.5) {
      riskOnScore += 1;
      drivers.push('BTC Dom falling');
    }
  }
  
  // Stablecoin Dominance contribution (rising = risk-off, falling = risk-on)
  if (stableDelta24h !== undefined) {
    if (stableDelta24h > 0.3) {
      riskOffScore += 1;
      drivers.push('Stable inflow');
    } else if (stableDelta24h < -0.3) {
      riskOnScore += 1;
      drivers.push('Stable outflow');
    }
  }
  
  // Determine overall mode
  const diff = riskOnScore - riskOffScore;
  if (diff >= 2) return { riskMode: 'RISK_ON', drivers };
  if (diff <= -2) return { riskMode: 'RISK_OFF', drivers };
  if (drivers.length === 0) return { riskMode: 'UNKNOWN', drivers };
  return { riskMode: 'RANGE', drivers };
}

export async function getMacroSnapshot(forceRefresh = false): Promise<MacroSnapshot> {
  const now = Date.now();
  
  // Return cached if still valid and not forced
  if (!forceRefresh && cachedSnapshot && (now - cacheTimestamp) < SNAPSHOT_CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  // Fetch both data sources in parallel
  const [fearGreedResult, dominanceResult] = await Promise.all([
    fetchFearGreedIndex(),
    fetchDominanceData(),
  ]);

  const missing: string[] = [
    ...fearGreedResult.quality.missing,
    ...dominanceResult.quality.missing,
  ];

  // Build snapshot with defaults for missing data
  const fearGreed = fearGreedResult.data || {
    value: 50,
    label: 'NEUTRAL' as const,
    timestamp: now,
  };

  const dominance = dominanceResult.dominance || {
    btcPct: 45,
    stablePct: 10,
    timestamp: now,
  };

  const rsi = dominanceResult.rsi;

  // Determine regime hints
  const regimeHints = determineRiskMode(
    fearGreed.label,
    dominance.btcDelta24h,
    dominance.stableDelta24h
  );

  const snapshot: MacroSnapshot = {
    ts: now,
    source: 'alternative.me + coingecko',
    quality: determineOverallQuality(
      fearGreedResult.quality.mode,
      dominanceResult.quality.mode,
      missing
    ),
    fearGreed,
    dominance,
    rsi,
    regimeHints,
  };

  // Update cache
  cachedSnapshot = snapshot;
  cacheTimestamp = now;

  console.log(`[MacroSnapshot] Built: FG=${fearGreed.value}(${fearGreed.label}), BTC=${dominance.btcPct.toFixed(1)}%, mode=${snapshot.quality.mode}`);

  return snapshot;
}

// Get current cached snapshot (no refresh)
export function getCurrentSnapshot(): MacroSnapshot | null {
  return cachedSnapshot;
}

// Clear all caches (for testing)
export function clearSnapshotCache(): void {
  cachedSnapshot = null;
  cacheTimestamp = 0;
}
