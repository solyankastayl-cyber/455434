/**
 * BLOCK 73.5.1 — Phase Stats Service
 * 
 * Calculates statistics for each phase zone:
 * - Duration, return, volatility regime
 * - Matches count, best match within phase
 * 
 * Used for hover tooltips and phase drilldown.
 */

import type { OverlayMatch } from '../focus/focus.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type PhaseName = 
  | 'ACCUMULATION'
  | 'DISTRIBUTION' 
  | 'MARKUP'
  | 'MARKDOWN'
  | 'RECOVERY'
  | 'CAPITULATION'
  | 'UNKNOWN';

export interface PhaseZone {
  phase: PhaseName;
  from: string;     // ISO date
  to: string;       // ISO date
  color?: string;
}

export interface PhaseCandle {
  t: string;        // ISO date
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface PhaseStats {
  phaseId: string;           // Stable hash: phase_from_to
  phase: PhaseName;
  from: string;
  to: string;
  durationDays: number;
  phaseReturnPct: number;    // (close[to] - open[from]) / open[from] * 100
  volRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANSION' | 'CRISIS';
  matchesCount: number;
  matchIds: string[];
  bestMatchId: string | null;
  bestMatchSimilarity: number | null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate stats for all phase zones
 */
export function calculatePhaseStats(
  phaseZones: PhaseZone[],
  candles: PhaseCandle[],
  matches: OverlayMatch[],
  volRegimes?: Map<string, string>
): PhaseStats[] {
  if (!phaseZones?.length || !candles?.length) {
    return [];
  }

  // Build candle lookup by date
  const candleByDate = new Map<string, PhaseCandle>();
  for (const c of candles) {
    const dateKey = c.t.split('T')[0];
    candleByDate.set(dateKey, c);
  }

  const stats: PhaseStats[] = [];

  for (const zone of phaseZones) {
    const fromDate = zone.from.split('T')[0];
    const toDate = zone.to.split('T')[0];
    
    // Generate stable ID
    const phaseId = `${zone.phase}_${fromDate}_${toDate}`;
    
    // Calculate duration
    const fromTs = new Date(fromDate).getTime();
    const toTs = new Date(toDate).getTime();
    const durationDays = Math.round((toTs - fromTs) / (24 * 60 * 60 * 1000)) + 1;
    
    // Calculate return
    const fromCandle = candleByDate.get(fromDate);
    const toCandle = candleByDate.get(toDate);
    
    let phaseReturnPct = 0;
    if (fromCandle && toCandle && fromCandle.o > 0) {
      phaseReturnPct = ((toCandle.c - fromCandle.o) / fromCandle.o) * 100;
    }
    
    // Find matches within this phase
    const phaseMatches = matches.filter(m => {
      const matchDate = m.id.split('T')[0];
      return matchDate >= fromDate && matchDate <= toDate;
    });
    
    const matchIds = phaseMatches.map(m => m.id);
    
    // Find best match (highest similarity)
    let bestMatchId: string | null = null;
    let bestMatchSimilarity: number | null = null;
    
    if (phaseMatches.length > 0) {
      const sorted = [...phaseMatches].sort((a, b) => 
        (b.similarity || 0) - (a.similarity || 0)
      );
      bestMatchId = sorted[0].id;
      bestMatchSimilarity = sorted[0].similarity || null;
    }
    
    // Determine volatility regime (average or most common in period)
    let volRegime: PhaseStats['volRegime'] = 'NORMAL';
    if (volRegimes) {
      // Count regimes in this phase
      const regimeCounts: Record<string, number> = {};
      let current = new Date(fromDate);
      const end = new Date(toDate);
      
      while (current <= end) {
        const dateKey = current.toISOString().split('T')[0];
        const regime = volRegimes.get(dateKey) || 'NORMAL';
        regimeCounts[regime] = (regimeCounts[regime] || 0) + 1;
        current.setDate(current.getDate() + 1);
      }
      
      // Get most common regime
      let maxCount = 0;
      for (const [regime, count] of Object.entries(regimeCounts)) {
        if (count > maxCount) {
          maxCount = count;
          volRegime = regime as PhaseStats['volRegime'];
        }
      }
    }
    
    stats.push({
      phaseId,
      phase: zone.phase,
      from: zone.from,
      to: zone.to,
      durationDays,
      phaseReturnPct: Math.round(phaseReturnPct * 100) / 100,
      volRegime,
      matchesCount: phaseMatches.length,
      matchIds,
      bestMatchId,
      bestMatchSimilarity
    });
  }
  
  return stats;
}

/**
 * Filter matches by phase
 * Used for phase drilldown (BLOCK 73.5.2)
 */
export function filterMatchesByPhase(
  matches: OverlayMatch[],
  phaseId: string,
  phaseStats: PhaseStats[]
): OverlayMatch[] {
  const phase = phaseStats.find(p => p.phaseId === phaseId);
  if (!phase) return [];
  
  return matches.filter(m => phase.matchIds.includes(m.id));
}

export default {
  calculatePhaseStats,
  filterMatchesByPhase
};
