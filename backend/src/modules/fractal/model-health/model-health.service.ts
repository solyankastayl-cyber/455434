/**
 * BLOCK 85 — Model Health Service
 * 
 * Computes composite model health score (0-100) from:
 * - LIVE vs Bootstrap performance (30%)
 * - Drift Severity (20%)
 * - Phase Strength (20%)
 * - Divergence Score (15%)
 * - Structural Stability (15%)
 */

import { IntelTimelineModel } from '../intel-timeline/intel-timeline.model.js';

export type HealthBand = 'STRONG' | 'STABLE' | 'MODERATE' | 'WEAK';
export type DriftSeverity = 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';
export type ConflictLevel = 'LOW' | 'MODERATE' | 'HIGH';

export interface HealthComponents {
  performanceScore: number;
  driftPenalty: number;
  phaseScore: number;
  divergenceScore: number;
  stabilityScore: number;
}

export interface ModelHealthResult {
  score: number;
  band: HealthBand;
  components: HealthComponents;
  inputs: {
    liveHitRate: number;
    bootstrapHitRate: number;
    driftSeverity: DriftSeverity;
    phaseScore: number;
    divergenceScore: number;
    structuralLock: boolean;
    conflictLevel: ConflictLevel;
  };
  lastUpdated: string;
}

class ModelHealthService {
  
  /**
   * Compute composite health score
   */
  compute(params: {
    liveHitRate: number;
    bootstrapHitRate: number;
    driftSeverity: DriftSeverity;
    phaseScore: number;
    divergenceScore: number;
    structuralLock: boolean;
    conflictLevel: ConflictLevel;
  }): ModelHealthResult {
    const {
      liveHitRate,
      bootstrapHitRate,
      driftSeverity,
      phaseScore,
      divergenceScore,
      structuralLock,
      conflictLevel,
    } = params;

    // 1) Performance Score (30%) — LIVE vs Bootstrap delta
    const driftDelta = Math.abs(liveHitRate - bootstrapHitRate);
    const performanceScore = Math.max(0, 100 - driftDelta * 200); // 0.5 delta = 0 score

    // 2) Drift Penalty (20%) — Based on severity
    const driftPenaltyMap: Record<DriftSeverity, number> = {
      OK: 100,
      WATCH: 80,
      WARN: 60,
      CRITICAL: 40,
    };
    const driftPenalty = driftPenaltyMap[driftSeverity];

    // 3) Phase Score (20%) — Direct from intel timeline
    const normalizedPhaseScore = Math.max(0, Math.min(100, phaseScore));

    // 4) Divergence Score (15%) — Direct from intel timeline
    const normalizedDivergenceScore = Math.max(0, Math.min(100, divergenceScore));

    // 5) Stability Score (15%) — Based on lock + conflict
    let stabilityScore = 100;
    if (structuralLock && conflictLevel === 'HIGH') {
      stabilityScore = 50;
    } else if (structuralLock) {
      stabilityScore = 80;
    } else if (conflictLevel === 'HIGH') {
      stabilityScore = 70;
    } else if (conflictLevel === 'MODERATE') {
      stabilityScore = 90;
    }

    // Composite Score
    const score = Math.round(
      performanceScore * 0.30 +
      driftPenalty * 0.20 +
      normalizedPhaseScore * 0.20 +
      normalizedDivergenceScore * 0.15 +
      stabilityScore * 0.15
    );

    // Band classification
    let band: HealthBand;
    if (score >= 80) band = 'STRONG';
    else if (score >= 65) band = 'STABLE';
    else if (score >= 50) band = 'MODERATE';
    else band = 'WEAK';

    return {
      score,
      band,
      components: {
        performanceScore: Math.round(performanceScore),
        driftPenalty,
        phaseScore: normalizedPhaseScore,
        divergenceScore: normalizedDivergenceScore,
        stabilityScore,
      },
      inputs: params,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get current model health from latest intel timeline + drift data
   */
  async getCurrent(symbol = 'BTC'): Promise<ModelHealthResult> {
    // Get latest LIVE intel snapshot
    const latest = await IntelTimelineModel.findOne({ 
      symbol, 
      source: 'LIVE' 
    })
      .sort({ date: -1 })
      .lean();

    // Default values if no data
    const defaults = {
      liveHitRate: 0.5,
      bootstrapHitRate: 0.52,
      driftSeverity: 'WATCH' as DriftSeverity,
      phaseScore: 50,
      divergenceScore: 50,
      structuralLock: false,
      conflictLevel: 'LOW' as ConflictLevel,
    };

    if (!latest) {
      return this.compute(defaults);
    }

    // Extract values from latest snapshot
    return this.compute({
      liveHitRate: latest.phaseHitRate || 0.5,
      bootstrapHitRate: 0.52, // TODO: pull from drift intelligence
      driftSeverity: this.mapDivergenceToSeverity(latest.divergenceGrade),
      phaseScore: latest.phaseScore || 50,
      divergenceScore: latest.divergenceScore || 50,
      structuralLock: latest.structuralLock || false,
      conflictLevel: (latest.conflictLevel as ConflictLevel) || 'LOW',
    });
  }

  /**
   * Map divergence grade to drift severity
   */
  private mapDivergenceToSeverity(grade: string | undefined): DriftSeverity {
    switch (grade) {
      case 'A': return 'OK';
      case 'B': return 'OK';
      case 'C': return 'WATCH';
      case 'D': return 'WARN';
      case 'F': return 'CRITICAL';
      default: return 'WATCH';
    }
  }
}

export const modelHealthService = new ModelHealthService();
export default modelHealthService;
