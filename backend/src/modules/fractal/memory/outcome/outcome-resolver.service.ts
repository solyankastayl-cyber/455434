/**
 * BLOCK 75.2 — Outcome Resolver Service
 * 
 * Resolves matured prediction snapshots with forward truth.
 * Idempotent: skip already resolved.
 * 
 * Algorithm:
 * 1. Find snapshots where maturityDate <= today AND outcome not exists
 * 2. Get entry/exit prices from candles
 * 3. Calculate realizedReturn
 * 4. Determine hit/miss per tier
 * 5. Write outcome (immutable)
 */

import { PredictionSnapshotModel, type PredictionSnapshotDocument, type FocusHorizon, type SnapshotRole, type SnapshotPreset, type TierType } from '../snapshot/prediction-snapshot.model.js';
import { PredictionOutcomeModel, type PredictionOutcomeDocument, type OutcomeLabel, type TierTruth, type PredictedState } from './prediction-outcome.model.js';
import { CanonicalStore } from '../../data/canonical.store.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Threshold for UP/DOWN/FLAT labeling (0.25%)
const DIRECTION_THRESHOLD = 0.25;

// Threshold for HOLD hit (1%)
const FLAT_BAND = 1.0;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ResolveOutcomesResult {
  symbol: string;
  latestCandleDate: string;
  resolved: number;
  skipped: number;
  noData: number;
  byFocus: Record<FocusHorizon, number>;
  reasons: { not_matured: number; already_resolved: number; no_price: number };
}

