/**
 * BLOCK 23: Fractal Auto-Tune Service
 * Self-learning parameter adjustment based on performance
 */

import { FractalPerfModel } from '../data/schemas/fractal-performance.schema.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';

export class FractalAutoTuneService {
  /**
   * Auto-adjust parameters based on rolling performance
   */
  async autoAdjust(symbol = 'BTC'): Promise<{
    ok: boolean;
    reason?: string;
    hitRate?: number;
    mae?: number;
    newSettings?: {
      minWindowQuality: number;
      scoreQualityPower: number;
      regimeWeightBoost: number;
    };
  }> {
    // Get recent performance data
    const rows = await FractalPerfModel.find({})
      .sort({ windowEndTs: -1 })
      .limit(300)
      .lean();

    if (rows.length < 50) {
      return { ok: false, reason: 'NOT_ENOUGH_DATA' };
    }

    // Calculate metrics
    const hitRate = rows.reduce((s, r) => s + (r.hit ? 1 : 0), 0) / rows.length;
    const mae = rows.reduce((s, r) => s + Math.abs(r.errorAbs ?? 0), 0) / rows.length;

    // Get current settings or defaults
    const current = await FractalSettingsModel.findOne({ symbol }).lean();
    
    let minWindowQuality = current?.minWindowQuality ?? 0.7;
    let scoreQualityPower = current?.scoreQualityPower ?? 1.5;
    let regimeWeightBoost = current?.regimeWeightBoost ?? 1.0;

    // ═══════════════════════════════════════════════════════════════
    // ADJUSTMENT LOGIC
    // ═══════════════════════════════════════════════════════════════

    // If hit rate is low, increase quality requirements
    if (hitRate < 0.45) {
      minWindowQuality = Math.min(0.9, minWindowQuality + 0.05);
      scoreQualityPower = Math.min(3.0, scoreQualityPower + 0.2);
    }

    // If MAE is high, penalize low-quality matches more
    if (mae > 0.20) {
      scoreQualityPower = Math.min(3.0, scoreQualityPower + 0.3);
    }

    // If hit rate is good, boost regime weighting
    if (hitRate > 0.65) {
      regimeWeightBoost = Math.min(2.0, regimeWeightBoost + 0.1);
    }

    // Clamp values
    minWindowQuality = Math.max(0.5, Math.min(0.95, minWindowQuality));
    scoreQualityPower = Math.max(1.0, Math.min(3.0, scoreQualityPower));
    regimeWeightBoost = Math.max(0.5, Math.min(2.0, regimeWeightBoost));

    // Round for cleaner values
    minWindowQuality = Math.round(minWindowQuality * 100) / 100;
    scoreQualityPower = Math.round(scoreQualityPower * 100) / 100;
    regimeWeightBoost = Math.round(regimeWeightBoost * 100) / 100;

    // Save settings
    await FractalSettingsModel.updateOne(
      { symbol },
      {
        $set: {
          minWindowQuality,
          scoreQualityPower,
          regimeWeightBoost,
          lastTuneMetrics: {
            hitRate,
            mae,
            sampleCount: rows.length
          },
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    return {
      ok: true,
      hitRate,
      mae,
      newSettings: {
        minWindowQuality,
        scoreQualityPower,
        regimeWeightBoost
      }
    };
  }

  /**
   * Get current settings
   */
  async getSettings(symbol = 'BTC'): Promise<{
    minWindowQuality: number;
    scoreQualityPower: number;
    regimeWeightBoost: number;
  }> {
    const settings = await FractalSettingsModel.findOne({ symbol }).lean();
    
    return {
      minWindowQuality: settings?.minWindowQuality ?? 0.7,
      scoreQualityPower: settings?.scoreQualityPower ?? 1.5,
      regimeWeightBoost: settings?.regimeWeightBoost ?? 1.0
    };
  }
}
