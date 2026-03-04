/**
 * PHASE 1.4 — Truth Evaluator Service
 * =====================================
 * 
 * Core service for evaluating verdicts against actual price movements.
 * 
 * CONFIGURATION (LOCKED):
 * - HORIZON_BARS = 6 (how many bars forward to check)
 * - THRESHOLD = 0.02 (2% price move required)
 * 
 * LOGIC:
 * - BULLISH + price UP ≥2% → CONFIRMED
 * - BEARISH + price DOWN ≤-2% → CONFIRMED
 * - NEUTRAL + |price| <2% → CONFIRMED
 * - Opposite direction → DIVERGED
 * - Insufficient data → NO_DATA
 */

import { TruthRecordModel } from './truthRecord.model.js';
import { TruthRecord, TruthOutcome, PriceDirection, VerdictLabel, Timeframe, TruthStats, PriceBar } from './history.types.js';
import { getPriceBars, getTimeframeMs } from './priceHistory.service.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION (LOCKED - DO NOT CHANGE)
// ═══════════════════════════════════════════════════════════════

const HORIZON_BARS = 6;   // Check 6 bars forward
const THRESHOLD = 0.02;   // 2% price movement required

// ═══════════════════════════════════════════════════════════════
// TRUTH EVALUATION
// ═══════════════════════════════════════════════════════════════

interface VerdictToEvaluate {
  ts: number;
  verdict: VerdictLabel;
  confidence: number;
}

/**
 * Evaluate verdicts against price history and create truth records
 */
export async function evaluateVerdicts(params: {
  symbol: string;
  tf: Timeframe;
  verdicts: VerdictToEvaluate[];
  prices: PriceBar[];
}): Promise<{
  evaluated: number;
  confirmed: number;
  diverged: number;
  noData: number;
  records: TruthRecord[];
}> {
  const { symbol, tf, verdicts, prices } = params;
  
  if (prices.length < HORIZON_BARS + 1) {
    return { evaluated: 0, confirmed: 0, diverged: 0, noData: 0, records: [] };
  }
  
  // Index prices by timestamp
  const priceByTs = new Map(prices.map(p => [p.ts, p]));
  const sortedPrices = [...prices].sort((a, b) => a.ts - b.ts);
  
  // Helper to find price index at or after timestamp
  function findPriceIndex(ts: number): number {
    let lo = 0, hi = sortedPrices.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedPrices[mid].ts >= ts) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  }
  
  const records: TruthRecord[] = [];
  let confirmed = 0, diverged = 0, noData = 0;
  
  for (const v of verdicts) {
    // Skip if already evaluated
    const existing = await TruthRecordModel.findOne({
      symbol: symbol.toUpperCase(),
      tf,
      verdictTs: v.ts,
    }).lean();
    
    if (existing) continue;
    
    // Find price at t0
    const i0 = findPriceIndex(v.ts);
    if (i0 < 0 || i0 >= sortedPrices.length) {
      const record = createNoDataRecord(symbol, tf, v, 'NO_PRICE_AT_T0');
      records.push(record);
      noData++;
      continue;
    }
    
    // Find price at t1 (after horizon)
    const i1 = i0 + HORIZON_BARS;
    if (i1 >= sortedPrices.length) {
      const record = createNoDataRecord(symbol, tf, v, 'INSUFFICIENT_FUTURE_BARS');
      records.push(record);
      noData++;
      continue;
    }
    
    const priceAtT0 = sortedPrices[i0].c;
    const priceAtT1 = sortedPrices[i1].c;
    const priceChangePct = (priceAtT1 - priceAtT0) / priceAtT0;
    
    // Determine direction
    const priceDirection: PriceDirection = 
      priceChangePct > THRESHOLD / 2 ? 'UP' :
      priceChangePct < -THRESHOLD / 2 ? 'DOWN' : 'FLAT';
    
    // Evaluate outcome
    const { outcome, reason } = evaluateOutcome(v.verdict, priceChangePct);
    
    const record: TruthRecord = {
      symbol: symbol.toUpperCase(),
      tf,
      verdictTs: v.ts,
      verdict: v.verdict,
      confidence: v.confidence,
      evaluationTs: sortedPrices[i1].ts,
      horizonBars: HORIZON_BARS,
      threshold: THRESHOLD,
      priceAtT0,
      priceAtT1,
      priceChangePct,
      priceDirection,
      outcome,
      reason,
      createdAt: Date.now(),
    };
    
    records.push(record);
    
    if (outcome === 'CONFIRMED') confirmed++;
    else if (outcome === 'DIVERGED') diverged++;
    else noData++;
  }
  
  // Save records to database
  if (records.length > 0) {
    const ops = records.map(r => ({
      updateOne: {
        filter: { symbol: r.symbol, tf: r.tf, verdictTs: r.verdictTs },
        update: { $setOnInsert: r },
        upsert: true,
      },
    }));
    
    await TruthRecordModel.bulkWrite(ops, { ordered: false });
  }
  
  return {
    evaluated: records.length,
    confirmed,
    diverged,
    noData,
    records,
  };
}

/**
 * Evaluate outcome based on verdict and price change
 */
