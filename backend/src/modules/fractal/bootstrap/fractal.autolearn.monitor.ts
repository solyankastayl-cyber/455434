/**
 * BLOCK 29.11: AutoLearn Monitor (Degradation & Rollback)
 * Monitors active model performance and triggers rollback if degraded
 */

import { FractalBacktestService } from '../backtest/fractal.backtest.service.js';
import { FractalPromotionService } from './fractal.promotion.service.js';
import { FractalAutoLearnStateModel } from '../data/schemas/fractal-autolearn-state.schema.js';

export class FractalAutoLearnMonitor {
  private backtest = new FractalBacktestService();
  private promo = new FractalPromotionService();

  // Degradation threshold
  private readonly SHARPE_THRESHOLD = 0.8;
  private readonly CONSECUTIVE_BAD_LIMIT = 3;

  async check(symbol = 'BTC'): Promise<{
    ok: boolean;
    degraded: boolean;
    sharpe: number;
    consecutiveBad: number;
    rollback?: { ok: boolean; rolledBackTo?: string; reason?: string };
  }> {
    // Run backtest on recent 2-year window with ACTIVE model
    const now = new Date();
    const twoYearsAgo = new Date(now.getTime() - 365 * 2 * 24 * 60 * 60 * 1000);

    console.log(`[Monitor] Checking ACTIVE model performance on recent 2-year window`);

    const run = await this.backtest.run({
      symbol,
      windowLen: 60,
      horizonDays: 30,
      topK: 25,
      minGapDays: 60,
      startDate: twoYearsAgo,
      endDate: now,
      mlVersion: 'ACTIVE'
    });

    const sharpe = Number(run.sharpe ?? 0);

    // Get current state
    const state = await FractalAutoLearnStateModel.findOne({ symbol }).lean();
    const prevBad = state?.consecutiveBad ?? 0;

    // Check if degraded
    const bad = sharpe < this.SHARPE_THRESHOLD;
    const nextBad = bad ? prevBad + 1 : 0;

    // Update state
    await FractalAutoLearnStateModel.updateOne(
      { symbol },
      { $set: { consecutiveBad: nextBad, updatedAt: new Date() } },
      { upsert: true }
    );

    console.log(`[Monitor] Sharpe: ${sharpe.toFixed(2)}, Degraded: ${bad}, Consecutive bad: ${nextBad}`);

    // Trigger rollback if N consecutive bad checks
    if (nextBad >= this.CONSECUTIVE_BAD_LIMIT) {
      console.log(`[Monitor] ${this.CONSECUTIVE_BAD_LIMIT} consecutive bad checks. Triggering rollback.`);

      const rollbackResult = await this.promo.rollback(symbol);

      // Reset counter after rollback
      await FractalAutoLearnStateModel.updateOne(
        { symbol },
        { $set: { consecutiveBad: 0, updatedAt: new Date() } },
        { upsert: true }
      );

      return {
        ok: true,
        degraded: true,
        sharpe,
        consecutiveBad: nextBad,
        rollback: rollbackResult
      };
    }

    return {
      ok: true,
      degraded: bad,
      sharpe,
      consecutiveBad: nextBad
    };
  }

  /**
   * Get current monitor status
   */
  async getStatus(symbol = 'BTC') {
    const state = await FractalAutoLearnStateModel.findOne({ symbol }).lean();
    const active = await this.promo.getActiveModel(symbol);

    return {
      symbol,
      consecutiveBad: state?.consecutiveBad ?? 0,
      threshold: this.SHARPE_THRESHOLD,
      rollbackLimit: this.CONSECUTIVE_BAD_LIMIT,
      activeVersion: active?.version || 'NONE',
      lastCheck: state?.updatedAt || null
    };
  }
}
