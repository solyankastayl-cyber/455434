/**
 * BLOCK 23 — Pattern Performance Memory Types
 * ============================================
 * 
 * Long-term memory of pattern effectiveness.
 */

import type { Venue, Horizon } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// PATTERN PERFORMANCE RECORD
// ═══════════════════════════════════════════════════════════════

export interface PatternPerformanceRecord {
  patternId: string;
  patternLabel: string;
  venue: Venue;
  
  // Core metrics
  hitRate: number;           // 0-1: % of wins
  avgReturn: number;         // Average return per trade
  medianReturn: number;      // Median return
  maxReturn: number;         // Best trade
  maxLoss: number;           // Worst trade
  
  // Volume metrics
  totalTrades: number;
  wins: number;
  losses: number;
  neutral: number;
  
  // Expectancy
  expectancy: number;        // hitRate * avgWin - (1-hitRate) * avgLoss
  sharpe: number;            // Risk-adjusted return
  
  // Time-bucketed performance
  byHorizon: Record<Horizon, {
    hitRate: number;
    avgReturn: number;
    samples: number;
  }>;
  
  // Recent performance (last 7 days)
  recent7d: {
    hitRate: number;
    avgReturn: number;
    trades: number;
  };
  
  // Regime-specific
  byRegime: Record<string, {
    hitRate: number;
    avgReturn: number;
    samples: number;
  }>;
  
  // Sector-specific
  bySector: Record<string, {
    hitRate: number;
    avgReturn: number;
    samples: number;
  }>;
  
  // Timestamps
  firstSeen: number;
  lastSeen: number;
  lastUpdated: number;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN OUTCOME RECORD
// ═══════════════════════════════════════════════════════════════

export interface PatternOutcomeRecord {
  id: string;
  patternId: string;
  symbol: string;
  venue: Venue;
  
  // Entry
  entryTime: number;
  entryPrice: number;
  direction: 'UP' | 'DOWN';
  confidence: number;
  
  // Context at entry
  regime: string;
  sector: string;
  
  // Exit
  horizon: Horizon;
  exitTime: number;
  exitPrice: number;
  returnPct: number;
  
  // Classification
  result: 'WIN' | 'LOSS' | 'NEUTRAL';
  
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// PPM QUERY
// ═══════════════════════════════════════════════════════════════

export interface PPMQuery {
  patternIds?: string[];
  venue?: Venue;
  minTrades?: number;
  minHitRate?: number;
  regime?: string;
  sector?: string;
  horizon?: Horizon;
  since?: number;            // Only patterns active after this time
}

// ═══════════════════════════════════════════════════════════════
// PPM STATS
// ═══════════════════════════════════════════════════════════════

export interface PPMStats {
  totalPatterns: number;
  activePatterns: number;    // With recent activity
  avgHitRate: number;
  avgExpectancy: number;
  totalOutcomes: number;
  
  topPatterns: Array<{
    patternId: string;
    label: string;
    hitRate: number;
    trades: number;
  }>;
  
  worstPatterns: Array<{
    patternId: string;
    label: string;
    hitRate: number;
    trades: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function calculateExpectancy(
  hitRate: number,
  avgWin: number,
  avgLoss: number
): number {
  return hitRate * avgWin - (1 - hitRate) * Math.abs(avgLoss);
}

export function classifyReturn(returnPct: number): 'WIN' | 'LOSS' | 'NEUTRAL' {
  if (returnPct >= 2) return 'WIN';
  if (returnPct <= -2) return 'LOSS';
  return 'NEUTRAL';
}

export function createEmptyRecord(
  patternId: string,
  patternLabel: string,
  venue: Venue
): PatternPerformanceRecord {
  const now = Date.now();
  
  return {
    patternId,
    patternLabel,
    venue,
    hitRate: 0,
    avgReturn: 0,
    medianReturn: 0,
    maxReturn: 0,
    maxLoss: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    neutral: 0,
    expectancy: 0,
    sharpe: 0,
    byHorizon: {
      '1h': { hitRate: 0, avgReturn: 0, samples: 0 },
      '4h': { hitRate: 0, avgReturn: 0, samples: 0 },
      '24h': { hitRate: 0, avgReturn: 0, samples: 0 },
    },
    recent7d: { hitRate: 0, avgReturn: 0, trades: 0 },
    byRegime: {},
    bySector: {},
    firstSeen: now,
    lastSeen: now,
    lastUpdated: now,
  };
}

console.log('[Block23] Pattern Performance Memory Types loaded');
