/**
 * Calibration Service — High-level API for calibration operations
 * 
 * Phase 6: Calibration Layer
 * 
 * Provides:
 * - Calibration curve generation
 * - Per-pattern-type calibration
 * - Score → probability mapping
 * - Calibration health monitoring
 */

import { Db } from 'mongodb';
import { getMongoDb } from '../../../db/mongoose.js';
import { 
  buildCalibrationDataset, 
  buildCalibrationDatasetByType,
  getPatternTypes,
  CalibrationDataPoint 
} from './calibration.dataset.js';
import {
  buildCalibrationResult,
  buildCalibrationBins,
  calibrateScore,
  calibratePatterns,
  CalibrationResult,
  CalibrationBin,
  CalibrationConfig,
  DEFAULT_CALIBRATION_CONFIG
} from './calibration.engine.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type PatternTypeCalibration = {
  type: string;
  calibration: CalibrationResult;
};

export type CalibrationHealth = {
  status: 'HEALTHY' | 'DEGRADED' | 'INSUFFICIENT_DATA';
  totalOutcomes: number;
  minOutcomesNeeded: number;
  overallECE: number;
  patternTypesCalibrated: number;
  lastUpdated: string;
  recommendation: string;
};

// ═══════════════════════════════════════════════════════════════
// Calibration Service
// ═══════════════════════════════════════════════════════════════

export class CalibrationService {
  private db: Db | null = null;
  private cachedBins: CalibrationBin[] | null = null;
  private cacheTs: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  private getDb(): Db {
    if (!this.db) {
      this.db = getMongoDb();
    }
    return this.db;
  }

  /**
   * Get overall calibration curve
   */
  async getCalibration(options: {
    asset?: string;
    since?: Date;
    config?: Partial<CalibrationConfig>;
  } = {}): Promise<CalibrationResult> {
    const db = this.getDb();
    const { asset, since, config } = options;

    const dataset = await buildCalibrationDataset(db, { asset, since });
    return buildCalibrationResult(dataset, config);
  }

  /**
   * Get calibration for a specific pattern type
   */
  async getCalibrationByType(
    patternType: string,
    options: {
      asset?: string;
      since?: Date;
      config?: Partial<CalibrationConfig>;
    } = {}
  ): Promise<CalibrationResult> {
    const db = this.getDb();
    const { asset, since, config } = options;

    const dataset = await buildCalibrationDatasetByType(db, patternType, { asset, since });
    return buildCalibrationResult(dataset, config);
  }

  /**
   * Get calibration for all pattern types
   */
  async getAllPatternTypeCalibrations(options: {
    asset?: string;
    since?: Date;
    config?: Partial<CalibrationConfig>;
  } = {}): Promise<PatternTypeCalibration[]> {
    const db = this.getDb();
    const types = await getPatternTypes(db);

    const results: PatternTypeCalibration[] = [];

    for (const type of types) {
      const calibration = await this.getCalibrationByType(type, options);
      if (calibration.totalRecords > 0) {
        results.push({ type, calibration });
      }
    }

    // Sort by total records descending
    results.sort((a, b) => b.calibration.totalRecords - a.calibration.totalRecords);

    return results;
  }

  /**
   * Calibrate a score using cached bins
   */
  async calibrateScore(score: number, options: {
    asset?: string;
    forceRefresh?: boolean;
  } = {}): Promise<number> {
    const bins = await this.getBins(options);
    return calibrateScore(score, bins);
  }

  /**
   * Get calibration bins (with caching)
   */
  async getBins(options: {
    asset?: string;
    forceRefresh?: boolean;
  } = {}): Promise<CalibrationBin[]> {
    const { forceRefresh = false } = options;
    const now = Date.now();

    // Check cache
    if (!forceRefresh && this.cachedBins && (now - this.cacheTs) < this.cacheTTL) {
      return this.cachedBins;
    }

    // Rebuild calibration
    const db = this.getDb();
    const dataset = await buildCalibrationDataset(db, { asset: options.asset });
    this.cachedBins = buildCalibrationBins(dataset);
    this.cacheTs = now;

    return this.cachedBins;
  }

  /**
   * Get calibration health status
   */
  async getHealth(asset?: string): Promise<CalibrationHealth> {
    const db = this.getDb();
    const MIN_OUTCOMES = 100;

    // Get overall stats
    const calibration = await this.getCalibration({ asset });
    const typeCalibrations = await this.getAllPatternTypeCalibrations({ asset });

    let status: 'HEALTHY' | 'DEGRADED' | 'INSUFFICIENT_DATA';
    let recommendation: string;

    if (calibration.totalRecords < MIN_OUTCOMES) {
      status = 'INSUFFICIENT_DATA';
      recommendation = `Need ${MIN_OUTCOMES - calibration.totalRecords} more outcomes for reliable calibration`;
    } else if (calibration.reliability === 'GOOD') {
      status = 'HEALTHY';
      recommendation = 'Calibration is working well. Continue collecting data.';
    } else if (calibration.reliability === 'MODERATE') {
      status = 'DEGRADED';
      recommendation = 'Calibration has moderate error. Review pattern scoring weights.';
    } else {
      status = 'DEGRADED';
      recommendation = 'Calibration error is high. Consider adjusting detection thresholds.';
    }

    return {
      status,
      totalOutcomes: calibration.totalRecords,
      minOutcomesNeeded: MIN_OUTCOMES,
      overallECE: calibration.calibrationError,
      patternTypesCalibrated: typeCalibrations.length,
      lastUpdated: calibration.generatedAt,
      recommendation,
    };
  }

  /**
   * Clear calibration cache
   */
  clearCache(): void {
    this.cachedBins = null;
    this.cacheTs = 0;
  }
}

// Singleton instance
export const calibrationService = new CalibrationService();
