/**
 * COMPARE ENGINE SERVICE — Institutional Validation Layer
 * 
 * UPDATED FOR P5.6 + P5.9: Per-Horizon Weights
 * 
 * Compares V1 vs V2 performance across:
 * - Multiple horizons (with per-horizon weights)
 * - Regime stability
 * - Weight drift
 * - Router decisions
 * 
 * This is the bridge before AI-Brain.
 */

import { getMacroEngineV1 } from '../v1/macro_engine_v1.service.js';
import { getMacroEngineV2 } from '../v2/macro_engine_v2.service.js';
import { getRegimeStateService } from '../v2/state/regime_state.service.js';
import { getRollingCalibrationService } from '../v2/calibration/rolling_calibration.service.js';
import { getV2CalibrationObjectiveService, HorizonKey } from '../v2/v2_calibration_objective.service.js';
import { MacroHorizon } from '../interfaces/macro_engine.interface.js';
import { MacroWeightsVersionModel } from '../v2/models/macro_state.model.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface HorizonComparison {
  v1MeanReturn: number;
  v2MeanReturn: number;
  v1HitRate: number;
  v2HitRate: number;
  meanAbsDiff: number;
  meanSignedDiff: number;
  directionAgreement: number;  // percentage
  v2OutperformanceRate: number;
  delta: number;               // v2HitRate - v1HitRate
}

export interface RegimeStats {
  totalRegimeChanges: number;
  avgPersistence: number;
  mostFrequentRegime: string;
  regimeDistribution: Record<string, number>;
}

export interface RouterStats {
  fallbackCount: number;
  v1ChosenCount: number;
  v2ChosenCount: number;
  fallbackReasons: Record<string, number>;
}

export interface CalibrationStats {
  totalVersions: number;
  avgWeightDrift: number;
  maxWeightDrift: number;
  lastCalibrationDate: string | null;
  nextScheduledDate: string | null;
  activeVersionId: string | null;
  perHorizon: boolean;
}

export interface ComparePack {
  asset: string;
  range: {
    from: string;
    to: string;
    totalObservations: number;
  };
  v2VersionId: string | null;
  perHorizon: boolean;
  horizons: Record<string, HorizonComparison>;
  regimeStats: RegimeStats;
  routerStats: RouterStats;
  calibrationStats: CalibrationStats;
}

// ═══════════════════════════════════════════════════════════════
// COMPARE SERVICE
// ═══════════════════════════════════════════════════════════════

export class CompareService {
  private routerLog: Array<{
    timestamp: Date;
    chosen: 'v1' | 'v2';
    reason: string;
    asset: string;
  }> = [];

  /**
   * Log router decision for audit
   */
  logRouterDecision(asset: string, chosen: 'v1' | 'v2', reason: string): void {
    this.routerLog.push({
      timestamp: new Date(),
      chosen,
      reason,
      asset,
    });
    
    // Keep last 1000 entries
    if (this.routerLog.length > 1000) {
      this.routerLog = this.routerLog.slice(-1000);
    }
  }

