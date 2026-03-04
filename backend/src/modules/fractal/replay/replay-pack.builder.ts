/**
 * BLOCK 73.4 — Replay Pack Builder
 * 
 * Generates replay data for a specific historical match.
 * Used when user clicks on a match chip in the UI.
 */

import { buildReplayPathForMatch, type PathPoint } from '../path/unified-path.builder.js';
import { calculateDivergence } from '../engine/divergence.service.js';
import type { OverlayMatch, DivergenceMetrics, AxisMode } from '../focus/focus.types.js';

export interface MatchOutcome {
  horizon: string;
  return: number;
  maxDD: number;
  hitTarget: boolean;
}

export interface ReplayPack {
  matchId: string;
  matchMeta: {
    similarity: number;
    phase: string;
    date: string;
    score?: number;
  };
  replayPath: PathPoint[];
  outcomes: MatchOutcome[];
  divergence: DivergenceMetrics;
}

/**
 * Build replay pack for a specific match
 */
export function buildReplayPack(
  match: OverlayMatch,
  syntheticPath: PathPoint[],
  anchorPrice: number,
  horizonDays: number,
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE'
): ReplayPack {
  // Build replay path from match aftermath
  const replayPath = buildReplayPathForMatch(anchorPrice, horizonDays, match);
  
  // Calculate divergence between synthetic and this replay
  const syntheticPrices = syntheticPath.slice(1).map(p => p.price);
  const replayPrices = replayPath.slice(1).map(p => p.price);
  
  const mode: AxisMode = tier === 'STRUCTURE' ? 'PERCENT' : 'RAW';
  const divergence = calculateDivergence(
    syntheticPrices,
    replayPrices,
    anchorPrice,
    horizonDays,
    tier,
    mode
  );
  
  // Calculate outcomes at standard horizons
  const outcomes = calculateMatchOutcomes(match, replayPath, horizonDays);
  
  return {
    matchId: match.id,
    matchMeta: {
      similarity: match.similarity,
      phase: match.phase,
      date: match.id,
      score: match.similarity * 100
    },
    replayPath,
    outcomes,
    divergence
  };
}

/**
 * Calculate outcomes at standard horizon checkpoints
 */
function calculateMatchOutcomes(
  match: OverlayMatch,
  replayPath: PathPoint[],
  maxHorizon: number
): MatchOutcome[] {
  const horizons = [7, 14, 30, 90, 180, 365].filter(h => h <= maxHorizon);
  const outcomes: MatchOutcome[] = [];
  
  for (const h of horizons) {
    const point = replayPath[h];
    if (!point) continue;
    
    // Calculate max drawdown up to this horizon
    let maxDD = 0;
    let peak = replayPath[0].price;
    for (let i = 1; i <= h && i < replayPath.length; i++) {
      const price = replayPath[i].price;
      peak = Math.max(peak, price);
      const dd = (peak - price) / peak;
      maxDD = Math.max(maxDD, dd);
    }
    
    outcomes.push({
      horizon: `${h}d`,
      return: point.pct,
      maxDD: maxDD * 100,
      hitTarget: point.pct > 0 // Simple positive outcome check
    });
  }
  
  return outcomes;
}

export default {
  buildReplayPack
};