export interface ForwardStats {
  totalResolved: number;
  hitRate: number;
  avgRealizedReturnPct: number;
  byPreset: Record<SnapshotPreset, { hitRate: number; avgReturn: number; count: number }>;
  byRole: Record<SnapshotRole, { hitRate: number; avgReturn: number; count: number }>;
  byVolRegime: Record<string, { hitRate: number; avgReturn: number; count: number }>;
  byPhaseType: Record<string, { hitRate: number; avgReturn: number; count: number }>;
  byDivergenceGrade: Record<string, { hitRate: number; avgReturn: number; count: number }>;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class OutcomeResolverService {
  private canonicalStore = new CanonicalStore();
  
  /**
   * Get latest candle date
   */
  async getLatestCandleDate(symbol: string): Promise<string> {
    const latestTs = await this.canonicalStore.getLatestTs(symbol, '1d');
    if (!latestTs) {
      throw new Error(`No candle data for ${symbol}`);
    }
    return latestTs.toISOString().slice(0, 10);
  }
  
  /**
   * Get close price for a date
   */
  async getClosePrice(symbol: string, dateStr: string): Promise<number | null> {
    try {
      const date = new Date(dateStr);
      const startOfDay = new Date(date);
      startOfDay.setUTCHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      
      const candles = await this.canonicalStore.getRange(symbol, '1d', startOfDay, endOfDay);
      
      if (candles.length > 0) {
        return candles[0].ohlcv.c;
      }
      
      // Try nearby dates
      const nearbyStart = new Date(date.getTime() - 2 * 24 * 60 * 60 * 1000);
      const nearbyEnd = new Date(date.getTime() + 2 * 24 * 60 * 60 * 1000);
      const nearbyCandles = await this.canonicalStore.getRange(symbol, '1d', nearbyStart, nearbyEnd);
      
      if (nearbyCandles.length > 0) {
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
    } catch (err) {
      console.error(`[OutcomeResolver] Failed to get price for ${dateStr}:`, err);
      return null;
    }
  }
  
  /**
   * Compute direction label from realized return
   */
  computeLabel(realizedReturnPct: number): OutcomeLabel {
    if (realizedReturnPct > DIRECTION_THRESHOLD) return 'UP';
    if (realizedReturnPct < -DIRECTION_THRESHOLD) return 'DOWN';
    return 'FLAT';
  }
  
  /**
   * Compute hit based on predicted direction and realized return
   */
  computeHit(predictedDirection: string, realizedReturnPct: number): boolean {
    switch (predictedDirection) {
      case 'BUY':
        return realizedReturnPct > 0;
      case 'SELL':
        return realizedReturnPct < 0;
      case 'HOLD':
      default:
        return Math.abs(realizedReturnPct) < FLAT_BAND;
    }
  }
  
  /**
   * Compute tier-level truth
   */
  computeTierTruth(
    snapshot: PredictionSnapshotDocument,
    realizedReturnPct: number
  ): TierTruth[] {
    const label = this.computeLabel(realizedReturnPct);
    const tierWeights = snapshot.tierWeights;
    
    const tiers: TierType[] = ['STRUCTURE', 'TACTICAL', 'TIMING'];
    const result: TierTruth[] = [];
    
    for (const tier of tiers) {
      let predictedDirection: 'BULLISH' | 'BEARISH' | 'FLAT' = 'FLAT';
      let weight = 0;
      
      if (tier === 'STRUCTURE') {
        predictedDirection = tierWeights.structuralDirection;
        weight = tierWeights.structureWeightSum;
      } else if (tier === 'TACTICAL') {
        predictedDirection = tierWeights.tacticalDirection;
        weight = tierWeights.tacticalWeightSum;
      } else if (tier === 'TIMING') {
        predictedDirection = tierWeights.timingDirection;
        weight = tierWeights.timingWeightSum;
      }
      
      // Determine hit
      let hit = false;
      if (predictedDirection === 'BULLISH' && label === 'UP') hit = true;
      else if (predictedDirection === 'BEARISH' && label === 'DOWN') hit = true;
      else if (predictedDirection === 'FLAT' && label === 'FLAT') hit = true;
      
      result.push({ tier, predictedDirection, weight, hit });
    }
    
    return result;
  }
  
  /**
   * Compute band hit
   */
  computeBandHit(
    realizedReturnPct: number,
    distribution?: { p10?: number; p50?: number; p90?: number }
  ): 'P10_P90' | 'P25_P75' | 'OUTSIDE' | 'NA' {
    if (!distribution || distribution.p10 == null || distribution.p90 == null) {
      return 'NA';
    }
    
    const p10 = distribution.p10;
    const p90 = distribution.p90;
    
    if (realizedReturnPct >= p10 && realizedReturnPct <= p90) {
      return 'P10_P90';
    }
    
    return 'OUTSIDE';
  }
  
  /**
   * Build predicted state from snapshot
   */
  buildPredictedState(snapshot: PredictionSnapshotDocument): PredictedState {
    const kd = snapshot.kernelDigest;
    const dist = snapshot.distribution;
    
    return {
      direction: kd.direction,
      finalSize: kd.finalSize,
      consensusIndex: kd.consensusIndex,
      divergenceScore: kd.divergenceScore,
      phaseGrade: kd.phaseGrade,
      volRegime: kd.volRegime,
      structuralLock: kd.structuralLock,
      dominance: kd.dominance,
      p10: dist?.p10,
      p50: dist?.p50,
      p90: dist?.p90
    };
  }
  
  /**
   * Check if outcome already exists
   */
  async outcomeExists(
    symbol: string,
    asofDate: string,
    focus: FocusHorizon,
    role: SnapshotRole,
    preset: SnapshotPreset
  ): Promise<boolean> {
    const count = await PredictionOutcomeModel.countDocuments({
      symbol,
      asofDate,
      focus,
      role,
      preset
    });
    return count > 0;
  }
  
  /**
   * Resolve single snapshot
   */
  async resolveSnapshot(
    snapshot: PredictionSnapshotDocument,
    latestCandleDate: string
  ): Promise<'resolved' | 'skipped' | 'not_matured' | 'no_price'> {
    const { symbol, asofDate, focus, role, preset, maturityDate } = snapshot;
    
    // Check if matured
    if (maturityDate > latestCandleDate) {
      return 'not_matured';
    }
    
    // Idempotency check
    const exists = await this.outcomeExists(symbol, asofDate, focus, role, preset);
    if (exists) {
      return 'skipped';
    }
    
    // Get prices
    const entryPrice = await this.getClosePrice(symbol, asofDate);
    const exitPrice = await this.getClosePrice(symbol, maturityDate);
    
    if (entryPrice === null || exitPrice === null) {
      return 'no_price';
    }
    
    // Calculate realized return
    const realizedReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    
    // Compute labels
    const label = this.computeLabel(realizedReturnPct);
    const hit = this.computeHit(snapshot.kernelDigest.direction, realizedReturnPct);
    const tierTruth = this.computeTierTruth(snapshot, realizedReturnPct);
    const bandHit = this.computeBandHit(realizedReturnPct, snapshot.distribution);
    const predicted = this.buildPredictedState(snapshot);
    
    // Create outcome
    const outcome: Partial<PredictionOutcomeDocument> = {
      symbol: 'BTC',
      asofDate,
      focus,
      role,
      preset,
      maturityDate,
      entryPrice,
      exitPrice,
      realizedReturnPct,
      hit,
      label,
      directionTruth: label,
      bandHit,
      predicted,
      tierTruth,
      meta: {
        volRegime: snapshot.kernelDigest.volRegime,
        phaseType: snapshot.kernelDigest.phaseType,
        divergenceGrade: snapshot.kernelDigest.divergenceGrade,
        confidence: snapshot.horizonVotes.find(v => v.horizon === focus)?.confidence,
        entropy: snapshot.horizonVotes.find(v => v.horizon === focus)?.entropy
      },
      resolvedAt: new Date()
    };
    
    await PredictionOutcomeModel.create(outcome);
    return 'resolved';
  }
  
  /**
   * Resolve all matured snapshots (main entry point)
   */
  async resolveMaturedOutcomes(symbol: string = 'BTC', max: number = 500): Promise<ResolveOutcomesResult> {
    const latestCandleDate = await this.getLatestCandleDate(symbol);
    console.log(`[OutcomeResolver] Resolving outcomes for ${symbol}, latestCandle=${latestCandleDate}`);
    
    // Find snapshots that might need resolution
    const snapshots = await PredictionSnapshotModel.find({
      symbol,
      maturityDate: { $lte: latestCandleDate }
    }).limit(max * 2).lean() as PredictionSnapshotDocument[];
    
    const byFocus: Record<FocusHorizon, number> = {
      '7d': 0, '14d': 0, '30d': 0, '90d': 0, '180d': 0, '365d': 0
    };
    const reasons = { not_matured: 0, already_resolved: 0, no_price: 0 };
    let resolved = 0;
    let skipped = 0;
    let noData = 0;
    
    for (const snapshot of snapshots) {
      if (resolved >= max) break;
      
      const result = await this.resolveSnapshot(snapshot, latestCandleDate);
      
      switch (result) {
        case 'resolved':
          resolved++;
          byFocus[snapshot.focus]++;
          break;
        case 'skipped':
          skipped++;
          reasons.already_resolved++;
          break;
        case 'not_matured':
          reasons.not_matured++;
          break;
        case 'no_price':
          noData++;
          reasons.no_price++;
          break;
      }
    }
    
    console.log(`[OutcomeResolver] Done: resolved=${resolved}, skipped=${skipped}, noData=${noData}`);
    
    return {
      symbol,
      latestCandleDate,
      resolved,
      skipped,
      noData,
      byFocus,
      reasons
    };
  }
  
  /**
   * Get forward stats (aggregated)
   */
  async getForwardStats(
    symbol: string,
    from?: string,
    to?: string,
    focus?: FocusHorizon
  ): Promise<ForwardStats> {
    const query: any = { symbol };
    if (from && to) {
      query.asofDate = { $gte: from, $lte: to };
    }
    if (focus) {
      query.focus = focus;
    }
    
    const outcomes = await PredictionOutcomeModel.find(query).lean() as PredictionOutcomeDocument[];
    
    const totalResolved = outcomes.length;
    if (totalResolved === 0) {
      return {
        totalResolved: 0,
        hitRate: 0,
        avgRealizedReturnPct: 0,
        byPreset: {} as any,
        byRole: {} as any,
        byVolRegime: {},
        byPhaseType: {},
        byDivergenceGrade: {}
      };
    }
    
    // Aggregate
    const hits = outcomes.filter(o => o.hit).length;
    const avgReturn = outcomes.reduce((sum, o) => sum + o.realizedReturnPct, 0) / totalResolved;
    
    // Group by functions
    const groupBy = (key: (o: PredictionOutcomeDocument) => string) => {
      const groups: Record<string, { hits: number; total: number; sumReturn: number }> = {};
      
      for (const o of outcomes) {
        const k = key(o);
        if (!groups[k]) groups[k] = { hits: 0, total: 0, sumReturn: 0 };
        groups[k].total++;
        if (o.hit) groups[k].hits++;
        groups[k].sumReturn += o.realizedReturnPct;
      }
      
      const result: Record<string, { hitRate: number; avgReturn: number; count: number }> = {};
      for (const [k, v] of Object.entries(groups)) {
        result[k] = {
          hitRate: v.total > 0 ? v.hits / v.total : 0,
          avgReturn: v.total > 0 ? v.sumReturn / v.total : 0,
          count: v.total
        };
      }
      return result;
    };
    
    return {
      totalResolved,
      hitRate: hits / totalResolved,
      avgRealizedReturnPct: avgReturn,
      byPreset: groupBy(o => o.preset) as any,
      byRole: groupBy(o => o.role) as any,
      byVolRegime: groupBy(o => o.meta?.volRegime || 'UNKNOWN'),
      byPhaseType: groupBy(o => o.meta?.phaseType || 'UNKNOWN'),
      byDivergenceGrade: groupBy(o => o.meta?.divergenceGrade || 'UNKNOWN')
    };
  }
  
  /**
   * Get calibration stats
   */
  async getCalibrationStats(
    symbol: string,
    focus: FocusHorizon,
    preset: SnapshotPreset = 'balanced'
  ): Promise<{
    hitRate: number;
    bandHitRate: number;
    avgError: number;
    count: number;
  }> {
    const outcomes = await PredictionOutcomeModel.find({
      symbol,
      focus,
      preset
    }).lean() as PredictionOutcomeDocument[];
    
    const count = outcomes.length;
    if (count === 0) {
      return { hitRate: 0, bandHitRate: 0, avgError: 0, count: 0 };
    }
    
    const hits = outcomes.filter(o => o.hit).length;
    const bandHits = outcomes.filter(o => o.bandHit === 'P10_P90' || o.bandHit === 'P25_P75').length;
    
    // Calculate avg error (|expected - realized|)
    let totalError = 0;
    for (const o of outcomes) {
      const expected = o.predicted.p50 || 0;
      totalError += Math.abs(expected - o.realizedReturnPct);
    }
    
    return {
      hitRate: hits / count,
      bandHitRate: bandHits / count,
      avgError: totalError / count,
      count
    };
  }
}

export const outcomeResolverService = new OutcomeResolverService();
