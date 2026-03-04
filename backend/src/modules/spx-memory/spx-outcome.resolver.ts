/**
 * SPX MEMORY LAYER — Outcome Resolver
 * 
 * BLOCK B6.1 — Resolve matured outcomes
 * 
 * When snapshot horizon matures, compute actual return and hit/miss.
 */

import type { FastifyInstance } from 'fastify';
import { SpxSnapshotModel } from './spx-snapshot.model.js';
import { SpxOutcomeModel } from './spx-outcome.model.js';
import { HORIZON_DAYS } from './spx-memory.types.js';
import type { SpxSnapshotDoc, SpxHorizon } from './spx-memory.types.js';

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME RESOLVER CLASS
// ═══════════════════════════════════════════════════════════════

export class SpxOutcomeResolver {
  constructor(private app: FastifyInstance) {}

  /**
   * Get SPX close price for a given date
   */
  private async getClose(date: string): Promise<number | null> {
    try {
      const res = await this.app.inject({
        method: 'GET',
        url: `/api/market-data/candles?symbol=SPX&startDate=${date}&endDate=${date}&limit=1`,
      });
      
      if (res.statusCode !== 200) return null;
      
      const json = res.json() as any;
      const candles = json?.candles || [];
      
      if (candles.length === 0) return null;
      return candles[0].c;
      
    } catch {
      return null;
    }
  }

  /**
   * Resolve all matured snapshots up to given date
   */
  async resolveMatured(asOfDateMax: string, limit = 500) {
    // Get unresolved snapshots
    const snaps = await SpxSnapshotModel.find({ symbol: 'SPX' })
      .sort({ asOfDate: 1 })
      .limit(limit)
      .lean() as (SpxSnapshotDoc & { _id: any })[];

    let resolved = 0;
    const errors: { snapshotId: string; reason: string }[] = [];
    const skipped: string[] = [];

    for (const s of snaps) {
      const snapshotId = String(s._id);
      const days = HORIZON_DAYS[s.horizon as SpxHorizon] || 30;
      const matureDate = addDays(s.asOfDate, days);
      
      // Skip if not yet matured
      if (matureDate > asOfDateMax) {
        skipped.push(snapshotId);
        continue;
      }

      // Skip if outcome already exists (idempotent)
      const exists = await SpxOutcomeModel.findOne({ snapshotId }).lean();
      if (exists) continue;

      // Get entry and exit prices
      const entry = await this.getClose(s.asOfDate);
      const exit = await this.getClose(matureDate);

      if (entry == null || exit == null) {
        errors.push({ 
          snapshotId, 
          reason: `MISSING_CLOSE: entry=${entry}, exit=${exit}` 
        });
        continue;
      }

      // Calculate return
      const retPct = ((exit / entry) - 1) * 100;

      // Determine hit/miss
      const expected = s.direction;
      let hit = false;
      
      if (expected === 'NEUTRAL') {
        // Neutral = "not moving" → hit if small return
        hit = Math.abs(retPct) < 0.75;
      } else if (expected === 'BULL') {
        hit = retPct > 0;
      } else if (expected === 'BEAR') {
        hit = retPct < 0;
      }

      // Create outcome
      await SpxOutcomeModel.create({
        snapshotId,
        symbol: 'SPX',
        source: s.source,
        preset: s.preset,
        asOfDate: s.asOfDate,
        horizon: s.horizon,
        resolvedDate: matureDate,
        entryClose: entry,
        exitClose: exit,
        actualReturnPct: Math.round(retPct * 10000) / 10000,
        expectedDirection: expected,
        hit,
      });

      resolved++;
    }

    return { 
      ok: true, 
      resolved, 
      skippedCount: skipped.length,
      errorsCount: errors.length, 
      errors: errors.slice(0, 20), // Limit error output
    };
  }

  /**
   * Get attribution stats (hit rate, return by source/horizon)
   */
  async getAttributionStats(filters?: { source?: string; horizon?: string }) {
    const match: any = { symbol: 'SPX' };
    if (filters?.source) match.source = filters.source;
    if (filters?.horizon) match.horizon = filters.horizon;

    const stats = await SpxOutcomeModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { source: '$source', horizon: '$horizon' },
          totalOutcomes: { $sum: 1 },
          hits: { $sum: { $cond: ['$hit', 1, 0] } },
          avgReturn: { $avg: '$actualReturnPct' },
          sumReturn: { $sum: '$actualReturnPct' },
          minReturn: { $min: '$actualReturnPct' },
          maxReturn: { $max: '$actualReturnPct' },
        },
      },
      {
        $addFields: {
          hitRate: { $divide: ['$hits', '$totalOutcomes'] },
        },
      },
      { $sort: { '_id.source': 1, '_id.horizon': 1 } },
    ]);

    return stats;
  }
}

export default SpxOutcomeResolver;