  /**
   * Full comparison for given date range
   * UPDATED: Uses per-horizon weights from V2 Calibration Objective
   */
  async getComparison(params: {
    asset: string;
    from?: string;
    to?: string;
    horizons?: MacroHorizon[];
    versionId?: string;
  }): Promise<ComparePack> {
    const { asset, versionId } = params;
    const horizons = params.horizons || ['30D', '90D', '180D', '365D'] as MacroHorizon[];
    const now = new Date();
    const from = params.from || new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = params.to || now.toISOString().split('T')[0];

    // Get services
    const regimeSvc = getRegimeStateService();
    const calibrationSvc = getRollingCalibrationService();
    const v2CalObjSvc = getV2CalibrationObjectiveService();
    
    // Get active V2 version info
    const v2Active = v2CalObjSvc.getActiveVersion();
    const activeVersionId = versionId || v2Active.versionId;
    
    // Try to get per-horizon metrics from stored calibration
    let storedMetrics: Record<string, any> | null = null;
    if (activeVersionId) {
      try {
        const doc = await MacroWeightsVersionModel.findOne({ versionId: activeVersionId }).lean();
        if (doc && (doc as any).metrics) {
          storedMetrics = (doc as any).metrics;
        }
      } catch (e) {
        // Fallback to runtime comparison
      }
    }

    // Compute horizon comparisons
    const horizonComparisons: Record<string, HorizonComparison> = {};
    
    for (const horizon of horizons) {
      try {
        // Use stored metrics if available (from calibration)
        if (storedMetrics && storedMetrics[horizon]) {
          const m = storedMetrics[horizon];
          horizonComparisons[horizon] = {
            v1MeanReturn: 0,
            v2MeanReturn: 0,
            v1HitRate: m.v1?.hitRate || 0,
            v2HitRate: m.v2?.hitRate || 0,
            meanAbsDiff: m.v2?.mae || 0,
            meanSignedDiff: m.delta?.hitRate || 0,
            directionAgreement: m.v2?.hitRate || 0,
            v2OutperformanceRate: m.delta?.hitRate > 0 ? 100 : 0,
            delta: m.delta?.hitRate || 0,
          };
        } else {
          // Fallback to runtime comparison
          const comparison = await this.compareHorizon(asset, horizon);
          horizonComparisons[horizon] = comparison;
        }
      } catch (e) {
        horizonComparisons[horizon] = {
          v1MeanReturn: 0,
          v2MeanReturn: 0,
          v1HitRate: 0,
          v2HitRate: 0,
          meanAbsDiff: 0,
          meanSignedDiff: 0,
          directionAgreement: 0,
          v2OutperformanceRate: 0,
          delta: 0,
        };
      }
    }

    // Get regime stats from history
    const regimeHistory = await regimeSvc.getHistory(asset, 90);
    const regimeStats = this.computeRegimeStats(regimeHistory);

    // Get router stats
    const routerStats = this.computeRouterStats(asset);

    // Get calibration stats (updated for per-horizon)
    const calibrationHistory = await calibrationSvc.getWeightsHistory(asset, 12);
    const calibrationStats = this.computeCalibrationStats(calibrationHistory);
    calibrationStats.activeVersionId = activeVersionId;
    calibrationStats.perHorizon = v2Active.perHorizon;

    return {
      asset,
      range: {
        from,
        to,
        totalObservations: regimeHistory.length,
      },
      v2VersionId: activeVersionId,
      perHorizon: v2Active.perHorizon,
      horizons: horizonComparisons,
      regimeStats,
      routerStats,
      calibrationStats,
    };
  }

  /**
   * Compare single horizon (runtime fallback)
   */
  private async compareHorizon(asset: string, horizon: MacroHorizon): Promise<HorizonComparison> {
    const v1Engine = getMacroEngineV1();
    const v2Engine = getMacroEngineV2();

    try {
      const [v1Pack, v2Pack] = await Promise.all([
        v1Engine.computePack({
          asset: asset as any,
          horizon,
          hybridEndReturn: 0,
        }),
        v2Engine.computePack({
          asset: asset as any,
          horizon,
          hybridEndReturn: 0,
        }),
      ]);

      const v1Delta = v1Pack.overlay.horizons.find(h => h.horizon === horizon)?.delta || 0;
      const v2Delta = v2Pack.overlay.horizons.find(h => h.horizon === horizon)?.delta || 0;

      const diff = v2Delta - v1Delta;
      const sameDirection = Math.sign(v1Delta) === Math.sign(v2Delta);

      return {
        v1MeanReturn: Math.round(v1Delta * 10000) / 10000,
        v2MeanReturn: Math.round(v2Delta * 10000) / 10000,
        v1HitRate: 0,  // Not computed in runtime
        v2HitRate: 0,  // Not computed in runtime
        meanAbsDiff: Math.round(Math.abs(diff) * 10000) / 10000,
        meanSignedDiff: Math.round(diff * 10000) / 10000,
        directionAgreement: sameDirection ? 100 : 0,
        v2OutperformanceRate: diff > 0 ? 100 : (diff < 0 ? 0 : 50),
        delta: Math.round(diff * 10000) / 10000,
      };
    } catch (e) {
      return {
        v1MeanReturn: 0,
        v2MeanReturn: 0,
        v1HitRate: 0,
        v2HitRate: 0,
        meanAbsDiff: 0,
        meanSignedDiff: 0,
        directionAgreement: 0,
        v2OutperformanceRate: 0,
        delta: 0,
      };
    }
  }

