/**
 * Phase 5: Calibration Runtime Service
 * Applies active calibration map on-the-fly
 */
import { CalibrationActiveModel } from './calibration_active.model.js';
import { CalibrationMapModel, ICalibrationBin } from './calibration_map.model.js';
import { calibrationApplyService } from './calibration_apply.service.js';

interface CalibrationContext {
  stratum?: string;
  severity?: string;
  token?: string;
  actorCount?: number;
}

export class CalibrationRuntimeService {
  // Cache for active maps (in-memory, refreshed periodically)
  private mapCache: Map<string, { bins: ICalibrationBin[]; mapId: string; runId: string }> = new Map();
  private cacheTs: Map<string, number> = new Map();
  private cacheTTL = 60 * 1000; // 1 minute

  /**
   * Calibrate confidence using active map
   */
  async calibrateConfidence(
    window: '24h' | '7d',
    rawConfidence: number,
    context: CalibrationContext = {},
    opts: { audit?: boolean; sampleKey?: string } = {}
  ): Promise<number> {
    // 1. Check if calibration is active
    const active = await CalibrationActiveModel.findOne({ window });
    
    if (!active || active.status !== 'ACTIVE' || !active.activeMapId) {
      return rawConfidence; // No calibration, return raw
    }

    // 2. Get calibration map (with caching)
    const map = await this.getActiveMap(window, active.activeMapId);
    
    if (!map) {
      console.warn(`[CalRuntime] Active map ${active.activeMapId} not found, skipping calibration`);
      return rawConfidence;
    }

    // 3. Apply calibration
    const calibratedConfidence = this.applyCalibrationMap(rawConfidence, map.bins);

    // 4. Audit logging (if requested)
    if (opts.audit && opts.sampleKey) {
      await calibrationApplyService.logCalibrationApplication(
        window,
        opts.sampleKey,
        rawConfidence,
        calibratedConfidence,
        map.mapId,
        map.runId
      );
    }

    return calibratedConfidence;
  }

  /**
   * Get active calibration map (with caching)
   */
  private async getActiveMap(
    window: string,
    mapId: string
  ): Promise<{ bins: ICalibrationBin[]; mapId: string; runId: string } | null> {
    const cacheKey = `${window}-${mapId}`;
    const now = Date.now();

    // Check cache
    const cached = this.mapCache.get(cacheKey);
    const cachedTs = this.cacheTs.get(cacheKey) || 0;

    if (cached && now - cachedTs < this.cacheTTL) {
      return cached;
    }

    // Fetch from DB
    const map = await CalibrationMapModel.findOne({ mapId });
    
    if (!map) {
      return null;
    }

    const mapData = {
      bins: map.bins,
      mapId: map.mapId,
      runId: map.runId,
    };

    // Update cache
    this.mapCache.set(cacheKey, mapData);
    this.cacheTs.set(cacheKey, now);

    return mapData;
  }

  /**
   * Apply calibration map to confidence value
   */
  private applyCalibrationMap(rawConfidence: number, bins: ICalibrationBin[]): number {
    // Find appropriate bin
    const binSize = 1.0 / bins.length;
    const binIdx = Math.min(Math.floor(rawConfidence / binSize), bins.length - 1);
    const bin = bins[binIdx];

    if (!bin || bin.n === 0) {
      return rawConfidence; // No data in bin, return raw
    }

    // Apply adjustment
    const adjFactor = 1 + bin.adjPct / 100;
    let calibratedConf = rawConfidence * adjFactor;

    // Clamp to [0, 1]
    calibratedConf = Math.max(0, Math.min(1, calibratedConf));

    return calibratedConf;
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.mapCache.clear();
    this.cacheTs.clear();
    console.log('[CalRuntime] Cache cleared');
  }

  /**
   * Batch calibrate multiple confidences
   */
  async calibrateBatch(
    window: '24h' | '7d',
    samples: Array<{ key: string; confidence: number; context?: CalibrationContext }>
  ): Promise<Array<{ key: string; rawConfidence: number; calibratedConfidence: number }>> {
    const results = [];

    for (const sample of samples) {
      const calibrated = await this.calibrateConfidence(
        window,
        sample.confidence,
        sample.context || {},
        { audit: false } // No audit for batch
      );

      results.push({
        key: sample.key,
        rawConfidence: sample.confidence,
        calibratedConfidence: calibrated,
      });
    }

    return results;
  }
}

export const calibrationRuntimeService = new CalibrationRuntimeService();
