/**
 * BLOCK 2.6 — Predictions From Snapshot Service
 * ===============================================
 * Materializes snapshot into individual predictions for tracking.
 */

import type { Db, Collection, ObjectId } from 'mongodb';
import type { AltCandidatePrediction, AltCandidateSnapshot, Horizon, AltCandidate } from '../db/types.js';

function horizonToMs(h: Horizon): number {
  if (h === '1h') return 60 * 60 * 1000;
  if (h === '4h') return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export class AltPredictionsFromSnapshotService {
  private predCol: Collection<AltCandidatePrediction> | null = null;
  private snapshotCol: Collection<AltCandidateSnapshot> | null = null;

  init(db: Db) {
    this.predCol = db.collection<AltCandidatePrediction>('alt_candidate_predictions');
    this.snapshotCol = db.collection<AltCandidateSnapshot>('alt_candidate_snapshots');
    void this.ensureIndexes();
  }

  private async ensureIndexes() {
    if (!this.predCol) return;
    try {
      await this.predCol.createIndex({ horizon: 1, dueAt: 1, outcomeStatus: 1 });
      await this.predCol.createIndex({ symbol: 1, ts: -1 });
      await this.predCol.createIndex({ snapshotId: 1, symbol: 1, horizon: 1 }, { unique: true });
    } catch (e) {
      console.warn('[AltPredictions] Index error:', e);
    }
  }

  /**
   * Materialize a snapshot into predictions
   */
  async materializeSnapshot(snapshotId: string | ObjectId): Promise<{ inserted: number; matched: number }> {
    if (!this.snapshotCol || !this.predCol) {
      return { inserted: 0, matched: 0 };
    }

    const snap = await this.snapshotCol.findOne({ 
      _id: typeof snapshotId === 'string' ? new (await import('mongodb')).ObjectId(snapshotId) : snapshotId 
    });
    
    if (!snap) {
      throw new Error('snapshot_not_found');
    }

    const now = new Date();
    const horizon = snap.horizon ?? '4h';
    const dueAt = new Date(snap.ts.getTime() + horizonToMs(horizon));

    // Flatten buckets
    const candidates: AltCandidate[] = [
      ...(snap.buckets?.UP ?? []),
      ...(snap.buckets?.DOWN ?? []),
      ...(snap.buckets?.WATCH ?? []),
    ];

    if (!candidates.length) {
      return { inserted: 0, matched: 0 };
    }

    let inserted = 0;
    let matched = 0;

    for (const c of candidates) {
      const doc: AltCandidatePrediction = {
        snapshotId: snap._id!,
        ts: snap.ts,
        horizon,
        venue: snap.venue ?? 'resolved',
        symbol: c.symbol,
        price0: c.price,
        direction: c.direction,
        confidence: c.confidence,
        expectedMovePct: c.expectedMovePct ?? 0,
        drivers: c.drivers,
        tags: c.tags ?? [],
        outcomeStatus: 'PENDING',
        dueAt,
        createdAt: now,
      };

      try {
        const result = await this.predCol.updateOne(
          { snapshotId: doc.snapshotId, symbol: doc.symbol, horizon: doc.horizon },
          { $setOnInsert: doc },
          { upsert: true }
        );

        if (result.upsertedCount > 0) inserted++;
        else if (result.matchedCount > 0) matched++;
      } catch (e) {
        // Duplicate - skip
      }
    }

    console.log(`[AltPredictions] Materialized snapshot: ${inserted} inserted, ${matched} matched`);
    return { inserted, matched };
  }

  /**
   * Get pending predictions ready for outcome evaluation
   */
  async getPendingPredictions(limit = 200): Promise<AltCandidatePrediction[]> {
    if (!this.predCol) return [];

    const now = new Date();
    return this.predCol
      .find({ outcomeStatus: 'PENDING', dueAt: { $lte: now } })
      .sort({ dueAt: 1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Mark prediction as done
   */
  async markDone(predictionId: ObjectId): Promise<void> {
    if (!this.predCol) return;
    await this.predCol.updateOne(
      { _id: predictionId },
      { $set: { outcomeStatus: 'DONE' } }
    );
  }

  /**
   * Mark prediction as skipped
   */
  async markSkipped(predictionId: ObjectId, reason: string): Promise<void> {
    if (!this.predCol) return;
    await this.predCol.updateOne(
      { _id: predictionId },
      { $set: { outcomeStatus: 'SKIPPED', skipReason: reason } }
    );
  }
}

export const altPredictionsService = new AltPredictionsFromSnapshotService();

console.log('[Alts] Predictions Service loaded');
