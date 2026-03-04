/**
 * BLOCK 20-21: Fractal Performance Service
 * Tracks pattern hit/miss for self-learning evaluation
 */

import { FractalWindowModel } from '../data/schemas/fractal-window.schema.js';
import { FractalPerfModel } from '../data/schemas/fractal-performance.schema.js';

export class FractalPerformanceService {
  /**
   * Ingest performance records from labeled windows
   */
  async ingestFromLabeledWindows(limit = 500): Promise<{ inserted: number; skipped: number }> {
    // Get labeled windows that have predictions
    const labeled = await FractalWindowModel.find({
      'label.ready': true,
      'prediction.p50Return': { $exists: true }
    })
      .sort({ windowEndTs: 1 })
      .limit(limit)
      .lean();

    let inserted = 0;
    let skipped = 0;

    for (const w of labeled) {
      const pred = (w as any).prediction;
      const realized = (w as any).label;

      if (!pred || !realized) {
        skipped++;
        continue;
      }

      const p50 = pred.p50Return ?? 0;
      const p10 = pred.p10Return ?? 0;
      const p90 = pred.p90Return ?? 0;

      // Determine implied direction from distribution
      let direction: 'UP' | 'DOWN' | 'MIXED' = 'MIXED';
      if (p10 > 0 && p90 > 0) {
        direction = 'UP';
      } else if (p10 < 0 && p90 < 0) {
        direction = 'DOWN';
      }

      const realizedReturn = realized.forwardReturn ?? 0;

      // Hit logic
      let hit: boolean;
      if (direction === 'MIXED') {
        hit = true; // Neutral cluster - no directional call
      } else if (direction === 'UP') {
        hit = realizedReturn >= 0;
      } else {
        hit = realizedReturn < 0;
      }

      // Absolute error relative to median forecast
      const errorAbs = Math.abs(realizedReturn - p50);

      try {
        await FractalPerfModel.updateOne(
          {
            symbol: (w as any).meta.symbol,
            timeframe: (w as any).meta.timeframe,
            windowLen: (w as any).meta.windowLen,
            horizonDays: (w as any).meta.horizonDays,
            windowEndTs: (w as any).windowEndTs
          },
          {
            $set: {
              symbol: (w as any).meta.symbol,
              timeframe: (w as any).meta.timeframe,
              windowLen: (w as any).meta.windowLen,
              horizonDays: (w as any).meta.horizonDays,
              windowEndTs: (w as any).windowEndTs,
              implied: {
                direction,
                p50Return: p50,
                p10Return: p10,
                p90Return: p90
              },
              realized: {
                forwardReturn: realized.forwardReturn,
                forwardMaxDD: realized.forwardMaxDD
              },
              hit,
              errorAbs,
              createdAt: new Date()
            }
          },
          { upsert: true }
        );
        inserted++;
      } catch {
        // Ignore duplicates
        skipped++;
      }
    }

    return { inserted, skipped };
  }

  /**
   * Get rolling performance metrics
   */
  async getMetrics(limit = 500): Promise<{
    totalSamples: number;
    hitRate: number;
    meanAbsoluteError: number;
    avgRealizedReturn: number;
    byDirection: Record<string, { count: number; hitRate: number }>;
  }> {
    const rows = await FractalPerfModel.find({})
      .sort({ windowEndTs: -1 })
      .limit(limit)
      .lean();

    if (!rows.length) {
      return {
        totalSamples: 0,
        hitRate: 0,
        meanAbsoluteError: 0,
        avgRealizedReturn: 0,
        byDirection: {}
      };
    }

    const total = rows.length;

    const hitRate = rows.reduce((s, r) => s + (r.hit ? 1 : 0), 0) / total;
    const mae = rows.reduce((s, r) => s + Math.abs(r.errorAbs ?? 0), 0) / total;
    const avgReturn = rows.reduce((s, r) => s + ((r.realized as any)?.forwardReturn ?? 0), 0) / total;

    // By direction breakdown
    const byDirection: Record<string, { count: number; hits: number }> = {};
    for (const r of rows) {
      const dir = (r.implied as any)?.direction ?? 'MIXED';
      if (!byDirection[dir]) {
        byDirection[dir] = { count: 0, hits: 0 };
      }
      byDirection[dir].count++;
      if (r.hit) byDirection[dir].hits++;
    }

    const byDirectionResult: Record<string, { count: number; hitRate: number }> = {};
    for (const [dir, data] of Object.entries(byDirection)) {
      byDirectionResult[dir] = {
        count: data.count,
        hitRate: data.count > 0 ? data.hits / data.count : 0
      };
    }

    return {
      totalSamples: total,
      hitRate,
      meanAbsoluteError: mae,
      avgRealizedReturn: avgReturn,
      byDirection: byDirectionResult
    };
  }
}
