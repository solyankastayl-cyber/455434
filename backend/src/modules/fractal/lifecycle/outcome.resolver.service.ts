/**
 * BLOCK 56.3 — Outcome Resolver Service
 * 
 * Resolves signal snapshots after T+7/14/30 days.
 * Key operations:
 * - Find unresolved snapshots
 * - Get forward close price
 * - Calculate realized return
 * - Determine hit/miss
 * - Update calibration bins
 * 
 * Principles:
 * - Idempotent (skip already resolved)
 * - Forward only (no backfill)
 * - Immutable outcomes (write once per horizon)
 */

import { SignalSnapshotModel, type SignalSnapshotDocument } from '../storage/signal-snapshot.schema.js';
import { CanonicalStore } from '../data/canonical.store.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HorizonDays = 7 | 14 | 30;

interface OutcomeData {
  realizedReturn: number;
  hit: boolean;
  resolvedAt: Date;
  closeAsof: number;
  closeForward: number;
}

interface ResolveItem {
  snapshotId: string;
  preset: string;
  asofDate: string;
  action: string;
  expectedReturn: number;
  realizedReturn: number;
  hit: boolean;
  status: 'resolved' | 'skipped' | 'no_data';
  reason?: string;
}

export interface ResolveResult {
  symbol: string;
  horizon: HorizonDays;
  resolved: number;
  skipped: number;
  noData: number;
  details: ResolveItem[];
}

