/**
 * PHASE 1.3 — Verdict History Service
 * =====================================
 * 
 * Fetches historical verdicts from Exchange and Meta-Brain.
 */

import { VerdictPoint, VerdictLabel, VerdictSource } from './chart.types.js';
import { MetaBrainDecisionModel } from '../../metaBrainV2/storage/metaBrainV2.model.js';

// ═══════════════════════════════════════════════════════════════
// VERDICT HISTORY FETCHING
// ═══════════════════════════════════════════════════════════════

export interface VerdictHistoryParams {
  symbol: string;
  from?: number;
  to?: number;
  limit?: number;
}

/**
 * Fetch verdict history from Meta-Brain decisions
 */
export async function getVerdictHistory(params: VerdictHistoryParams): Promise<VerdictPoint[]> {
  const { symbol, limit = 500 } = params;
  const from = params.from || 0;
  const to = params.to || Date.now();
  
  try {
    // Fetch from Meta-Brain decisions
    const decisions = await MetaBrainDecisionModel.find({
      symbol: symbol.toUpperCase(),
      t0: { $gte: from, $lte: to },
    })
    .sort({ t0: 1 })
    .limit(limit)
    .lean();
    
    // Map to VerdictPoint
    const verdicts: VerdictPoint[] = decisions.map((d: any) => ({
      ts: d.t0,
      verdict: mapFinalVerdictToLabel(d.finalVerdict),
      confidence: d.finalConfidence,
      source: 'META_BRAIN' as VerdictSource,
      strength: extractStrength(d.finalVerdict),
    }));
    
    return verdicts;
  } catch (error) {
    console.error(`[Verdict Service] Error fetching verdicts for ${symbol}:`, error);
    return [];
  }
}

/**
 * Map Meta-Brain FinalVerdict to simple VerdictLabel
 */
function mapFinalVerdictToLabel(finalVerdict: string): VerdictLabel {
  switch (finalVerdict) {
    case 'STRONG_BULLISH':
    case 'WEAK_BULLISH':
      return 'BULLISH';
    case 'STRONG_BEARISH':
    case 'WEAK_BEARISH':
      return 'BEARISH';
    case 'NEUTRAL':
      return 'NEUTRAL';
    case 'INCONCLUSIVE':
      return 'INCONCLUSIVE';
    default:
      return 'NO_DATA';
  }
}

/**
 * Extract strength from FinalVerdict
 */
function extractStrength(finalVerdict: string): string {
  if (finalVerdict.includes('STRONG')) return 'STRONG';
  if (finalVerdict.includes('WEAK')) return 'WEAK';
  return 'MODERATE';
}

/**
 * Generate mock verdict history for testing
 */
export function generateMockVerdictHistory(params: {
  symbol: string;
  from: number;
  to: number;
  intervalMs?: number;
}): VerdictPoint[] {
  const { symbol, from, to, intervalMs = 3600000 } = params;
  
  // Deterministic seed based on symbol
  const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  
  const verdicts: VerdictPoint[] = [];
  
  for (let ts = from; ts <= to; ts += intervalMs) {
    const hourSeed = Math.floor(ts / intervalMs);
    const combined = (hourSeed + seed) % 100;
    
    let verdict: VerdictLabel;
    let confidence: number;
    
    if (combined < 30) {
      verdict = 'BULLISH';
      confidence = 0.55 + (combined / 100) * 0.3;
    } else if (combined < 60) {
      verdict = 'BEARISH';
      confidence = 0.55 + ((combined - 30) / 100) * 0.3;
    } else {
      verdict = 'NEUTRAL';
      confidence = 0.40 + ((combined - 60) / 100) * 0.2;
    }
    
    verdicts.push({
      ts,
      verdict,
      confidence,
      source: 'META_BRAIN',
      strength: confidence > 0.7 ? 'STRONG' : 'MODERATE',
    });
  }
  
  return verdicts;
}

console.log('[Phase 1.3] Verdict History Service loaded');
