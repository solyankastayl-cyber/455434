/**
 * BLOCK 21 — Portfolio-Aware Filtering Types
 * ===========================================
 * 
 * Diversification and risk-aware filtering.
 */

import type { Venue, Direction, AltFacet } from '../types.js';
import type { AltOppScore } from '../alt-opps/alt-opps.types.js';

// ═══════════════════════════════════════════════════════════════
// DIVERSIFICATION CONSTRAINTS
// ═══════════════════════════════════════════════════════════════

export interface DiversificationConstraints {
  maxPerPattern: number;       // Max picks from same pattern
  maxPerSector: number;        // Max picks from same sector (AI, L2, MEME...)
  maxPerDirection: number;     // Max longs or shorts
  maxCorrelation: number;      // Max avg correlation between picks
  minUniquePatterns: number;   // Require at least N different patterns
}

export const DEFAULT_DIVERSIFICATION: DiversificationConstraints = {
  maxPerPattern: 3,
  maxPerSector: 4,
  maxPerDirection: 7,
  maxCorrelation: 0.7,
  minUniquePatterns: 2,
};

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO PICK
// ═══════════════════════════════════════════════════════════════

export interface PortfolioPick {
  symbol: string;
  venue: Venue;
  
  // Scoring
  score: number;
  adjustedScore: number;      // After diversification penalty
  rank: number;
  
  // Signal
  direction: Direction;
  expectedMove: string;
  confidence: number;
  
  // Diversification info
  patternId: string;
  sector: string;
  correlationPenalty: number;
  
  // Meta
  reasons: string[];
  excluded: boolean;
  excludeReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO SLATE
// ═══════════════════════════════════════════════════════════════

export interface PortfolioSlate {
  asOf: number;
  venue: Venue;
  
  // Picks
  picks: PortfolioPick[];
  excluded: PortfolioPick[];
  
  // Stats
  totalCandidates: number;
  finalCount: number;
  
  // Diversification
  uniquePatterns: number;
  uniqueSectors: number;
  avgCorrelation: number;
  directionBalance: { longs: number; shorts: number };
  
  // Quality
  avgScore: number;
  avgConfidence: number;
}

// ═══════════════════════════════════════════════════════════════
// SECTOR MAPPING
// ═══════════════════════════════════════════════════════════════

export const SECTOR_MAP: Record<string, string> = {
  // Layer 1
  'BTCUSDT': 'L1', 'ETHUSDT': 'L1', 'SOLUSDT': 'L1', 'AVAXUSDT': 'L1',
  'ADAUSDT': 'L1', 'DOTUSDT': 'L1', 'NEARUSDT': 'L1', 'ATOMUSDT': 'L1',
  'APTUSDT': 'L1', 'SUIUSDT': 'L1', 'SEIUSDT': 'L1', 'INJUSDT': 'L1',
  
  // Layer 2
  'ARBUSDT': 'L2', 'OPUSDT': 'L2', 'MATICUSDT': 'L2', 'STXUSDT': 'L2',
  'MANTAUSDT': 'L2', 'METISUSDT': 'L2',
  
  // DeFi
  'UNIUSDT': 'DEFI', 'AAVEUSDT': 'DEFI', 'LINKUSDT': 'DEFI', 'MKRUSDT': 'DEFI',
  'SNXUSDT': 'DEFI', 'COMPUSDT': 'DEFI', 'CRVUSDT': 'DEFI', '1INCHUSDT': 'DEFI',
  
  // AI
  'FETUSDT': 'AI', 'AGIXUSDT': 'AI', 'OCEANUSDT': 'AI', 'RENDERUSDT': 'AI',
  'TAOUSDT': 'AI', 'AKASHUSDT': 'AI',
  
  // Gaming/Metaverse
  'AXSUSDT': 'GAMING', 'SANDUSDT': 'GAMING', 'MANAUSDT': 'GAMING',
  'GALAUSDT': 'GAMING', 'IMXUSDT': 'GAMING',
  
  // Memes
  'DOGEUSDT': 'MEME', 'SHIBUSDT': 'MEME', 'PEPEUSDT': 'MEME',
  'BONKUSDT': 'MEME', 'FLOKIUSDT': 'MEME', 'WIFUSDT': 'MEME',
};

export function getSector(symbol: string): string {
  return SECTOR_MAP[symbol.toUpperCase()] ?? 'OTHER';
}

// ═══════════════════════════════════════════════════════════════
// CORRELATION HELPERS
// ═══════════════════════════════════════════════════════════════

export function estimateCorrelation(sector1: string, sector2: string): number {
  if (sector1 === sector2) return 0.85;
  
  // High correlation pairs
  const highCorr = [
    ['L1', 'L2'], ['DEFI', 'L1'], ['MEME', 'MEME'],
  ];
  
  for (const pair of highCorr) {
    if ((pair[0] === sector1 && pair[1] === sector2) ||
        (pair[1] === sector1 && pair[0] === sector2)) {
      return 0.7;
    }
  }
  
  // Medium correlation
  const medCorr = [['AI', 'L1'], ['GAMING', 'L1']];
  for (const pair of medCorr) {
    if ((pair[0] === sector1 && pair[1] === sector2) ||
        (pair[1] === sector1 && pair[0] === sector2)) {
      return 0.5;
    }
  }
  
  // Default low correlation
  return 0.3;
}

console.log('[Block21] Portfolio-Aware Filtering Types loaded');
