/**
 * BLOCK 82 — Intel Timeline Service
 * 
 * Reads intel timeline data for Admin UI:
 * - Phase Strength Timeline (30/90/365)
 * - Dominance History
 * - KPI Summary Stats
 */

import { IntelTimelineModel } from './intel-timeline.model.js';
import type {
  IntelTimelineSource,
  IntelTimelineEntry,
  IntelTimelineStats,
  IntelTimelineResponse,
  Trend7d,
  DominanceTier,
} from './intel-timeline.types.js';

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

class IntelTimelineService {
  
  /**
   * Get intel timeline with stats
   */
  async getTimeline(params: {
    symbol?: string;
    source?: IntelTimelineSource;
    window?: number;
  }): Promise<IntelTimelineResponse> {
    const symbol = params.symbol || 'BTC';
    const source = params.source || 'LIVE';
    const window = params.window || 90;
    
    // Calculate date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - window);
    
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = toDate.toISOString().split('T')[0];
    
    // Query
    const docs = await IntelTimelineModel.find({
      symbol,
      source,
      date: { $gte: fromStr, $lte: toStr },
    })
      .sort({ date: 1 })
      .lean();
    
    // Map to response format
    const series: IntelTimelineEntry[] = docs.map(d => ({
      date: d.date,
      phaseType: d.phaseType,
      phaseGrade: d.phaseGrade,
      phaseScore: d.phaseScore,
      dominanceTier: d.dominanceTier,
      structuralLock: d.structuralLock,
      tierWeights: d.tierWeights,
      consensusIndex: d.consensusIndex,
      conflictLevel: d.conflictLevel,
      volRegime: d.volRegime,
      divergenceGrade: d.divergenceGrade,
      divergenceScore: d.divergenceScore,
      finalAction: d.finalAction,
      finalSize: d.finalSize,
    }));
    
    // Compute stats
    const stats = this.computeStats(series);
    
    return {
      ok: true,
      meta: {
        symbol,
        source,
        window,
        from: fromStr,
        to: toStr,
      },
      series,
      stats,
    };
  }
  
  /**
   * Compute KPI stats from series
   */
  private computeStats(series: IntelTimelineEntry[]): IntelTimelineStats {
    if (series.length === 0) {
      return {
        lockDays: 0,
        structureDominancePct: 0,
        tacticalDominancePct: 0,
        timingDominancePct: 0,
        switchCount: 0,
        avgPhaseScore: 0,
        avgConsensus: 0,
        trend7d: 'FLAT',
      };
    }
    
    // Lock days
    const lockDays = series.filter(s => s.structuralLock).length;
    
    // Dominance percentages
    const total = series.length;
    const structureCount = series.filter(s => s.dominanceTier === 'STRUCTURE').length;
    const tacticalCount = series.filter(s => s.dominanceTier === 'TACTICAL').length;
    const timingCount = series.filter(s => s.dominanceTier === 'TIMING').length;
    
    // Switch count (dominance tier changes)
    let switchCount = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i].dominanceTier !== series[i - 1].dominanceTier) {
        switchCount++;
      }
    }
    
    // Averages
    const avgPhaseScore = series.reduce((a, b) => a + b.phaseScore, 0) / total;
    const avgConsensus = series.reduce((a, b) => a + b.consensusIndex, 0) / total;
    
    // Trend 7d (compare last 7 days avg to previous 7 days avg)
    let trend7d: Trend7d = 'FLAT';
    if (series.length >= 14) {
      const last7 = series.slice(-7);
      const prev7 = series.slice(-14, -7);
      const last7Avg = last7.reduce((a, b) => a + b.phaseScore, 0) / 7;
      const prev7Avg = prev7.reduce((a, b) => a + b.phaseScore, 0) / 7;
      
      const diff = last7Avg - prev7Avg;
      if (diff > 5) trend7d = 'UP';
      else if (diff < -5) trend7d = 'DOWN';
    } else if (series.length >= 7) {
      // Not enough for comparison, use slope of last 7
      const last7 = series.slice(-7);
      const first = last7[0].phaseScore;
      const last = last7[last7.length - 1].phaseScore;
      const diff = last - first;
      if (diff > 5) trend7d = 'UP';
      else if (diff < -5) trend7d = 'DOWN';
    }
    
    return {
      lockDays,
      structureDominancePct: Math.round((structureCount / total) * 100),
      tacticalDominancePct: Math.round((tacticalCount / total) * 100),
      timingDominancePct: Math.round((timingCount / total) * 100),
      switchCount,
      avgPhaseScore: Math.round(avgPhaseScore * 10) / 10,
      avgConsensus: Math.round(avgConsensus * 10) / 10,
      trend7d,
    };
  }
  
  /**
   * Get latest snapshot for terminal header
   */
  async getLatest(symbol = 'BTC', source: IntelTimelineSource = 'LIVE'): Promise<IntelTimelineEntry | null> {
    const doc = await IntelTimelineModel.findOne({ symbol, source })
      .sort({ date: -1 })
      .lean();
    
    if (!doc) return null;
    
    return {
      date: doc.date,
      phaseType: doc.phaseType,
      phaseGrade: doc.phaseGrade,
      phaseScore: doc.phaseScore,
      dominanceTier: doc.dominanceTier,
      structuralLock: doc.structuralLock,
      tierWeights: doc.tierWeights,
      consensusIndex: doc.consensusIndex,
      conflictLevel: doc.conflictLevel,
      volRegime: doc.volRegime,
      divergenceGrade: doc.divergenceGrade,
      divergenceScore: doc.divergenceScore,
      finalAction: doc.finalAction,
      finalSize: doc.finalSize,
    };
  }
  
  /**
   * Get count of snapshots by source (for backfill progress)
   */
  async getCounts(symbol = 'BTC'): Promise<Record<IntelTimelineSource, number>> {
    const [live, v2014, v2020] = await Promise.all([
      IntelTimelineModel.countDocuments({ symbol, source: 'LIVE' }),
      IntelTimelineModel.countDocuments({ symbol, source: 'V2014' }),
      IntelTimelineModel.countDocuments({ symbol, source: 'V2020' }),
    ]);
    
    return { LIVE: live, V2014: v2014, V2020: v2020 };
  }
}

export const intelTimelineService = new IntelTimelineService();
export default intelTimelineService;
