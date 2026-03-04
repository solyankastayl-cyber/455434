/**
 * BLOCK 38.6 + 38.7 — Calibration V2 Service (Bayesian + effectiveN floor)
 * 
 * Beta-Binomial calibration per bucket with effectiveN confidence ceiling.
 */

import {
  CalibrationV2Config,
  BucketStats,
  CalibrationSnapshot,
  ConfidenceFloorConfig,
  DEFAULT_CALIBRATION_V2_CONFIG,
  DEFAULT_CONFIDENCE_FLOOR_CONFIG,
} from '../contracts/calibration-v2.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function bucketIndex(rawConf: number, numBuckets: number): number {
  const x = clamp01(rawConf);
  return Math.min(numBuckets - 1, Math.floor(x * numBuckets));
}

function bucketRange(i: number, numBuckets: number): { lo: number; hi: number } {
  return {
    lo: i / numBuckets,
    hi: (i + 1) / numBuckets,
  };
}

function posteriorMean(k: number, n: number, priorA: number, priorB: number): number {
  return (k + priorA) / (n + priorA + priorB);
}

// ═══════════════════════════════════════════════════════════════
// In-Memory Calibration Store
// ═══════════════════════════════════════════════════════════════

// Simple in-memory store (in production, use MongoDB)
const calibrationStore = new Map<string, {
  buckets: Array<{ i: number; n: number; k: number; meanEma: number | null }>;
  config: CalibrationV2Config;
  totalN: number;
  ece: number;
  updatedAtTs: number;
}>();

function getStoreKey(symbol: string, horizonDays: number): string {
  return `${symbol}:${horizonDays}`;
}

// ═══════════════════════════════════════════════════════════════
// Calibration V2 Service
// ═══════════════════════════════════════════════════════════════

export class CalibrationV2Service {
  constructor(
    private cfg: CalibrationV2Config = DEFAULT_CALIBRATION_V2_CONFIG,
    private floorCfg: ConfidenceFloorConfig = DEFAULT_CONFIDENCE_FLOOR_CONFIG
  ) {}

  /**
   * Get calibration snapshot
   */
  getSnapshot(symbol: string, horizonDays: number): CalibrationSnapshot {
    const key = getStoreKey(symbol, horizonDays);
    const doc = calibrationStore.get(key);
    
    const cfg = doc?.config ?? this.cfg;
    const buckets: BucketStats[] = [];
    let totalN = 0;
    
    for (let i = 0; i < cfg.buckets; i++) {
      const b = doc?.buckets?.find(x => x.i === i);
      const n = b?.n ?? 0;
      const k = b?.k ?? 0;
      totalN += n;
      
      const { lo, hi } = bucketRange(i, cfg.buckets);
      const mean = posteriorMean(k, n, cfg.priorA, cfg.priorB);
      
      buckets.push({
        i,
        lo,
        hi,
        n,
        k,
        mean: Math.round(mean * 1000) / 1000,
        meanEma: b?.meanEma ?? undefined,
      });
    }
    
    const ece = this.computeECE(buckets);
    
    return {
      symbol,
      horizonDays,
      asOfTs: Date.now(),
      config: cfg,
      buckets,
      totalN,
      ece: Math.round(ece * 10000) / 10000,
      isUsable: totalN >= cfg.minSamplesForUse,
    };
  }

  /**
   * Update calibration with new observation
   */
  update(symbol: string, horizonDays: number, rawConf: number, correct: 0 | 1): void {
    const key = getStoreKey(symbol, horizonDays);
    const cfg = this.cfg;
    const i = bucketIndex(rawConf, cfg.buckets);
    
    let doc = calibrationStore.get(key);
    
    if (!doc) {
      doc = {
        buckets: Array.from({ length: cfg.buckets }, (_, j) => ({
          i: j,
          n: 0,
          k: 0,
          meanEma: null,
        })),
        config: cfg,
        totalN: 0,
        ece: 0,
        updatedAtTs: Date.now(),
      };
      calibrationStore.set(key, doc);
    }
    
    const b = doc.buckets.find(x => x.i === i);
    if (b) {
      b.n += 1;
      b.k += correct;
      
      // EMA smoothing
      const mean = posteriorMean(b.k, b.n, cfg.priorA, cfg.priorB);
      if (cfg.emaAlpha != null) {
        b.meanEma = b.meanEma == null
          ? mean
          : cfg.emaAlpha * mean + (1 - cfg.emaAlpha) * b.meanEma;
      }
    }
    
    doc.totalN = doc.buckets.reduce((s, x) => s + x.n, 0);
    doc.updatedAtTs = Date.now();
    
    // Recompute ECE
    const snapshotBuckets = doc.buckets.map(x => {
      const { lo, hi } = bucketRange(x.i, cfg.buckets);
      const m = x.meanEma ?? posteriorMean(x.k, x.n, cfg.priorA, cfg.priorB);
      return { i: x.i, lo, hi, n: x.n, k: x.k, mean: m };
    });
    doc.ece = this.computeECE(snapshotBuckets);
  }

