/**
 * DXY FORWARD OUTCOME RESOLVER
 * 
 * D4.2 — Resolves outcomes for forward signals
 * 
 * ISOLATION: DXY only. No BTC/SPX imports.
 */

import { DXY_ASSET } from '../dxy-forward.constants.js';
import { DxyForwardSignalModel } from '../models/dxy_forward_signal.model.js';
import { DxyForwardOutcomeModel } from '../models/dxy_forward_outcome.model.js';
import { getAllDxyCandles } from '../../services/dxy-chart.service.js';
import type { DxyForwardSignal, DxyForwardOutcome } from '../dxy-forward.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME RESOLVER
// ═══════════════════════════════════════════════════════════════

export interface ResolveResult {
  asset: string;
  attempted: number;
  resolved: number;
  skippedExists: number;
  skippedFuture: number;
  missingPricePoints: number;
  errors: Array<{ asOf: string; horizonDays: number; error: string }>;
}

/**
 * Resolve outcomes for all unresolved signals
 * 
 * For each signal:
 * 1. Calculate targetDate = asOf + horizonDays
 * 2. If targetDate > latestCandleDate → skip (future)
 * 3. Get entryPrice (close on asOf) and exitPrice (close on targetDate)
 * 4. Calculate realizedReturn = (exit/entry - 1)
 * 5. Upsert outcome
 */
export async function resolveDxyOutcomes(limit = 500): Promise<ResolveResult> {
  // Get all candles for price lookup
  const candles = await getAllDxyCandles();
  
  if (candles.length === 0) {
    return {
      asset: DXY_ASSET,
      attempted: 0,
      resolved: 0,
      skippedExists: 0,
      skippedFuture: 0,
      missingPricePoints: 0,
      errors: [{ asOf: '', horizonDays: 0, error: 'No candles available' }],
    };
  }
  
  // Build price lookup map
  const priceMap = new Map<string, number>();
  for (const c of candles) {
    priceMap.set(c.date, c.close);
  }
  
  const latestCandleDate = candles[candles.length - 1].date;
  
  // Get signals that don't have outcomes yet
  const existingOutcomes = await DxyForwardOutcomeModel
    .find({ asset: DXY_ASSET })
    .select({ asOf: 1, horizonDays: 1 })
    .lean();
  
  const existingKeys = new Set(
    existingOutcomes.map(o => `${o.asOf}|${o.horizonDays}`)
  );
  
  // Get all signals
  const signals = await DxyForwardSignalModel
    .find({ asset: DXY_ASSET })
    .sort({ asOf: 1 })
    .limit(limit)
    .lean() as DxyForwardSignal[];
  
  let attempted = 0;
  let resolved = 0;
  let skippedExists = 0;
  let skippedFuture = 0;
  let missingPricePoints = 0;
  const errors: Array<{ asOf: string; horizonDays: number; error: string }> = [];
  
  for (const signal of signals) {
    attempted++;
    
    const key = `${signal.asOf}|${signal.horizonDays}`;
    
    // Skip if outcome already exists
    if (existingKeys.has(key)) {
      skippedExists++;
      continue;
    }
    
    // Calculate target date
    const targetDate = addDays(signal.asOf, signal.horizonDays);
    
    // Check if target date is in the future
    if (targetDate > latestCandleDate) {
      skippedFuture++;
      continue;
    }
    
    // Get prices
    const entryPrice = priceMap.get(signal.asOf);
    const exitPrice = priceMap.get(targetDate);
    
    // Try nearest dates if exact not found
    let actualEntryPrice = entryPrice;
    let actualExitPrice = exitPrice;
    
    if (!actualEntryPrice) {
      // Find nearest price before asOf
      for (let i = 0; i < 5; i++) {
        const tryDate = addDays(signal.asOf, -i);
        if (priceMap.has(tryDate)) {
          actualEntryPrice = priceMap.get(tryDate);
          break;
        }
      }
    }
    
    if (!actualExitPrice) {
      // Find nearest price before targetDate
      for (let i = 0; i < 5; i++) {
        const tryDate = addDays(targetDate, -i);
        if (priceMap.has(tryDate)) {
          actualExitPrice = priceMap.get(tryDate);
          break;
        }
      }
    }
    
    if (!actualEntryPrice || !actualExitPrice) {
      missingPricePoints++;
      errors.push({
        asOf: signal.asOf,
        horizonDays: signal.horizonDays,
        error: `Missing price: entry=${!!actualEntryPrice} exit=${!!actualExitPrice}`,
      });
      continue;
    }
    
    // Calculate realized return
    const realizedReturn = (actualExitPrice / actualEntryPrice) - 1;
    
    // Create outcome
    const outcome: Omit<DxyForwardOutcome, 'createdAt' | 'updatedAt'> = {
      asset: DXY_ASSET,
      asOf: signal.asOf,
      horizonDays: signal.horizonDays,
      targetDate,
      entryPrice: actualEntryPrice,
      exitPrice: actualExitPrice,
      realizedReturn,
      isResolved: true,
      resolvedAt: new Date(),
      wasFutureAtResolve: false,
    };
    
    try {
      await DxyForwardOutcomeModel.updateOne(
        { asset: DXY_ASSET, asOf: signal.asOf, horizonDays: signal.horizonDays },
        { $set: outcome },
        { upsert: true }
      );
      
      resolved++;
      existingKeys.add(key); // Mark as resolved
      
    } catch (e: any) {
      errors.push({
        asOf: signal.asOf,
        horizonDays: signal.horizonDays,
        error: e?.message || String(e),
      });
    }
  }
  
  return {
    asset: DXY_ASSET,
    attempted,
    resolved,
    skippedExists,
    skippedFuture,
    missingPricePoints,
    errors,
  };
}

/**
 * Get outcome statistics
 */
export async function getDxyOutcomeStats(): Promise<{
  total: number;
  resolved: number;
  byHorizon: Array<{ horizonDays: number; count: number }>;
}> {
  const total = await DxyForwardOutcomeModel.countDocuments({ asset: DXY_ASSET });
  const resolved = await DxyForwardOutcomeModel.countDocuments({ asset: DXY_ASSET, isResolved: true });
  
  const byHorizon = await DxyForwardOutcomeModel.aggregate([
    { $match: { asset: DXY_ASSET } },
    { $group: { _id: '$horizonDays', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { horizonDays: '$_id', count: 1, _id: 0 } },
  ]);
  
  return { total, resolved, byHorizon };
}
