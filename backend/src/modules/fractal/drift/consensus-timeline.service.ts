/**
 * BLOCK 80.3 — Consensus Timeline Service
 * 
 * Writes daily consensus snapshots and provides timeline API.
 */

import { ConsensusHistoryModel } from './consensus-history.model.js';
import { driftService } from './drift.service.js';
import { governanceLockService } from '../governance/governance-lock.service.js';

interface ConsensusSnapshot {
  symbol: string;
  consensusIndex: number;
  driftSeverity: string;
  structuralLock: boolean;
  dominanceTier?: string;
  volRegime?: string;
  phaseType?: string;
  phaseGrade?: string;
  phaseStrength?: number;
  divergenceScore?: number;
  divergenceGrade?: string;
  finalAction?: string;
  finalSize?: number;
  policyHash?: string;
  liveSamples?: number;
}

interface TimelineStats {
  avgConsensus: number;
  lockDays: number;
  driftCounts: {
    OK: number;
    WATCH: number;
    WARN: number;
    CRITICAL: number;
  };
  trend7d: 'UP' | 'DOWN' | 'FLAT';
  totalDays: number;
}

class ConsensusTimelineService {
  
  /**
   * Write daily consensus snapshot (idempotent)
   * Called from daily-run pipeline after DRIFT_CHECK
   */
  async writeSnapshot(snapshot: ConsensusSnapshot): Promise<void> {
    const now = new Date();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD UTC
    
    await ConsensusHistoryModel.updateOne(
      { symbol: snapshot.symbol, date, source: 'LIVE' },
      {
        $set: {
          consensusIndex: snapshot.consensusIndex,
          driftSeverity: snapshot.driftSeverity,
          structuralLock: snapshot.structuralLock,
          dominanceTier: snapshot.dominanceTier,
          volRegime: snapshot.volRegime,
          phaseType: snapshot.phaseType,
          phaseGrade: snapshot.phaseGrade,
          phaseStrength: snapshot.phaseStrength,
          divergenceScore: snapshot.divergenceScore,
          divergenceGrade: snapshot.divergenceGrade,
          finalAction: snapshot.finalAction,
          finalSize: snapshot.finalSize,
          policyHash: snapshot.policyHash,
          liveSamples: snapshot.liveSamples,
          engineVersion: 'v2.1.0',
        }
      },
      { upsert: true }
    );
    
    console.log(`[ConsensusTimeline] Written snapshot for ${snapshot.symbol} @ ${date}`);
  }
  
  /**
   * Build and write snapshot from current system state
   */
  async buildAndWriteSnapshot(symbol: string = 'BTC'): Promise<any> {
    try {
      // Get drift report for current state
      const driftReport = await driftService.build({
        symbol,
        focus: '30d',
        preset: 'balanced',
        role: 'ACTIVE',
        windowDays: 365,
      });
      
      // Get governance lock status
      const lockStatus = await governanceLockService.getLockStatus(symbol);
      
      // Calculate consensus index (based on drift and lock status)
      const consensusIndex = this.calculateConsensusIndex(driftReport, lockStatus);
      
      const snapshot: ConsensusSnapshot = {
        symbol,
        consensusIndex,
        driftSeverity: driftReport.verdict?.overallSeverity || 'OK',
        structuralLock: !lockStatus.canApply,
        dominanceTier: driftReport.breakdown?.tier ? Object.keys(driftReport.breakdown.tier)[0] : undefined,
        volRegime: driftReport.breakdown?.regime ? Object.keys(driftReport.breakdown.regime)[0] : undefined,
        phaseType: driftReport.breakdown?.phase ? Object.keys(driftReport.breakdown.phase)[0] : undefined,
        phaseGrade: driftReport.breakdown?.divergenceGrade ? Object.keys(driftReport.breakdown.divergenceGrade)[0] : undefined,
        divergenceGrade: driftReport.breakdown?.divergenceGrade ? Object.keys(driftReport.breakdown.divergenceGrade)[0] : undefined,
        liveSamples: driftReport.sampleCounts?.totalLiveSamples || 0,
        policyHash: lockStatus.lockDetails?.contractHash || 'v2.1.0',
      };
      
      await this.writeSnapshot(snapshot);
      
      return {
        written: true,
        date: new Date().toISOString().split('T')[0],
        consensusIndex,
        driftSeverity: snapshot.driftSeverity,
        structuralLock: snapshot.structuralLock,
      };
      
    } catch (err: any) {
      console.error('[ConsensusTimeline] Build snapshot failed:', err.message);
      return { written: false, error: err.message };
    }
  }
  