  /**
   * Apply calibration to raw confidence
   */
  apply(rawConf: number, snapshot: CalibrationSnapshot): number {
    // If not enough data, shrink toward 0.5
    if (!snapshot.isUsable) {
      const x = clamp01(rawConf);
      return 0.5 + 0.8 * (x - 0.5);
    }
    
    const i = bucketIndex(rawConf, snapshot.config.buckets);
    const b = snapshot.buckets[i];
    return clamp01(b?.mean ?? rawConf);
  }

  /**
   * Apply effectiveN floor to confidence
   */
  applyEffectiveNFloor(confidence: number, effectiveN: number): number {
    if (!this.floorCfg.enabled) {
      return confidence;
    }
    
    // Find applicable floor
    let maxConf = 1.0;
    for (const floor of this.floorCfg.floors) {
      if (effectiveN >= floor.minEffectiveN) {
        maxConf = floor.maxConfidence;
      }
    }
    
    // Also apply smooth ceiling
    const smoothCeiling = 1 - Math.exp(-effectiveN / this.floorCfg.n0);
    maxConf = Math.min(maxConf, smoothCeiling);
    
    return Math.min(confidence, maxConf);
  }

  /**
   * Full calibration pipeline
   */
  calibrate(
    rawConf: number,
    effectiveN: number,
    symbol: string,
    horizonDays: number
  ): {
    rawConfidence: number;
    calibratedConfidence: number;
    effectiveNCapped: number;
    snapshot: CalibrationSnapshot;
  } {
    const snapshot = this.getSnapshot(symbol, horizonDays);
    
    // Step 1: Apply bucket calibration
    const calibrated = this.apply(rawConf, snapshot);
    
    // Step 2: Apply effectiveN floor
    const capped = this.applyEffectiveNFloor(calibrated, effectiveN);
    
    return {
      rawConfidence: Math.round(rawConf * 1000) / 1000,
      calibratedConfidence: Math.round(calibrated * 1000) / 1000,
      effectiveNCapped: Math.round(capped * 1000) / 1000,
      snapshot,
    };
  }

  /**
   * Compute ECE from buckets
   */
  private computeECE(buckets: BucketStats[]): number {
    const N = buckets.reduce((s, b) => s + b.n, 0);
    if (N === 0) return 0;
    
    let ece = 0;
    for (const b of buckets) {
      if (b.n <= 0) continue;
      const acc = b.k / b.n;
      const conf = b.mean;
      const w = b.n / N;
      ece += w * Math.abs(acc - conf);
    }
    return ece;
  }

  /**
   * Reset calibration (for testing)
   */
  reset(symbol: string, horizonDays: number): void {
    const key = getStoreKey(symbol, horizonDays);
    calibrationStore.delete(key);
  }

  /**
   * Bulk update with mock data (for testing)
   */
  bulkUpdateMock(
    symbol: string,
    horizonDays: number,
    count: number,
    quality: 'good' | 'medium' | 'bad' = 'medium'
  ): void {
    for (let i = 0; i < count; i++) {
      const rawConf = Math.random();
      
      let trueProb: number;
      switch (quality) {
        case 'good':
          trueProb = rawConf + (Math.random() - 0.5) * 0.1;
          break;
        case 'medium':
          trueProb = rawConf * 0.8 + 0.1;
          break;
        case 'bad':
          trueProb = 0.5 + (Math.random() - 0.5) * 0.3;
          break;
      }
      
      trueProb = Math.max(0, Math.min(1, trueProb));
      const correct: 0 | 1 = Math.random() < trueProb ? 1 : 0;
      
      this.update(symbol, horizonDays, rawConf, correct);
    }
  }
}

// Singleton instance
export const calibrationV2Service = new CalibrationV2Service();