function evaluateOutcome(verdict: VerdictLabel, priceChangePct: number): {
  outcome: TruthOutcome;
  reason: string;
} {
  // Skip non-directional verdicts
  if (verdict === 'INCONCLUSIVE' || verdict === 'NO_DATA') {
    return { outcome: 'NO_DATA', reason: 'NON_DIRECTIONAL_VERDICT' };
  }
  
  // BULLISH verdict
  if (verdict === 'BULLISH') {
    if (priceChangePct >= THRESHOLD) {
      return { outcome: 'CONFIRMED', reason: `BULLISH_CONFIRMED_UP_${(priceChangePct * 100).toFixed(1)}%` };
    }
    if (priceChangePct <= -THRESHOLD) {
      return { outcome: 'DIVERGED', reason: `BULLISH_BUT_DOWN_${(priceChangePct * 100).toFixed(1)}%` };
    }
    return { outcome: 'CONFIRMED', reason: `BULLISH_FLAT_${(priceChangePct * 100).toFixed(1)}%` };
  }
  
  // BEARISH verdict
  if (verdict === 'BEARISH') {
    if (priceChangePct <= -THRESHOLD) {
      return { outcome: 'CONFIRMED', reason: `BEARISH_CONFIRMED_DOWN_${(priceChangePct * 100).toFixed(1)}%` };
    }
    if (priceChangePct >= THRESHOLD) {
      return { outcome: 'DIVERGED', reason: `BEARISH_BUT_UP_+${(priceChangePct * 100).toFixed(1)}%` };
    }
    return { outcome: 'CONFIRMED', reason: `BEARISH_FLAT_${(priceChangePct * 100).toFixed(1)}%` };
  }
  
  // NEUTRAL verdict
  if (verdict === 'NEUTRAL') {
    if (Math.abs(priceChangePct) >= THRESHOLD) {
      return { outcome: 'DIVERGED', reason: `NEUTRAL_BUT_MOVED_${(priceChangePct * 100).toFixed(1)}%` };
    }
    return { outcome: 'CONFIRMED', reason: `NEUTRAL_CONFIRMED_FLAT` };
  }
  
  return { outcome: 'NO_DATA', reason: 'UNKNOWN_VERDICT' };
}

/**
 * Create NO_DATA truth record
 */
function createNoDataRecord(
  symbol: string,
  tf: Timeframe,
  verdict: VerdictToEvaluate,
  reason: string
): TruthRecord {
  return {
    symbol: symbol.toUpperCase(),
    tf,
    verdictTs: verdict.ts,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    evaluationTs: 0,
    horizonBars: HORIZON_BARS,
    threshold: THRESHOLD,
    priceAtT0: 0,
    priceAtT1: 0,
    priceChangePct: 0,
    priceDirection: 'FLAT',
    outcome: 'NO_DATA',
    reason,
    createdAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// TRUTH RETRIEVAL
// ═══════════════════════════════════════════════════════════════

/**
 * Get truth records for a symbol
 */
export async function getTruthRecords(params: {
  symbol: string;
  tf?: Timeframe;
  from?: number;
  to?: number;
  outcome?: TruthOutcome;
  limit?: number;
}): Promise<TruthRecord[]> {
  const { symbol, tf, from, to, outcome, limit = 500 } = params;
  
  const query: any = { symbol: symbol.toUpperCase() };
  if (tf) query.tf = tf;
  if (outcome) query.outcome = outcome;
  if (from !== undefined || to !== undefined) {
    query.verdictTs = {};
    if (from !== undefined) query.verdictTs.$gte = from;
    if (to !== undefined) query.verdictTs.$lte = to;
  }
  
  const records = await TruthRecordModel.find(query)
    .sort({ verdictTs: -1 })
    .limit(limit)
    .lean();
  
  return records as TruthRecord[];
}

/**
 * Get truth statistics for a symbol
 */
export async function getTruthStats(params: {
  symbol: string;
  tf?: Timeframe;
  from?: number;
  to?: number;
}): Promise<TruthStats> {
  const { symbol, tf, from, to } = params;
  
  const query: any = { symbol: symbol.toUpperCase() };
  if (tf) query.tf = tf;
  if (from !== undefined || to !== undefined) {
    query.verdictTs = {};
    if (from !== undefined) query.verdictTs.$gte = from;
    if (to !== undefined) query.verdictTs.$lte = to;
  }
  
  const records = await TruthRecordModel.find(query).lean() as TruthRecord[];
  
  const total = records.length;
  const confirmed = records.filter(r => r.outcome === 'CONFIRMED').length;
  const diverged = records.filter(r => r.outcome === 'DIVERGED').length;
  const noData = records.filter(r => r.outcome === 'NO_DATA').length;
  
  const avgConfidence = total > 0
    ? records.reduce((sum, r) => sum + r.confidence, 0) / total
    : 0;
  
  const divergedRecords = records.filter(r => r.outcome === 'DIVERGED');
  const avgMagnitude = divergedRecords.length > 0
    ? divergedRecords.reduce((sum, r) => sum + Math.abs(r.priceChangePct), 0) / divergedRecords.length
    : 0;
  
  // By verdict stats
  const byVerdict = {
    BULLISH: { total: 0, confirmed: 0, diverged: 0 },
    BEARISH: { total: 0, confirmed: 0, diverged: 0 },
    NEUTRAL: { total: 0, confirmed: 0, diverged: 0 },
  };
  
  for (const r of records) {
    if (r.verdict in byVerdict) {
      byVerdict[r.verdict as keyof typeof byVerdict].total++;
      if (r.outcome === 'CONFIRMED') {
        byVerdict[r.verdict as keyof typeof byVerdict].confirmed++;
      } else if (r.outcome === 'DIVERGED') {
        byVerdict[r.verdict as keyof typeof byVerdict].diverged++;
      }
    }
  }
  
  return {
    symbol: symbol.toUpperCase(),
    tf: tf || '1h',
    total,
    confirmed,
    diverged,
    noData,
    confirmRate: total > 0 ? confirmed / total : 0,
    divergeRate: total > 0 ? diverged / total : 0,
    avgConfidence,
    avgMagnitude,
    byVerdict,
  };
}

console.log('[Phase 1.4] Truth Evaluator Service loaded');
