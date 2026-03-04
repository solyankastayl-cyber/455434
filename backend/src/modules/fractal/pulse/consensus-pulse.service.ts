/**
 * BLOCK 76.1 — Consensus Pulse Service
 * 
 * Provides 7-day intelligence pulse for terminal header.
 * Shows consensus dynamics, structural lock events, divergence trends.
 * 
 * Source of truth: Memory Snapshots (BLOCK 75)
 */

import { PredictionSnapshotModel, type PredictionSnapshotDocument } from '../memory/snapshot/prediction-snapshot.model.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SyncState = 'ALIGNING' | 'DIVERGING' | 'NEUTRAL' | 'STRUCTURAL_DOMINANCE';

export interface PulseDataPoint {
  date: string;
  consensusIndex: number;
  structuralWeight: number;
  dominance: 'STRUCTURE' | 'TACTICAL' | 'TIMING';
  structuralLock: boolean;
  conflictLevel: string;
  divergenceScore: number;
  divergenceGrade: string;
}

export interface ConsensusPulseSummary {
  current: number;
  delta7d: number;
  avgStructuralWeight: number;
  lockDays: number;
  syncState: SyncState;
}

export interface ConsensusPulseResponse {
  symbol: string;
  days: number;
  asof: string;
  series: PulseDataPoint[];
  summary: ConsensusPulseSummary;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class ConsensusPulseService {
  
  /**
   * Get date range for pulse
   */
  getDateRange(days: number): { from: string; to: string } {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10)
    };
  }
  
  /**
   * Determine sync state from series data
   */
  determineSyncState(series: PulseDataPoint[]): SyncState {
    if (series.length === 0) return 'NEUTRAL';
    
    const last = series[series.length - 1];
    const first = series[0];
    
    // Check structural dominance first
    if (last.structuralLock) {
      return 'STRUCTURAL_DOMINANCE';
    }
    
    if (last.structuralWeight >= 55) {
      return 'STRUCTURAL_DOMINANCE';
    }
    
    // Check divergence state
    if (last.divergenceScore < 50 || last.divergenceGrade === 'D' || last.divergenceGrade === 'F') {
      return 'DIVERGING';
    }
    
    if (last.conflictLevel === 'HIGH' || last.conflictLevel === 'SEVERE') {
      return 'DIVERGING';
    }
    
    // Check if aligning (consensus improving, divergence stable/improving)
    const consensusDelta = last.consensusIndex - first.consensusIndex;
    const divergenceDelta = last.divergenceScore - first.divergenceScore;
    
    if (consensusDelta > 5 && divergenceDelta >= 0) {
      return 'ALIGNING';
    }
    
    if (consensusDelta < -5 && divergenceDelta < 0) {
      return 'DIVERGING';
    }
    
    return 'NEUTRAL';
  }
  
  /**
   * Extract pulse data from snapshot
   */
  extractPulseData(snapshot: PredictionSnapshotDocument): PulseDataPoint {
    const kd = snapshot.kernelDigest;
    const tw = snapshot.tierWeights;
    
    return {
      date: snapshot.asofDate,
      consensusIndex: kd.consensusIndex,
      structuralWeight: Math.round(tw.structureWeightSum * 100),
      dominance: kd.dominance,
      structuralLock: kd.structuralLock,
      conflictLevel: kd.conflictLevel,
      divergenceScore: Math.round(kd.divergenceScore),
      divergenceGrade: kd.divergenceGrade
    };
  }
  
  /**
   * Get consensus pulse data (main entry point)
   */
  async getConsensusPulse(
    symbol: string = 'BTC',
    days: number = 7
  ): Promise<ConsensusPulseResponse> {
    const { from, to } = this.getDateRange(days);
    
    // Fetch snapshots for the period (ACTIVE, balanced, 30d focus as baseline)
    const snapshots = await PredictionSnapshotModel.find({
      symbol,
      role: 'ACTIVE',
      preset: 'balanced',
      focus: '30d',
      asofDate: { $gte: from, $lte: to }
    })
    .sort({ asofDate: 1 })
    .lean() as PredictionSnapshotDocument[];
    
    // Group by date (take last per day if multiple)
    const byDate: Map<string, PredictionSnapshotDocument> = new Map();
    for (const snap of snapshots) {
      byDate.set(snap.asofDate, snap);
    }
    
    // Build series
    const series: PulseDataPoint[] = [];
    for (const [date, snap] of byDate) {
      series.push(this.extractPulseData(snap));
    }
    
    // Sort by date
    series.sort((a, b) => a.date.localeCompare(b.date));
    
    // Build summary
    const current = series.length > 0 ? series[series.length - 1].consensusIndex : 50;
    const first = series.length > 0 ? series[0].consensusIndex : 50;
    const delta7d = current - first;
    
    const avgStructuralWeight = series.length > 0
      ? series.reduce((sum, p) => sum + p.structuralWeight, 0) / series.length
      : 50;
    
    const lockDays = series.filter(p => p.structuralLock).length;
    const syncState = this.determineSyncState(series);
    
    return {
      symbol,
      days,
      asof: to,
      series,
      summary: {
        current,
        delta7d,
        avgStructuralWeight: Math.round(avgStructuralWeight),
        lockDays,
        syncState
      }
    };
  }
  
  /**
   * Get live pulse (fallback if no snapshots)
   * Uses current terminal state
   */
  async getLivePulse(symbol: string = 'BTC'): Promise<ConsensusPulseResponse> {
    // Fallback: return current state only (no history)
    try {
      const url = `http://localhost:8002/api/fractal/v2.1/terminal?symbol=${symbol}&set=extended&focus=30d`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      
      if (!response.ok) {
        throw new Error('Terminal fetch failed');
      }
      
      const payload = await response.json();
      const c74 = payload.consensus74 || {};
      const am = c74.adaptiveMeta || {};
      
      const today = new Date().toISOString().slice(0, 10);
      const point: PulseDataPoint = {
        date: today,
        consensusIndex: c74.consensusIndex || 50,
        structuralWeight: Math.round((am.structureWeightSum || 0.5) * 100),
        dominance: c74.resolved?.dominantTier || 'TACTICAL',
        structuralLock: c74.structuralLock || false,
        conflictLevel: c74.conflictLevel || 'MODERATE',
        divergenceScore: 50,
        divergenceGrade: 'C'
      };
      
      return {
        symbol,
        days: 1,
        asof: today,
        series: [point],
        summary: {
          current: point.consensusIndex,
          delta7d: 0,
          avgStructuralWeight: point.structuralWeight,
          lockDays: point.structuralLock ? 1 : 0,
          syncState: point.structuralLock ? 'STRUCTURAL_DOMINANCE' : 'NEUTRAL'
        }
      };
    } catch (err) {
      // Return empty state
      return {
        symbol,
        days: 0,
        asof: new Date().toISOString().slice(0, 10),
        series: [],
        summary: {
          current: 50,
          delta7d: 0,
          avgStructuralWeight: 50,
          lockDays: 0,
          syncState: 'NEUTRAL'
        }
      };
    }
  }
}

export const consensusPulseService = new ConsensusPulseService();
