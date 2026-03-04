/**
 * BLOCK 24 — Cross-Asset Pattern Propagation Types
 * =================================================
 * 
 * Identify assets that follow successful patterns from peers.
 */

import type { Venue, Direction, Horizon } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// PATTERN PROPAGATION
// ═══════════════════════════════════════════════════════════════

export interface PatternPropagation {
  patternId: string;
  patternLabel: string;
  
  // Origin assets (already moved)
  originAssets: Array<{
    symbol: string;
    returnPct: number;
    movedAt: number;
  }>;
  
  // Candidate assets (similar pattern, not yet moved)
  candidateAssets: Array<{
    symbol: string;
    similarity: number;
    expectedMove: number;
    confidence: number;
  }>;
  
  // Pattern stats
  avgOriginReturn: number;
  successRate: number;
  propagationDelay: number;   // Avg time between origin and candidate moves
  
  // Quality
  originCount: number;
  candidateCount: number;
  signalStrength: number;     // 0-1
}

// ═══════════════════════════════════════════════════════════════
// PROPAGATION SIGNAL
// ═══════════════════════════════════════════════════════════════

export interface PropagationSignal {
  symbol: string;
  venue: Venue;
  
  // Pattern reference
  patternId: string;
  patternLabel: string;
  
  // Signal
  direction: Direction;
  expectedMove: { min: number; max: number };
  confidence: number;
  
  // Evidence
  leadingAssets: Array<{
    symbol: string;
    returnPct: number;
    timeAgo: number;
  }>;
  
  // Why
  reasons: string[];
  
  // Timing
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  optimalEntryWindow: number;   // ms
  
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// CAPP RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface CAPPResponse {
  ok: boolean;
  asOf: number;
  venue: Venue;
  
  // Active propagations
  propagations: PatternPropagation[];
  
  // Top signals
  signals: PropagationSignal[];
  
  // Stats
  activePatternsCount: number;
  totalLeadingAssets: number;
  totalCandidates: number;
  avgPropagationDelay: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export const CAPP_CONFIG = {
  minOriginReturn: 3,           // Min % return for origin asset
  minOriginCount: 2,            // Min assets to establish pattern
  maxPropagationWindow: 24,     // Hours to look for propagation
  minSimilarity: 0.7,           // Min similarity for candidate
  minSuccessRate: 0.5,          // Min historical success rate
} as const;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

export function calculateSignalStrength(
  originCount: number,
  avgReturn: number,
  successRate: number
): number {
  // More origins = stronger signal
  const countFactor = Math.min(1, originCount / 5);
  
  // Higher returns = stronger signal
  const returnFactor = Math.min(1, avgReturn / 10);
  
  // Success rate direct factor
  const successFactor = successRate;
  
  return (countFactor * 0.3 + returnFactor * 0.3 + successFactor * 0.4);
}

export function determineUrgency(
  avgPropagationDelay: number,
  timeSinceOrigin: number
): 'HIGH' | 'MEDIUM' | 'LOW' {
  const ratio = timeSinceOrigin / avgPropagationDelay;
  
  if (ratio < 0.5) return 'HIGH';   // Early in window
  if (ratio < 0.8) return 'MEDIUM'; // Mid window
  return 'LOW';                      // Late in window
}

console.log('[Block24] Cross-Asset Pattern Propagation Types loaded');