  /**
   * Compute regime statistics
   */
  private computeRegimeStats(history: any[]): RegimeStats {
    if (!history || history.length === 0) {
      return {
        totalRegimeChanges: 0,
        avgPersistence: 0,
        mostFrequentRegime: 'NEUTRAL',
        regimeDistribution: {},
      };
    }

    // Count changes
    let changes = 0;
    const regimeCounts: Record<string, number> = {};
    let totalPersistence = 0;

    for (let i = 0; i < history.length; i++) {
      const regime = history[i].dominant || 'NEUTRAL';
      regimeCounts[regime] = (regimeCounts[regime] || 0) + 1;
      totalPersistence += history[i].persistence || 0;

      if (i > 0 && history[i].dominant !== history[i - 1].dominant) {
        changes++;
      }
    }

    // Find most frequent
    let mostFrequent = 'NEUTRAL';
    let maxCount = 0;
    for (const [regime, count] of Object.entries(regimeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = regime;
      }
    }

    // Distribution percentages
    const total = history.length;
    const distribution: Record<string, number> = {};
    for (const [regime, count] of Object.entries(regimeCounts)) {
      distribution[regime] = Math.round((count / total) * 100);
    }

    return {
      totalRegimeChanges: changes,
      avgPersistence: Math.round((totalPersistence / history.length) * 1000) / 1000,
      mostFrequentRegime: mostFrequent,
      regimeDistribution: distribution,
    };
  }

  /**
   * Compute router statistics
   */
  private computeRouterStats(asset: string): RouterStats {
    const assetLogs = this.routerLog.filter(l => l.asset === asset);
    
    let v1Count = 0;
    let v2Count = 0;
    let fallbackCount = 0;
    const fallbackReasons: Record<string, number> = {};

    for (const log of assetLogs) {
      if (log.chosen === 'v1') {
        v1Count++;
        if (log.reason.includes('FALLBACK')) {
          fallbackCount++;
          const reason = log.reason.replace('FALLBACK_V1: ', '');
          fallbackReasons[reason] = (fallbackReasons[reason] || 0) + 1;
        }
      } else {
        v2Count++;
      }
    }

    return {
      fallbackCount,
      v1ChosenCount: v1Count,
      v2ChosenCount: v2Count,
      fallbackReasons,
    };
  }

  /**
   * Compute calibration statistics
   */
  private computeCalibrationStats(history: any[]): CalibrationStats {
    if (!history || history.length === 0) {
      return {
        totalVersions: 0,
        avgWeightDrift: 0,
        maxWeightDrift: 0,
        lastCalibrationDate: null,
        nextScheduledDate: null,
      };
    }

    // Compute weight drift between versions
    const drifts: number[] = [];
    
    for (let i = 1; i < history.length; i++) {
      const curr = history[i - 1];
      const prev = history[i];
      
      if (curr.components && prev.components) {
        let totalDrift = 0;
        for (const comp of curr.components) {
          const prevComp = prev.components.find((c: any) => c.key === comp.key);
          if (prevComp) {
            totalDrift += Math.abs(comp.weight - prevComp.weight);
          }
        }
        drifts.push(totalDrift);
      }
    }

    const avgDrift = drifts.length > 0
      ? drifts.reduce((a, b) => a + b, 0) / drifts.length
      : 0;
    const maxDrift = drifts.length > 0 ? Math.max(...drifts) : 0;

    // Dates
    const lastCal = history[0]?.asOf;
    const lastCalDate = lastCal ? new Date(lastCal).toISOString().split('T')[0] : null;
    
    // Next scheduled (30 days after last)
    let nextScheduled: string | null = null;
    if (lastCal) {
      const next = new Date(lastCal);
      next.setDate(next.getDate() + 30);
      nextScheduled = next.toISOString().split('T')[0];
    }

    return {
      totalVersions: history.length,
      avgWeightDrift: Math.round(avgDrift * 10000) / 10000,
      maxWeightDrift: Math.round(maxDrift * 10000) / 10000,
      lastCalibrationDate: lastCalDate,
      nextScheduledDate: nextScheduled,
      activeVersionId: null,  // Will be set by caller
      perHorizon: false,      // Will be set by caller
    };
  }

  /**
   * Get router audit log
   */
  getRouterAudit(params: {
    asset?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Array<{
    timestamp: string;
    chosen: 'v1' | 'v2';
    reason: string;
    asset: string;
  }> {
    let logs = [...this.routerLog];

    if (params.asset) {
      logs = logs.filter(l => l.asset === params.asset);
    }

    if (params.from) {
      const fromDate = new Date(params.from);
      logs = logs.filter(l => l.timestamp >= fromDate);
    }

    if (params.to) {
      const toDate = new Date(params.to);
      logs = logs.filter(l => l.timestamp <= toDate);
    }

    logs = logs.slice(-(params.limit || 100));

    return logs.map(l => ({
      timestamp: l.timestamp.toISOString(),
      chosen: l.chosen,
      reason: l.reason,
      asset: l.asset,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let instance: CompareService | null = null;

export function getCompareService(): CompareService {
  if (!instance) {
    instance = new CompareService();
  }
  return instance;
}
