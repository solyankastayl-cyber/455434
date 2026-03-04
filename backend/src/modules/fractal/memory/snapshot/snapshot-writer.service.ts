/**
 * BLOCK 75.1 — Memory Snapshot Writer Service
 * 
 * Writes daily prediction snapshots for all 6 horizons.
 * Source of truth: /api/fractal/v2.1/terminal endpoint.
 * 
 * Principles:
 * - Write once, never mutate
 * - Idempotent (skip if exists)
 * - All 6 horizons × 3 presets × 2 roles = 36 snapshots/day
 */

import { PredictionSnapshotModel, type PredictionSnapshotDocument, type FocusHorizon, type SnapshotRole, type SnapshotPreset, type TierType } from './prediction-snapshot.model.js';
import { CanonicalStore } from '../../data/canonical.store.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const HORIZONS: FocusHorizon[] = ['7d', '14d', '30d', '90d', '180d', '365d'];
const PRESETS: SnapshotPreset[] = ['conservative', 'balanced', 'aggressive'];
const ROLES: SnapshotRole[] = ['ACTIVE', 'SHADOW'];

const HORIZON_TO_TIER: Record<FocusHorizon, TierType> = {
  '7d': 'TIMING',
  '14d': 'TIMING',
  '30d': 'TACTICAL',
  '90d': 'TACTICAL',
  '180d': 'STRUCTURE',
  '365d': 'STRUCTURE'
};

