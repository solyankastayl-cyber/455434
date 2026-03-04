/**
 * BLOCK 43.3 — Drift Injection Service
 * Simulates calibration degradation to test reliability response
 */

import { 
  FractalCalibrationV2Model,
  ICalibrationBucket 
} from './models/fractal_calibration_v2.model.js';
import { 
  reliabilitySnapshotWriter, 
  ReliabilitySnapshotInput 
} from './reliability_snapshot.writer.js';
import type { ReliabilityBadge } from './models/fractal_reliability_snapshot.model.js';

export interface DriftInjectParams {
  modelKey: string;
  presetKey: string;
  horizonDays: number;
  severity?: number;  // 0..1, default 0.25
}

export interface DriftInjectResult {
  ok: boolean;
  reason?: 'NO_CALIBRATION_DOC' | 'DB_ERROR';
  before?: { ece: number; brier: number; badge: ReliabilityBadge };
  after?: { ece: number; brier: number; badge: ReliabilityBadge };
  snapshotWritten?: boolean;
}

/**
 * Calculate reliability badge from ECE and Brier
 */
function calculateBadge(ece: number, brier: number): ReliabilityBadge {
  if (ece <= 0.05 && brier <= 0.15) return 'OK';
  if (ece <= 0.10 && brier <= 0.25) return 'WARN';
  if (ece <= 0.20 && brier <= 0.35) return 'DEGRADED';
  return 'CRITICAL';
}

/**
 * Calculate reliability score from components
 */
function calculateReliabilityScore(ece: number, brier: number): number {
  // Inverse of ECE and Brier (lower is better)
  const eceScore = Math.max(0, 1 - ece * 5);  // 0.2 ECE = 0 score
  const brierScore = Math.max(0, 1 - brier * 2);  // 0.5 Brier = 0 score
  return (eceScore * 0.6 + brierScore * 0.4);
}

export class DriftInjectService {
  /**
   * Inject drift into calibration buckets
   * This simulates miscalibration to test reliability response
   */
  async inject(params: DriftInjectParams): Promise<DriftInjectResult> {
    const { modelKey, presetKey, horizonDays, severity = 0.25 } = params;

    try {
      // 1. Find calibration document
      const doc = await FractalCalibrationV2Model.findOne({ 
        modelKey, 
        presetKey, 
        horizonDays 
      });

      if (!doc) {
        // Create initial calibration doc if doesn't exist
        const initialDoc = await this.createInitialCalibration(modelKey, presetKey, horizonDays);
        if (!initialDoc) {
          return { ok: false, reason: 'NO_CALIBRATION_DOC' };
        }
        // Now inject into the newly created doc
        return this.inject(params);
      }

      // 2. Store "before" state
      const beforeEce = doc.ece;
      const beforeBrier = doc.brier;
      const beforeBadge = calculateBadge(beforeEce, beforeBrier);

      // 3. "Break" calibration buckets - simulate miscalibration
      const buckets = doc.buckets.map((b) => {
        const bucket = b.toObject ? b.toObject() : b;
        // Shift postMean away from true accuracy (simulates drift)
        const shift = (Math.random() - 0.5) * 2 * severity * 0.15;
        const newPostMean = Math.min(0.99, Math.max(0.01, bucket.postMean + shift));
        return { ...bucket, postMean: newPostMean };
      });

      // 4. Increase ECE and Brier (worse calibration)
      const newEce = Math.min(1.0, doc.ece + severity * 0.15);
      const newBrier = Math.min(1.0, doc.brier + severity * 0.10);

      // 5. Update document
      doc.buckets = buckets as any;
      doc.ece = newEce;
      doc.brier = newBrier;
      doc.updatedAtTs = Date.now();
      await doc.save();

      // 6. Calculate "after" state
      const afterBadge = calculateBadge(newEce, newBrier);
      const afterScore = calculateReliabilityScore(newEce, newBrier);

      // 7. Write reliability snapshot (force write to capture change)
      const snapshotInput: ReliabilitySnapshotInput = {
        ts: Date.now(),
        modelKey,
        presetKey,
        badge: afterBadge,
        reliabilityScore: afterScore,
        components: {
          drift: severity,
          calibration: 1 - newEce,
          rolling: 0.8,  // Placeholder - would come from rolling service
          mcTail: 0.7,   // Placeholder - would come from MC service
        },
        metrics: {
          wfSharpe: 0,
          wfMaxDD: 0,
        },
        context: {
          phase: 'DRIFT_INJECTED',
          entropy: 0.5 + severity * 0.4,
        },
      };

      const { written } = await reliabilitySnapshotWriter.forceWrite(snapshotInput);

      console.log(`[DriftInject] ${modelKey}/${presetKey}: ECE ${beforeEce.toFixed(3)} → ${newEce.toFixed(3)}, Badge ${beforeBadge} → ${afterBadge}`);

      return {
        ok: true,
        before: { ece: beforeEce, brier: beforeBrier, badge: beforeBadge },
        after: { ece: newEce, brier: newBrier, badge: afterBadge },
        snapshotWritten: written,
      };
    } catch (err) {
      console.error('[DriftInject] Error:', err);
      return { ok: false, reason: 'DB_ERROR' };
    }
  }

  /**
   * Reset calibration to clean state
   */
  async reset(modelKey: string, presetKey: string, horizonDays: number): Promise<{ ok: boolean }> {
    try {
      await FractalCalibrationV2Model.deleteOne({ modelKey, presetKey, horizonDays });
      await this.createInitialCalibration(modelKey, presetKey, horizonDays);
      return { ok: true };
    } catch (err) {
      console.error('[DriftInject] Reset failed:', err);
      return { ok: false };
    }
  }

  /**
   * Create initial calibration document with good baseline
   */
  private async createInitialCalibration(
    modelKey: string, 
    presetKey: string, 
    horizonDays: number
  ) {
    // Create default buckets with reasonable calibration
    const defaultBuckets: ICalibrationBucket[] = [
      { bucketKey: '0.00-0.20', n: 50, wins: 8, losses: 42, postMean: 0.16, ci90Low: 0.10, ci90High: 0.24 },
      { bucketKey: '0.20-0.40', n: 80, wins: 24, losses: 56, postMean: 0.30, ci90Low: 0.22, ci90High: 0.38 },
      { bucketKey: '0.40-0.60', n: 120, wins: 60, losses: 60, postMean: 0.50, ci90Low: 0.42, ci90High: 0.58 },
      { bucketKey: '0.60-0.80', n: 90, wins: 63, losses: 27, postMean: 0.70, ci90Low: 0.62, ci90High: 0.78 },
      { bucketKey: '0.80-1.00', n: 40, wins: 34, losses: 6, postMean: 0.85, ci90Low: 0.75, ci90High: 0.92 },
    ];

    try {
      const doc = await FractalCalibrationV2Model.create({
        modelKey,
        presetKey,
        horizonDays,
        similarityMode: 'multi_rep',
        buckets: defaultBuckets,
        ece: 0.04,  // Good calibration
        brier: 0.18,
        updatedAtTs: Date.now(),
      });
      return doc;
    } catch (err) {
      console.error('[DriftInject] Failed to create initial calibration:', err);
      return null;
    }
  }
}

// Singleton instance
export const driftInjectService = new DriftInjectService();
