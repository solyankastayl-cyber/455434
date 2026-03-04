/**
 * BLOCK 28: Weight Optimizer Service
 * Auto-optimizes ensemble weights (Rule + ML)
 */

import { FractalPerfModel } from '../data/schemas/fractal-performance.schema.js';
import { FractalSettingsModel } from '../data/schemas/fractal-settings.schema.js';

export class FractalWeightOptimizer {
  /**
   * Grid search to find optimal ensemble weights
   */
  async optimize(symbol = 'BTC'): Promise<{
    ok: boolean;
    reason?: string;
    bestSharpe?: number;
    best?: {
      w_rule: number;
      w_ml: number;
      threshold: number;
    };
    trades?: number;
  }> {
    const rows = await FractalPerfModel.find({})
      .sort({ windowEndTs: -1 })
      .limit(800)
      .lean();

    if (rows.length < 100) {
      return { ok: false, reason: 'NOT_ENOUGH_DATA' };
    }

    let bestSharpe = -999;
    let best = { w_rule: 0.5, w_ml: 0.5, threshold: 0.15 };
    let bestTrades = 0;

    // Grid search
    for (let w_rule = 0; w_rule <= 1; w_rule += 0.1) {
      const w_ml = Math.round((1 - w_rule) * 10) / 10;

      for (const threshold of [0.05, 0.1, 0.15, 0.2, 0.25]) {
        const returns: number[] = [];

        for (const r of rows) {
          // Rule signal: p50 return normalized
          const ruleScore = Math.max(-0.5, Math.min(0.5, r.implied?.p50Return ?? 0)) * 2;
          
          // ML signal: use rawScore as proxy (or real ML if available)
          const mlScore = ((r.confidence?.rawScore ?? 0.5) - 0.5) * 2;

          const score = w_rule * ruleScore + w_ml * mlScore;

          if (score > threshold) {
            returns.push(r.realized?.forwardReturn ?? 0);
          } else if (score < -threshold) {
            returns.push(-(r.realized?.forwardReturn ?? 0));
          }
        }

        if (returns.length < 30) continue;

        const sharpe = this.calculateSharpe(returns);

        if (sharpe > bestSharpe) {
          bestSharpe = sharpe;
          best = { w_rule, w_ml, threshold };
          bestTrades = returns.length;
        }
      }
    }

    // Save to settings
    await FractalSettingsModel.updateOne(
      { symbol },
      {
        $set: {
          ensemble: best,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    return {
      ok: true,
      bestSharpe: Math.round(bestSharpe * 1000) / 1000,
      best,
      trades: bestTrades
    };
  }

  /**
   * Get current ensemble settings
   */
  async getEnsembleSettings(symbol = 'BTC'): Promise<{
    w_rule: number;
    w_ml: number;
    threshold: number;
  }> {
    const settings = await FractalSettingsModel.findOne({ symbol }).lean();

    return {
      w_rule: settings?.ensemble?.w_rule ?? 0.5,
      w_ml: settings?.ensemble?.w_ml ?? 0.5,
      threshold: settings?.ensemble?.threshold ?? 0.15
    };
  }

  private calculateSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);

    // Annualized (assuming 30-day trades)
    return std === 0 ? 0 : (mean / std) * Math.sqrt(12);
  }
}