const HORIZON_DAYS: Record<FocusHorizon, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface WriteSnapshotResult {
  symbol: string;
  asofDate: string;
  written: number;
  skipped: number;
  focusBreakdown: Record<FocusHorizon, { written: number; skipped: number }>;
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class MemorySnapshotWriterService {
  private canonicalStore = new CanonicalStore();
  
  /**
   * Get latest candle date (asofDate)
   */
  async getLatestAsofDate(symbol: string): Promise<string> {
    const latestTs = await this.canonicalStore.getLatestTs(symbol, '1d');
    if (!latestTs) {
      throw new Error(`No candle data for ${symbol}`);
    }
    return latestTs.toISOString().slice(0, 10);
  }
  
  /**
   * Calculate maturity date
   */
  calculateMaturityDate(asofDate: string, focus: FocusHorizon): string {
    const date = new Date(asofDate);
    date.setDate(date.getDate() + HORIZON_DAYS[focus]);
    return date.toISOString().slice(0, 10);
  }
  
  /**
   * Fetch terminal payload from API
   */
  async fetchTerminalPayload(symbol: string, focus: FocusHorizon): Promise<any> {
    try {
      const url = `http://localhost:8002/api/fractal/v2.1/terminal?symbol=${symbol}&set=extended&focus=${focus}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      
      if (!response.ok) {
        console.warn(`[MemorySnapshot] Terminal fetch failed: ${response.status}`);
        return null;
      }
      
      return await response.json();
    } catch (err) {
      console.error(`[MemorySnapshot] Terminal fetch error:`, err);
      return null;
    }
  }
  
  /**
   * Extract kernel digest from terminal payload
   */
  extractKernelDigest(payload: any): any {
    const c74 = payload.consensus74 || {};
    const resolved = c74.resolved || {};
    const adaptiveMeta = c74.adaptiveMeta || {};
    const volatility = payload.volatility || {};
    const overlay = payload.overlay || {};
    
    // Map direction
    let direction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (resolved.action === 'BUY') direction = 'BUY';
    else if (resolved.action === 'SELL') direction = 'SELL';
    
    // Map mode
    let mode: 'TREND_FOLLOW' | 'COUNTER_TREND' | 'NO_TRADE' | 'WAIT' = 'WAIT';
    if (resolved.mode === 'TREND_FOLLOW') mode = 'TREND_FOLLOW';
    else if (resolved.mode === 'COUNTER_TREND') mode = 'COUNTER_TREND';
    else if (resolved.mode === 'COUNTER_SIGNAL_BLOCKED') mode = 'NO_TRADE';
    
    // Map conflict level
    let conflictLevel: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' = 'MODERATE';
    const cl = c74.conflictLevel || '';
    if (cl === 'NONE' || cl === 'STRUCTURAL_LOCK') conflictLevel = 'NONE';
    else if (cl === 'LOW') conflictLevel = 'LOW';
    else if (cl === 'MODERATE') conflictLevel = 'MODERATE';
    else if (cl === 'HIGH') conflictLevel = 'HIGH';
    else if (cl === 'SEVERE') conflictLevel = 'SEVERE';
    
    // Map dominance
    let dominance: TierType = 'TACTICAL';
    if (resolved.dominantTier === 'STRUCTURE') dominance = 'STRUCTURE';
    else if (resolved.dominantTier === 'TIMING') dominance = 'TIMING';
    
    // Get primary match
    const matches = overlay.matches || [];
    const primaryMatch = matches[0];
    
    return {
      direction,
      mode,
      finalSize: resolved.sizeMultiplier || 0,
      
      consensusIndex: c74.consensusIndex || 50,
      conflictLevel,
      structuralLock: c74.structuralLock || false,
      timingOverrideBlocked: c74.timingOverrideBlocked || false,
      
      dominance,
      volRegime: volatility.regime || 'NORMAL',
      
      phaseType: payload.chart?.globalPhase || 'UNKNOWN',
      phaseGrade: 'C' as const,
      
      divergenceScore: adaptiveMeta.divergencePenalties || 0,
      divergenceGrade: 'C' as const,
      
      primaryMatchId: primaryMatch?.id || null,
      primaryMatchScore: primaryMatch?.similarity || 0
    };
  }
  
  /**
   * Extract horizon votes from consensus74
   */
  extractHorizonVotes(payload: any): any[] {
    const c74 = payload.consensus74 || {};
    const votes = c74.votes || [];
    const horizonMatrix = payload.horizonMatrix || [];
    
    return votes.map((v: any) => {
      const matrixItem = horizonMatrix.find((h: any) => h.horizon === v.horizon);
      return {
        horizon: v.horizon,
        tier: HORIZON_TO_TIER[v.horizon as FocusHorizon] || 'TACTICAL',
        direction: v.direction || 'FLAT',
        weight: v.weight || 0,
        contribution: v.contribution || 0,
        confidence: matrixItem?.confidence || 0,
        entropy: matrixItem?.entropy || 0,
        blockers: matrixItem?.blockers || []
      };
    });
  }
  
  /**
   * Extract tier weights from consensus74
   */
  extractTierWeights(payload: any): any {
    const c74 = payload.consensus74 || {};
    const am = c74.adaptiveMeta || {};
    
    return {
      structureWeightSum: am.structureWeightSum || 0,
      tacticalWeightSum: am.tacticalWeightSum || 0,
      timingWeightSum: am.timingWeightSum || 0,
      structuralDirection: am.structuralDirection || 'FLAT',
      tacticalDirection: am.tacticalDirection || 'FLAT',
      timingDirection: am.timingDirection || 'FLAT'
    };
  }
  
  /**
   * Extract distribution from decisionKernel
   */
  extractDistribution(payload: any, focus: FocusHorizon): any {
    const horizonMatrix = payload.horizonMatrix || [];
    const focusItem = horizonMatrix.find((h: any) => h.horizon === focus);
    
    if (!focusItem) return undefined;
    
    return {
      p10: focusItem.p10 || undefined,
      p50: focusItem.p50 || undefined,
      p90: focusItem.p90 || undefined,
      expectedReturn: focusItem.expectedReturn || 0
    };
  }
  
  /**
   * Check if snapshot already exists
   */
  async snapshotExists(
    symbol: string,
    asofDate: string,
    focus: FocusHorizon,
    role: SnapshotRole,
    preset: SnapshotPreset
  ): Promise<boolean> {
    const count = await PredictionSnapshotModel.countDocuments({
      symbol,
      asofDate,
      focus,
      role,
      preset
    });
    return count > 0;
  }
  
  /**
   * Write single snapshot
   */
  async writeSnapshot(
    symbol: string,
    asofDate: string,
    focus: FocusHorizon,
    role: SnapshotRole,
    preset: SnapshotPreset,
    payload: any
  ): Promise<boolean> {
    // Idempotency check
    const exists = await this.snapshotExists(symbol, asofDate, focus, role, preset);
    if (exists) {
      return false; // skipped
    }
    
    const kernelDigest = this.extractKernelDigest(payload);
    const horizonVotes = this.extractHorizonVotes(payload);
    const tierWeights = this.extractTierWeights(payload);
    const distribution = this.extractDistribution(payload, focus);
    const maturityDate = this.calculateMaturityDate(asofDate, focus);
    
    const doc: Partial<PredictionSnapshotDocument> = {
      symbol: 'BTC',
      asofDate,
      focus,
      role,
      preset,
      tier: HORIZON_TO_TIER[focus],
      maturityDate,
      kernelDigest,
      horizonVotes,
      tierWeights,
      distribution,
      terminalPayload: payload
    };
    
    await PredictionSnapshotModel.create(doc);
    return true; // written
  }
  
  /**
   * Write all snapshots for BTC (main entry point)
   */
  async writeAllSnapshots(asofDateOverride?: string): Promise<WriteSnapshotResult> {
    const symbol = 'BTC';
    const asofDate = asofDateOverride || await this.getLatestAsofDate(symbol);
    
    console.log(`[MemorySnapshot] Writing snapshots for ${symbol} on ${asofDate}`);
    
    const focusBreakdown: Record<FocusHorizon, { written: number; skipped: number }> = {
      '7d': { written: 0, skipped: 0 },
      '14d': { written: 0, skipped: 0 },
      '30d': { written: 0, skipped: 0 },
      '90d': { written: 0, skipped: 0 },
      '180d': { written: 0, skipped: 0 },
      '365d': { written: 0, skipped: 0 }
    };
    
    let totalWritten = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    
    // Fetch terminal payload once per focus (shared across presets/roles)
    const payloadCache: Record<FocusHorizon, any> = {} as any;
    
    for (const focus of HORIZONS) {
      const payload = await this.fetchTerminalPayload(symbol, focus);
      
      if (!payload) {
        errors.push(`Failed to fetch terminal for focus=${focus}`);
        continue;
      }
      
      payloadCache[focus] = payload;
      
      for (const preset of PRESETS) {
        for (const role of ROLES) {
          try {
            const written = await this.writeSnapshot(
              symbol,
              asofDate,
              focus,
              role,
              preset,
              payload
            );
            
            if (written) {
              totalWritten++;
              focusBreakdown[focus].written++;
            } else {
              totalSkipped++;
              focusBreakdown[focus].skipped++;
            }
          } catch (err: any) {
            errors.push(`Error writing ${focus}/${role}/${preset}: ${err.message}`);
          }
        }
      }
    }
    
    console.log(`[MemorySnapshot] Done: written=${totalWritten}, skipped=${totalSkipped}`);
    
    return {
      symbol,
      asofDate,
      written: totalWritten,
      skipped: totalSkipped,
      focusBreakdown,
      errors
    };
  }
  
  /**
   * Get latest snapshot
   */
  async getLatestSnapshot(
    symbol: string,
    focus?: FocusHorizon,
    preset?: SnapshotPreset,
    role?: SnapshotRole
  ): Promise<PredictionSnapshotDocument | null> {
    const query: any = { symbol };
    if (focus) query.focus = focus;
    if (preset) query.preset = preset;
    if (role) query.role = role;
    
    return PredictionSnapshotModel.findOne(query).sort({ asofDate: -1 }).lean();
  }
  
  /**
   * Get snapshots in date range
   */
  async getSnapshotsRange(
    symbol: string,
    from: string,
    to: string
  ): Promise<PredictionSnapshotDocument[]> {
    return PredictionSnapshotModel.find({
      symbol,
      asofDate: { $gte: from, $lte: to }
    }).sort({ asofDate: 1 }).lean();
  }
  
  /**
   * Count snapshots
   */
  async countSnapshots(symbol: string): Promise<{ total: number; byRole: Record<string, number> }> {
    const total = await PredictionSnapshotModel.countDocuments({ symbol });
    const active = await PredictionSnapshotModel.countDocuments({ symbol, role: 'ACTIVE' });
    const shadow = await PredictionSnapshotModel.countDocuments({ symbol, role: 'SHADOW' });
    
    return { total, byRole: { ACTIVE: active, SHADOW: shadow } };
  }
}

export const memorySnapshotWriterService = new MemorySnapshotWriterService();
