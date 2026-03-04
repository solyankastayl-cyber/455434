/**
 * BLOCK 2.6 — Learning Samples Service
 * ======================================
 * Creates learning samples from outcomes.
 */

import type { Db, Collection } from 'mongodb';
import type { AltLearningSample, AltCandidateOutcome, AltCandidatePrediction } from '../db/types.js';

/**
 * Build feature vector X from prediction drivers
 */
function buildX(pred: AltCandidatePrediction): Record<string, number> {
  const d = pred.drivers ?? { cluster: '', clusterScore: 0, exchange: {}, funding: {} };
  const ex = d.exchange ?? {};
  const f = d.funding ?? {};

  // Extend with your 40 indicators here
  return {
    clusterScore: Number(d.clusterScore ?? 0),
    fundingZ: Number((f as any).z ?? 0),
    fundingCrowdedness: Number((f as any).crowdedness ?? 0),
    fundingDispersion: Number((f as any).dispersion ?? 0),
    oiDelta: Number((ex as any).oiDelta ?? 0),
    liqPressure: Number((ex as any).liqPressure ?? 0),
    orderbookImb: Number((ex as any).orderbookImb ?? 0),
    rsi: Number((ex as any).rsi ?? 0),
    confidence: Number(pred.confidence ?? 0),
    expectedMovePct: Number(pred.expectedMovePct ?? 0),
  };
}

/**
 * Build target Y from outcome
 */
function buildY(outcome: AltCandidateOutcome): number {
  if (outcome.label === 'TRUE_POSITIVE') return 1;
  if (outcome.label === 'FALSE_POSITIVE') return -1;
  return 0;
}

export class AltLearningSamplesService {
  private sampleCol: Collection<AltLearningSample> | null = null;
  private outcomeCol: Collection<AltCandidateOutcome> | null = null;
  private predCol: Collection<AltCandidatePrediction> | null = null;

  init(db: Db) {
    this.sampleCol = db.collection<AltLearningSample>('alt_learning_samples');
    this.outcomeCol = db.collection<AltCandidateOutcome>('alt_candidate_outcomes');
    this.predCol = db.collection<AltCandidatePrediction>('alt_candidate_predictions');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.sampleCol) return;
    try {
      await this.sampleCol.createIndex({ horizon: 1, ts0: -1 });
      await this.sampleCol.createIndex({ symbol: 1, ts0: -1 });
      await this.sampleCol.createIndex({ label: 1, horizon: 1 });
      await this.sampleCol.createIndex({ 'meta.predictionId': 1 }, { unique: true });
    } catch (e) {
      console.warn('[AltSamples] Index error:', e);
    }
  }

  /**
   * Materialize learning samples from outcomes
   */
  async materialize(limit = 500): Promise<{ inserted: number }> {
    if (!this.sampleCol || !this.outcomeCol || !this.predCol) {
      return { inserted: 0 };
    }

    // Find outcomes without samples
    const outcomes = await this.outcomeCol.aggregate([
      { $sort: { dueAt: 1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'alt_learning_samples',
          localField: 'predictionId',
          foreignField: 'meta.predictionId',
          as: 'sample'
        }
      },
      { $match: { sample: { $size: 0 } } },
      {
        $lookup: {
          from: 'alt_candidate_predictions',
          localField: 'predictionId',
          foreignField: '_id',
          as: 'pred'
        }
      },
      { $unwind: { path: '$pred', preserveNullAndEmptyArrays: true } },
    ]).toArray();

    if (!outcomes.length) {
      return { inserted: 0 };
    }

    const now = new Date();
    const docs: AltLearningSample[] = [];

    for (const o of outcomes) {
      if (!o.pred) continue;

      docs.push({
        ts0: o.ts0,
        horizon: o.horizon,
        symbol: o.symbol,
        x: buildX(o.pred as AltCandidatePrediction),
        y: buildY(o as AltCandidateOutcome),
        label: o.label,
        meta: {
          confidence: o.confidence,
          cluster: o.pred?.drivers?.cluster,
          fundingZ: o.pred?.drivers?.funding?.z,
          venue: o.venue,
          snapshotId: o.snapshotId,
          predictionId: o.predictionId,
        },
        createdAt: now,
      });
    }

    if (docs.length) {
      try {
        await this.sampleCol.insertMany(docs, { ordered: false });
      } catch (e: any) {
        // Ignore duplicate key errors
        if (e.code !== 11000) throw e;
      }
    }

    console.log(`[AltSamples] Materialized: ${docs.length} samples`);
    return { inserted: docs.length };
  }

  /**
   * Get samples for training
   */
  async getSamplesForTraining(params: {
    horizon: string;
    limit?: number;
    fromTs?: Date;
  }): Promise<AltLearningSample[]> {
    if (!this.sampleCol) return [];

    const { horizon, limit = 5000, fromTs } = params;
    const query: any = { horizon };
    if (fromTs) query.ts0 = { $gte: fromTs };

    return this.sampleCol
      .find(query)
      .sort({ ts0: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    total: number;
    byHorizon: Record<string, number>;
    byLabel: Record<string, number>;
    avgY: number;
  }> {
    if (!this.sampleCol) {
      return { total: 0, byHorizon: {}, byLabel: {}, avgY: 0 };
    }

    const all = await this.sampleCol.find({}).toArray();
    const total = all.length;
    
    const byHorizon: Record<string, number> = {};
    const byLabel: Record<string, number> = {};
    let totalY = 0;

    for (const s of all) {
      byHorizon[s.horizon] = (byHorizon[s.horizon] ?? 0) + 1;
      byLabel[s.label] = (byLabel[s.label] ?? 0) + 1;
      totalY += s.y;
    }

    return {
      total,
      byHorizon,
      byLabel,
      avgY: total > 0 ? totalY / total : 0,
    };
  }
}

export const altLearningSamplesService = new AltLearningSamplesService();

console.log('[Alts] Learning Samples Service loaded');
