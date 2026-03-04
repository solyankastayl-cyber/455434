/**
 * BLOCK 2.6 — Outcome Tracker Service
 * =====================================
 * Evaluates predictions and creates outcomes.
 */

import type { Db, Collection, ObjectId } from 'mongodb';
import type { 
  AltCandidatePrediction, 
  AltCandidateOutcome, 
  Direction, 
  OutcomeLabel,
  Horizon 
} from '../db/types.js';
import { altPredictionsService } from './alt.predictions.service.js';

// Outcome thresholds
const TP_THRESHOLD = 1.0;   // 1% = true positive
const WEAK_THRESHOLD = 0.5; // 0.5% = weak

interface PriceProvider {
  getSpotPrice(symbol: string, venue: string): Promise<number | null>;
}

/**
 * Label outcome based on direction and return
 */
function labelOutcome(direction: Direction, retPct: number): { 
  label: OutcomeLabel; 
  score: number; 
  notes: string[] 
} {
  const notes: string[] = [];

  if (direction === 'WATCH') {
    return { label: 'NEUTRAL', score: 0, notes: ['watch_not_trained'] };
  }

  if (Math.abs(retPct) < WEAK_THRESHOLD) {
    return { label: 'WEAK', score: 0, notes: ['small_move'] };
  }

  if (direction === 'UP') {
    if (retPct >= TP_THRESHOLD) {
      return { label: 'TRUE_POSITIVE', score: 1, notes };
    }
    if (retPct <= -TP_THRESHOLD) {
      return { label: 'FALSE_POSITIVE', score: -1, notes };
    }
    return { label: 'NEUTRAL', score: 0, notes: ['in_between'] };
  }

  // DOWN
  if (retPct <= -TP_THRESHOLD) {
    return { label: 'TRUE_POSITIVE', score: 1, notes };
  }
  if (retPct >= TP_THRESHOLD) {
    return { label: 'FALSE_POSITIVE', score: -1, notes };
  }
  return { label: 'NEUTRAL', score: 0, notes: ['in_between'] };
}

export class AltOutcomeTrackerService {
  private outcomeCol: Collection<AltCandidateOutcome> | null = null;
  private priceProvider: PriceProvider | null = null;

  init(db: Db, priceProvider?: PriceProvider) {
    this.outcomeCol = db.collection<AltCandidateOutcome>('alt_candidate_outcomes');
    this.priceProvider = priceProvider ?? this.defaultPriceProvider();
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.outcomeCol) return;
    try {
      await this.outcomeCol.createIndex({ horizon: 1, dueAt: -1 });
      await this.outcomeCol.createIndex({ symbol: 1, ts0: -1 });
      await this.outcomeCol.createIndex({ label: 1, horizon: 1 });
      await this.outcomeCol.createIndex({ predictionId: 1 }, { unique: true });
    } catch (e) {
      console.warn('[AltOutcomes] Index error:', e);
    }
  }

  /**
   * Default price provider (simplified)
   */
  private defaultPriceProvider(): PriceProvider {
    return {
      getSpotPrice: async (symbol: string, venue: string) => {
        // Would integrate with real price provider
        // For now return null to skip
        return null;
      }
    };
  }

  /**
   * Run batch evaluation of pending predictions
   */
  async runBatch(limit = 200): Promise<{ processed: number; skipped: number }> {
    if (!this.outcomeCol || !this.priceProvider) {
      return { processed: 0, skipped: 0 };
    }

    const pending = await altPredictionsService.getPendingPredictions(limit);

    if (!pending.length) {
      return { processed: 0, skipped: 0 };
    }

    let processed = 0;
    let skipped = 0;

    for (const p of pending) {
      const priceT = await this.priceProvider.getSpotPrice(p.symbol, p.venue);
      
      if (priceT == null || !isFinite(priceT) || p.price0 === 0) {
        await altPredictionsService.markSkipped(p._id!, 'no_price');
        skipped++;
        continue;
      }

      const retPct = ((priceT / p.price0) - 1) * 100;
      const { label, score, notes } = labelOutcome(p.direction, retPct);

      const outcomeDoc: AltCandidateOutcome = {
        predictionId: p._id!,
        snapshotId: p.snapshotId,
        ts0: p.ts,
        dueAt: p.dueAt,
        horizon: p.horizon,
        symbol: p.symbol,
        venue: p.venue,
        price0: p.price0,
        priceT,
        retPct,
        directionPred: p.direction,
        confidence: p.confidence,
        label,
        score,
        notes,
        createdAt: new Date(),
      };

      try {
        await this.outcomeCol.updateOne(
          { predictionId: outcomeDoc.predictionId },
          { $setOnInsert: outcomeDoc },
          { upsert: true }
        );

        await altPredictionsService.markDone(p._id!);
        processed++;
      } catch (e) {
        // Skip on error
        skipped++;
      }
    }

    console.log(`[AltOutcomes] Processed: ${processed}, Skipped: ${skipped}`);
    return { processed, skipped };
  }

  /**
   * Get recent outcomes
   */
  async getRecent(limit = 50): Promise<AltCandidateOutcome[]> {
    if (!this.outcomeCol) return [];
    return this.outcomeCol
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get outcomes by label
   */
  async getByLabel(label: OutcomeLabel, horizon?: Horizon, limit = 50): Promise<AltCandidateOutcome[]> {
    if (!this.outcomeCol) return [];
    
    const query: any = { label };
    if (horizon) query.horizon = horizon;

    return this.outcomeCol
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    total: number;
    byLabel: Record<string, number>;
    byHorizon: Record<string, number>;
    avgScore: number;
  }> {
    if (!this.outcomeCol) {
      return { total: 0, byLabel: {}, byHorizon: {}, avgScore: 0 };
    }

    const all = await this.outcomeCol.find({}).toArray();
    const total = all.length;
    
    const byLabel: Record<string, number> = {};
    const byHorizon: Record<string, number> = {};
    let totalScore = 0;

    for (const o of all) {
      byLabel[o.label] = (byLabel[o.label] ?? 0) + 1;
      byHorizon[o.horizon] = (byHorizon[o.horizon] ?? 0) + 1;
      totalScore += o.score;
    }

    return {
      total,
      byLabel,
      byHorizon,
      avgScore: total > 0 ? totalScore / total : 0,
    };
  }
}

export const altOutcomeTrackerService = new AltOutcomeTrackerService();

console.log('[Alts] Outcome Tracker Service loaded');
