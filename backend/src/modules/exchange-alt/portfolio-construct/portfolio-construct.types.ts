/**
 * BLOCK 26 — Portfolio Construction Layer Types
 * ==============================================
 * 
 * Build concrete portfolios from opportunities.
 */

import type { Venue, Direction } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO POSITION
// ═══════════════════════════════════════════════════════════════

export interface PortfolioPosition {
  symbol: string;
  venue: Venue;
  
  // Allocation
  weight: number;           // 0-1 (fraction of portfolio)
  notional: number;         // USD value
  
  // Signal
  direction: Direction;
  confidence: number;
  
  // Risk
  maxLoss: number;          // % max loss before exit
  targetReturn: number;     // % target return
  horizon: '1h' | '4h' | '24h';
  
  // Meta
  patternId: string;
  sector: string;
  entryReason: string;
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO
// ═══════════════════════════════════════════════════════════════

export interface ConstructedPortfolio {
  id: string;
  timestamp: number;
  venue: Venue;
  
  // Positions
  positions: PortfolioPosition[];
  
  // Allocation stats
  totalNotional: number;
  longExposure: number;     // % of portfolio
  shortExposure: number;    // % of portfolio
  netExposure: number;      // long - short
  
  // Diversification
  uniqueSectors: number;
  uniquePatterns: number;
  concentrationRisk: number; // 0-1 (1 = concentrated)
  
  // Expected performance
  expectedReturn: number;
  expectedVolatility: number;
  sharpeEstimate: number;
  
  // Risk metrics
  maxDrawdown: number;
  valueAtRisk: number;
  
  // Metadata
  marketRegime: string;
  constraints: PortfolioConstraints;
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO CONSTRAINTS
// ═══════════════════════════════════════════════════════════════

export interface PortfolioConstraints {
  maxPositions: number;
  maxPositionSize: number;    // 0-1
  minPositionSize: number;    // 0-1
  maxLongExposure: number;    // 0-1
  maxShortExposure: number;   // 0-1
  maxSectorConcentration: number;
  maxPatternConcentration: number;
  targetNetExposure: number;  // -1 to 1
}

export const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  maxPositions: 5,
  maxPositionSize: 0.30,
  minPositionSize: 0.10,
  maxLongExposure: 0.80,
  maxShortExposure: 0.50,
  maxSectorConcentration: 0.40,
  maxPatternConcentration: 0.40,
  targetNetExposure: 0.30,
};

// ═══════════════════════════════════════════════════════════════
// WEIGHTING SCHEMES
// ═══════════════════════════════════════════════════════════════

export type WeightingScheme = 
  | 'EQUAL'           // Equal weight all positions
  | 'SCORE'           // Weight by opportunity score
  | 'RISK_PARITY'     // Weight inversely to volatility
  | 'CONFIDENCE'      // Weight by confidence
  | 'KELLY'           // Kelly criterion optimal
  | 'CUSTOM';

export interface WeightingConfig {
  scheme: WeightingScheme;
  kellyFraction: number;    // For KELLY scheme (0.25 = quarter Kelly)
  minWeight: number;
  maxWeight: number;
}

export const DEFAULT_WEIGHTING: WeightingConfig = {
  scheme: 'SCORE',
  kellyFraction: 0.25,
  minWeight: 0.10,
  maxWeight: 0.30,
};

// ═══════════════════════════════════════════════════════════════
// PCL RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface PCLResponse {
  ok: boolean;
  asOf: number;
  
  // Portfolio
  portfolio: ConstructedPortfolio;
  
  // Candidates considered
  candidatesConsidered: number;
  candidatesRejected: number;
  rejectionReasons: Array<{ symbol: string; reason: string }>;
  
  // Recommendations
  actionItems: string[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function calculateKellyWeight(
  winRate: number,
  avgWin: number,
  avgLoss: number,
  kellyFraction: number = 0.25
): number {
  if (avgLoss === 0) return 0;
  
  const b = avgWin / avgLoss; // Win/loss ratio
  const q = 1 - winRate;
  
  // Kelly formula: f* = (bp - q) / b
  const fullKelly = (b * winRate - q) / b;
  
  // Apply fraction
  return Math.max(0, fullKelly * kellyFraction);
}

export function calculateConcentrationRisk(positions: PortfolioPosition[]): number {
  if (positions.length === 0) return 0;
  
  const weights = positions.map(p => p.weight);
  const sumSquares = weights.reduce((sum, w) => sum + w * w, 0);
  
  // Herfindahl-Hirschman Index normalized
  // HHI = sum(w_i^2), range [1/n, 1]
  const hhi = sumSquares;
  const minHHI = 1 / positions.length;
  
  // Normalize to 0-1
  return (hhi - minHHI) / (1 - minHHI);
}

export function calculateExpectedReturn(positions: PortfolioPosition[]): number {
  return positions.reduce((sum, p) => {
    const directionMultiplier = p.direction === 'UP' ? 1 : -1;
    return sum + p.weight * p.targetReturn * directionMultiplier * p.confidence;
  }, 0);
}

console.log('[Block26] Portfolio Construction Layer Types loaded');
