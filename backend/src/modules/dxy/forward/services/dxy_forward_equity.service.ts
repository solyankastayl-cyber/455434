/**
 * DXY FORWARD EQUITY SERVICE
 * 
 * D4.5 — Builds equity curve from forward performance
 * 
 * ISOLATION: DXY only. No BTC/SPX imports.
 */

import { DXY_ASSET } from '../dxy-forward.constants.js';
import { DxyForwardSignalModel } from '../models/dxy_forward_signal.model.js';
import { DxyForwardOutcomeModel } from '../models/dxy_forward_outcome.model.js';
import type { DxyForwardSignal, DxyForwardOutcome } from '../dxy-forward.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface EquityPoint {
  date: string;
  equity: number;
  isHit: boolean;
  realizedReturn: number;
  action: string;
  horizonDays: number;
}

export interface EquityCurve {
  asset: string;
  horizonDays: number | null; // null = all horizons
  window: string;
  points: EquityPoint[];
  summary: {
    startEquity: number;
    finalEquity: number;
    maxEquity: number;
    minEquity: number;
    maxDrawdown: number;
    maxDrawdownDate: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalReturn: number;
    avgReturn: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// HIT/MISS LOGIC
// ═══════════════════════════════════════════════════════════════

function isHit(action: string, realizedReturn: number): boolean {
  if (action === 'LONG') return realizedReturn > 0;
  if (action === 'SHORT') return realizedReturn < 0;
  return false;
}

function isActionable(action: string): boolean {
  return action === 'LONG' || action === 'SHORT';
}

// ═══════════════════════════════════════════════════════════════
// BUILD EQUITY CURVE
// ═══════════════════════════════════════════════════════════════

/**
 * Build equity curve for DXY forward performance
 * 
 * @param horizonDays - Filter by horizon (null = all horizons)
 * @param window - Time window filter (ALL, 1Y, 5Y, 10Y)
 * @param positionSize - Position size multiplier (default 1.0)
 */
export async function buildEquityCurve(params: {
  horizonDays?: number | null;
  window?: 'ALL' | '1Y' | '5Y' | '10Y';
  positionSize?: number;
}): Promise<EquityCurve> {
  const { horizonDays = null, window = 'ALL', positionSize = 1.0 } = params;
  
  // Build query
  const query: any = { asset: DXY_ASSET };
  
  if (horizonDays !== null) {
    query.horizonDays = horizonDays;
  }
  
  // Date filter
  if (window !== 'ALL') {
    const yearsBack = parseInt(window.replace('Y', ''));
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
    query.asOf = { $gte: cutoffDate.toISOString().slice(0, 10) };
  }
  
  // Get signals
  const signals = await DxyForwardSignalModel
    .find({ ...query })
    .sort({ asOf: 1 })
    .lean() as DxyForwardSignal[];
  
  // Get outcomes
  const outcomes = await DxyForwardOutcomeModel
    .find({ ...query, isResolved: true })
    .lean() as DxyForwardOutcome[];
  
  // Build outcome map
  const outcomeMap = new Map<string, DxyForwardOutcome>();
  for (const o of outcomes) {
    outcomeMap.set(`${o.asOf}|${o.horizonDays}`, o);
  }
  
  // Build equity curve
  const points: EquityPoint[] = [];
  let equity = 1.0;
  let peak = 1.0;
  let maxDD = 0;
  let maxDDDate = '';
  let maxEquity = 1.0;
  let minEquity = 1.0;
  let wins = 0;
  let losses = 0;
  
  for (const signal of signals) {
    // Skip non-actionable signals
    if (!isActionable(signal.action)) continue;
    
    // Get outcome
    const key = `${signal.asOf}|${signal.horizonDays}`;
    const outcome = outcomeMap.get(key);
    
    if (!outcome) continue;
    
    // Calculate return based on position
    const positionReturn = outcome.realizedReturn * positionSize;
    
    // Update equity
    equity *= (1 + positionReturn);
    
    // Track stats
    const hit = isHit(signal.action, outcome.realizedReturn);
    if (hit) {
      wins++;
    } else {
      losses++;
    }
    
    // Track peak and drawdown
    if (equity > peak) {
      peak = equity;
    }
    
    const dd = (peak - equity) / peak;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDDate = signal.asOf;
    }
    
    // Track min/max
    if (equity > maxEquity) maxEquity = equity;
    if (equity < minEquity) minEquity = equity;
    
    // Add point
    points.push({
      date: signal.asOf,
      equity: Math.round(equity * 10000) / 10000,
      isHit: hit,
      realizedReturn: Math.round(outcome.realizedReturn * 10000) / 10000,
      action: signal.action,
      horizonDays: signal.horizonDays,
    });
  }
  
  const trades = wins + losses;
  
  return {
    asset: DXY_ASSET,
    horizonDays,
    window,
    points,
    summary: {
      startEquity: 1.0,
      finalEquity: Math.round(equity * 10000) / 10000,
      maxEquity: Math.round(maxEquity * 10000) / 10000,
      minEquity: Math.round(minEquity * 10000) / 10000,
      maxDrawdown: Math.round(maxDD * 10000) / 10000,
      maxDrawdownDate: maxDDDate,
      trades,
      wins,
      losses,
      winRate: trades > 0 ? Math.round((wins / trades) * 10000) / 10000 : 0,
      totalReturn: Math.round((equity - 1) * 10000) / 10000,
      avgReturn: trades > 0 ? Math.round(((equity - 1) / trades) * 10000) / 10000 : 0,
    },
  };
}
