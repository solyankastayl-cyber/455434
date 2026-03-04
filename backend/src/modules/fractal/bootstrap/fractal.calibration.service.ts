/**
 * BLOCK 25: Confidence Calibration Service
 * Checks if confidence scores are well-calibrated
 */

import { FractalPerfModel } from '../data/schemas/fractal-performance.schema.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';

export class FractalCalibrationService {
  /**
   * Build calibration report by confidence buckets
   */
  async buildCalibration(): Promise<{
    ok: boolean;
    reason?: string;
    buckets?: {
      bucket: string;
      samples: number;
      empiricalHitRate: number;
      expectedHitRate: number;
      calibrationError: number;
    }[];
  }> {
    const rows = await FractalPerfModel.find({})
      .sort({ windowEndTs: -1 })
      .limit(1000)
      .lean();

    if (rows.length < 50) {
      return { ok: false, reason: 'NOT_ENOUGH_DATA' };
    }

    // 5 confidence buckets
    const buckets = [
      { min: 0, max: 0.2, expected: 0.1 },
      { min: 0.2, max: 0.4, expected: 0.3 },
      { min: 0.4, max: 0.6, expected: 0.5 },
      { min: 0.6, max: 0.8, expected: 0.7 },
      { min: 0.8, max: 1.0, expected: 0.9 }
    ];

    const result: any[] = [];

    for (const b of buckets) {
      const subset = rows.filter(r => {
        const c = this.computeConfidence(r);
        return c >= b.min && c < b.max;
      });

      if (!subset.length) continue;

      const hitRate = subset.reduce((s, r) => s + (r.hit ? 1 : 0), 0) / subset.length;
      const calibrationError = Math.abs(hitRate - b.expected);

      result.push({
        bucket: `${b.min}-${b.max}`,
        samples: subset.length,
        empiricalHitRate: Math.round(hitRate * 1000) / 1000,
        expectedHitRate: b.expected,
        calibrationError: Math.round(calibrationError * 1000) / 1000
      });
    }

    return { ok: true, buckets: result };
  }

  /**
   * Auto-calibrate confidence scaling
   */
  async autoCalibrate(symbol = 'BTC'): Promise<{
    ok: boolean;
    scale?: number;
    bias?: number;
  }> {
    const calibration = await this.buildCalibration();
    if (!calibration.ok || !calibration.buckets) {
      return { ok: false };
    }

    // Simple linear regression to find scale/bias
    // y = empirical, x = expected
    const points = calibration.buckets.map(b => ({
      x: b.expectedHitRate,
      y: b.empiricalHitRate
    }));

    if (points.length < 3) {
      return { ok: false };
    }

    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

    const scale = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const bias = (sumY - scale * sumX) / n;

    // Clamp to reasonable values
    const clampedScale = Math.max(0.5, Math.min(2.0, scale));
    const clampedBias = Math.max(-0.3, Math.min(0.3, bias));

    await FractalSettingsModel.updateOne(
      { symbol },
      {
        $set: {
          confidenceScale: clampedScale,
          confidenceBias: clampedBias,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    return {
      ok: true,
      scale: Math.round(clampedScale * 1000) / 1000,
      bias: Math.round(clampedBias * 1000) / 1000
    };
  }

  private computeConfidence(row: any): number {
    const eff = row.confidence?.effectiveSampleSize ?? 0;
    const reg = row.confidence?.regimeConsistency ?? 0;

    // Normalize effectiveSampleSize (0-50 range)
    const effNorm = Math.min(1, eff / 50);

    return 0.5 * effNorm + 0.5 * reg;
  }
}