interface CalibrationBin {
  bin: number;
  wins: number;
  total: number;
  winRate: number;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class OutcomeResolverService {
  private canonicalStore = new CanonicalStore();
  
  /**
   * Get close price for a specific date
   */
  async getClosePrice(symbol: string, date: Date): Promise<number | null> {
    try {
      // Find candle for the date
      const startOfDay = new Date(date);
      startOfDay.setUTCHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      
      const candles = await this.canonicalStore.getRange(symbol, '1d', startOfDay, endOfDay);
      
      if (candles.length === 0) {
        // Try getting closest candle
        const nearbyCandles = await this.canonicalStore.getRange(
          symbol, '1d',
          new Date(date.getTime() - 2 * 24 * 60 * 60 * 1000),
          new Date(date.getTime() + 2 * 24 * 60 * 60 * 1000)
        );
        
        if (nearbyCandles.length > 0) {
          // Find closest candle to target date
          let closest = nearbyCandles[0];
          let minDiff = Math.abs(closest.ts.getTime() - date.getTime());
          
          for (const c of nearbyCandles) {
            const diff = Math.abs(c.ts.getTime() - date.getTime());
            if (diff < minDiff) {
              minDiff = diff;
              closest = c;
            }
          }
          
          return closest.ohlcv.c;
        }
        
        return null;
      }
      
      return candles[0].ohlcv.c;
    } catch (err) {
      console.error(`[OutcomeResolver] Failed to get close for ${date.toISOString()}:`, err);
      return null;
    }
  }
  
  /**
   * Calculate forward date
   */
  getForwardDate(asofDate: Date, horizon: HorizonDays): Date {
    const forward = new Date(asofDate);
    forward.setDate(forward.getDate() + horizon);
    return forward;
  }
  
  /**
   * Determine hit/miss based on action and realized return
   */
  determineHit(action: string, realizedReturn: number, threshold = 0.02): boolean {
    switch (action) {
      case 'LONG':
        return realizedReturn > 0;
      case 'SHORT':
        return realizedReturn < 0;
      case 'HOLD':
      case 'NO_TRADE':
      default:
        // For HOLD, hit = small move (within threshold)
        return Math.abs(realizedReturn) < threshold;
    }
  }
  
  /**
   * Check if horizon is already resolved
   */
  isHorizonResolved(snapshot: SignalSnapshotDocument, horizon: HorizonDays): boolean {
    const outcomes = (snapshot as any).outcomes;
    if (!outcomes) return false;
    
    const horizonKey = `${horizon}d`;
    return outcomes[horizonKey]?.resolvedAt != null;
  }
  
  /**
   * Find snapshots eligible for resolution
   */
  async findEligibleSnapshots(
    symbol: string,
    horizon: HorizonDays,
    modelType: 'ACTIVE' | 'SHADOW' = 'ACTIVE'
  ): Promise<SignalSnapshotDocument[]> {
    const today = new Date();
    const cutoffDate = new Date(today);
    cutoffDate.setDate(cutoffDate.getDate() - horizon);
    
    // Find snapshots where asofDate <= cutoffDate
    const snapshots = await SignalSnapshotModel.find({
      symbol,
      modelType,
      asOf: { $lte: cutoffDate }
    }).sort({ asOf: 1 }).lean();
    
    // Filter out already resolved for this horizon
    return snapshots.filter(s => !this.isHorizonResolved(s, horizon));
  }
  
  /**
   * Resolve a single snapshot for a given horizon
   */
  async resolveSnapshot(
    snapshot: SignalSnapshotDocument,
    horizon: HorizonDays
  ): Promise<ResolveItem> {
    const asofDate = new Date(snapshot.asOf);
    const forwardDate = this.getForwardDate(asofDate, horizon);
    
    // Get prices
    const closeAsof = await this.getClosePrice(snapshot.symbol, asofDate);
    const closeForward = await this.getClosePrice(snapshot.symbol, forwardDate);
    
    if (closeAsof === null || closeForward === null) {
      return {
        snapshotId: (snapshot as any)._id.toString(),
        preset: snapshot.strategy.preset,
        asofDate: asofDate.toISOString().slice(0, 10),
        action: snapshot.action,
        expectedReturn: snapshot.expectedReturn,
        realizedReturn: 0,
        hit: false,
        status: 'no_data',
        reason: `Missing price data: asof=${closeAsof}, forward=${closeForward}`
      };
    }
    
    // Calculate realized return
    const realizedReturn = (closeForward - closeAsof) / closeAsof;
    
    // Determine hit/miss
    const hit = this.determineHit(snapshot.action, realizedReturn);
    
    // Build outcome data
    const outcomeData: OutcomeData = {
      realizedReturn,
      hit,
      resolvedAt: new Date(),
      closeAsof,
      closeForward
    };
    
    // Update snapshot
    const horizonKey = `${horizon}d`;
    await SignalSnapshotModel.updateOne(
      { _id: (snapshot as any)._id },
      {
        $set: {
          [`outcomes.${horizonKey}`]: outcomeData,
          resolved: true
        }
      }
    );
    
    return {
      snapshotId: (snapshot as any)._id.toString(),
      preset: snapshot.strategy.preset,
      asofDate: asofDate.toISOString().slice(0, 10),
      action: snapshot.action,
      expectedReturn: snapshot.expectedReturn,
      realizedReturn,
      hit,
      status: 'resolved'
    };
  }
  
  /**
   * Resolve all eligible snapshots for a symbol and horizon
   * Resolves both ACTIVE and SHADOW models
   */
  async resolveSnapshots(
    symbol: string,
    horizon: HorizonDays
  ): Promise<ResolveResult> {
    console.log(`[OutcomeResolver] Resolving ${symbol} snapshots for ${horizon}d horizon`);
    
    // Find ACTIVE snapshots
    const activeEligible = await this.findEligibleSnapshots(symbol, horizon, 'ACTIVE');
    // Find SHADOW snapshots
    const shadowEligible = await this.findEligibleSnapshots(symbol, horizon, 'SHADOW');
    
    const allEligible = [...activeEligible, ...shadowEligible];
    console.log(`[OutcomeResolver] Found ${allEligible.length} eligible snapshots (${activeEligible.length} ACTIVE, ${shadowEligible.length} SHADOW)`);
    
    const details: ResolveItem[] = [];
    let resolved = 0;
    let skipped = 0;
    let noData = 0;
    
    for (const snapshot of allEligible) {
      const item = await this.resolveSnapshot(snapshot, horizon);
      details.push(item);
      
      if (item.status === 'resolved') resolved++;
      else if (item.status === 'skipped') skipped++;
      else if (item.status === 'no_data') noData++;
    }
    
    console.log(`[OutcomeResolver] Done: resolved=${resolved}, skipped=${skipped}, noData=${noData}`);
    
    return {
      symbol,
      horizon,
      resolved,
      skipped,
      noData,
      details
    };
  }
  
  /**
   * Get calibration bins from resolved snapshots
   */
  async getCalibrationBins(
    symbol: string,
    horizon: HorizonDays
  ): Promise<CalibrationBin[]> {
    const horizonKey = `${horizon}d`;
    
    const snapshots = await SignalSnapshotModel.find({
      symbol,
      modelType: 'ACTIVE',
      [`outcomes.${horizonKey}.resolvedAt`]: { $exists: true }
    }).lean();
    
    // Initialize bins (0-10 representing 0-10%, 10-20%, ..., 90-100%)
    const bins: Map<number, { wins: number; total: number }> = new Map();
    for (let i = 0; i <= 10; i++) {
      bins.set(i, { wins: 0, total: 0 });
    }
    
    for (const snapshot of snapshots) {
      const conf = snapshot.confidence;
      const binIdx = Math.min(10, Math.floor(conf * 10));
      
      const outcomes = (snapshot as any).outcomes;
      const outcome = outcomes?.[horizonKey];
      
      if (outcome) {
        const bin = bins.get(binIdx)!;
        bin.total++;
        if (outcome.hit) bin.wins++;
      }
    }
    
    // Convert to array
    return Array.from(bins.entries()).map(([bin, data]) => ({
      bin,
      wins: data.wins,
      total: data.total,
      winRate: data.total > 0 ? data.wins / data.total : 0
    }));
  }
  
  /**
   * Get forward performance stats
   */
  async getForwardStats(
    symbol: string,
    horizon: HorizonDays
  ): Promise<{
    totalResolved: number;
    hitRate: number;
    avgRealizedReturn: number;
    avgExpectedReturn: number;
    calibrationError: number;
  }> {
    const horizonKey = `${horizon}d`;
    
    const snapshots = await SignalSnapshotModel.find({
      symbol,
      modelType: 'ACTIVE',
      [`outcomes.${horizonKey}.resolvedAt`]: { $exists: true }
    }).lean();
    
    if (snapshots.length === 0) {
      return {
        totalResolved: 0,
        hitRate: 0,
        avgRealizedReturn: 0,
        avgExpectedReturn: 0,
        calibrationError: 0
      };
    }
    
    let hits = 0;
    let totalRealizedReturn = 0;
    let totalExpectedReturn = 0;
    let totalCalibrationError = 0;
    
    for (const snapshot of snapshots) {
      const outcomes = (snapshot as any).outcomes;
      const outcome = outcomes?.[horizonKey];
      
      if (outcome) {
        if (outcome.hit) hits++;
        totalRealizedReturn += outcome.realizedReturn;
        totalExpectedReturn += snapshot.expectedReturn;
        
        // Calibration error: |confidence - actual hit rate|
        // Simplified: |confidence - hit|
        const hitNum = outcome.hit ? 1 : 0;
        totalCalibrationError += Math.abs(snapshot.confidence - hitNum);
      }
    }
    
    return {
      totalResolved: snapshots.length,
      hitRate: hits / snapshots.length,
      avgRealizedReturn: totalRealizedReturn / snapshots.length,
      avgExpectedReturn: totalExpectedReturn / snapshots.length,
      calibrationError: totalCalibrationError / snapshots.length
    };
  }
  
  /**
   * Get Active vs Shadow comparison
   */
  async getActiveVsShadow(
    symbol: string,
    horizon: HorizonDays
  ): Promise<{
    active: { hits: number; total: number; avgReturn: number };
    shadow: { hits: number; total: number; avgReturn: number };
    deltaHitRate: number;
    deltaReturn: number;
  }> {
    const horizonKey = `${horizon}d`;
    
    // Get active snapshots
    const activeSnapshots = await SignalSnapshotModel.find({
      symbol,
      modelType: 'ACTIVE',
      [`outcomes.${horizonKey}.resolvedAt`]: { $exists: true }
    }).lean();
    
    // Get shadow snapshots
    const shadowSnapshots = await SignalSnapshotModel.find({
      symbol,
      modelType: 'SHADOW',
      [`outcomes.${horizonKey}.resolvedAt`]: { $exists: true }
    }).lean();
    
    const calcStats = (snaps: any[]) => {
      let hits = 0;
      let totalReturn = 0;
      
      for (const s of snaps) {
        const outcome = s.outcomes?.[horizonKey];
        if (outcome) {
          if (outcome.hit) hits++;
          totalReturn += outcome.realizedReturn;
        }
      }
      
      return {
        hits,
        total: snaps.length,
        avgReturn: snaps.length > 0 ? totalReturn / snaps.length : 0
      };
    };
    
    const active = calcStats(activeSnapshots);
    const shadow = calcStats(shadowSnapshots);
    
    const activeHitRate = active.total > 0 ? active.hits / active.total : 0;
    const shadowHitRate = shadow.total > 0 ? shadow.hits / shadow.total : 0;
    
    return {
      active,
      shadow,
      deltaHitRate: shadowHitRate - activeHitRate,
      deltaReturn: shadow.avgReturn - active.avgReturn
    };
  }
}

// Export singleton
export const outcomeResolverService = new OutcomeResolverService();