  /**
   * Get timeline data
   */
  async getTimeline(symbol: string = 'BTC', days: number = 30): Promise<{
    series: any[];
    stats: TimelineStats;
    latest: any;
  }> {
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);
    const fromDateStr = fromDate.toISOString().split('T')[0];
    
    const series = await ConsensusHistoryModel
      .find({
        symbol,
        source: 'LIVE',
        date: { $gte: fromDateStr }
      })
      .sort({ date: 1 })
      .lean();
    
    const stats = this.computeStats(series);
    const latest = series.length > 0 ? series[series.length - 1] : null;
    
    return { series, stats, latest };
  }
  
  /**
   * Calculate consensus index from drift and lock status
   */
  private calculateConsensusIndex(driftReport: any, lockStatus: any): number {
    let index = 50; // Base
    
    // Adjust by drift severity
    const severity = driftReport.verdict?.overallSeverity || 'OK';
    if (severity === 'OK') index += 30;
    else if (severity === 'WATCH') index += 10;
    else if (severity === 'WARN') index -= 10;
    else if (severity === 'CRITICAL') index -= 30;
    
    // Adjust by lock status
    if (lockStatus.canApply) index += 10;
    else index -= 10;
    
    // Adjust by sample count
    const samples = driftReport.sampleCounts?.totalLiveSamples || 0;
    if (samples >= 30) index += 10;
    else if (samples >= 10) index += 5;
    else index -= 10;
    
    // Clamp to 0-100
    return Math.max(0, Math.min(100, index));
  }
  
  /**
   * Compute stats from series
   */
  private computeStats(series: any[]): TimelineStats {
    const totalDays = series.length;
    
    if (totalDays === 0) {
      return {
        avgConsensus: 0,
        lockDays: 0,
        driftCounts: { OK: 0, WATCH: 0, WARN: 0, CRITICAL: 0 },
        trend7d: 'FLAT',
        totalDays: 0,
      };
    }
    
    // Average consensus
    const avgConsensus = series.reduce((acc, x) => acc + (x.consensusIndex || 0), 0) / totalDays;
    
    // Lock days
    const lockDays = series.filter(x => x.structuralLock).length;
    
    // Drift counts
    const driftCounts = { OK: 0, WATCH: 0, WARN: 0, CRITICAL: 0 };
    series.forEach(x => {
      const sev = x.driftSeverity || 'OK';
      if (driftCounts[sev as keyof typeof driftCounts] !== undefined) {
        driftCounts[sev as keyof typeof driftCounts]++;
      }
    });
    
    // 7-day trend
    let trend7d: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (series.length >= 7) {
      const last7 = series.slice(-7);
      const first = last7[0]?.consensusIndex || 0;
      const last = last7[last7.length - 1]?.consensusIndex || 0;
      const diff = last - first;
      
      if (diff > 5) trend7d = 'UP';
      else if (diff < -5) trend7d = 'DOWN';
    }
    
    return {
      avgConsensus: Math.round(avgConsensus * 10) / 10,
      lockDays,
      driftCounts,
      trend7d,
      totalDays,
    };
  }
}

export const consensusTimelineService = new ConsensusTimelineService();

export default consensusTimelineService;
