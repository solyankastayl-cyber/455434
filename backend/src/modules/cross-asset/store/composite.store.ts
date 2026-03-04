/**
 * P4: Cross-Asset Composite Store
 * 
 * MongoDB operations for composite snapshots and lifecycle.
 * Collections:
 * - composite_snapshots
 * - model_lifecycle_state (asset='CROSS_ASSET')
 * - model_lifecycle_events (asset='CROSS_ASSET')
 */

import { getMongoDb } from '../../../db/mongoose.js';
import type {
  CompositeSnapshotDoc,
  CompositeLifecycleState,
  CompositeLifecycleEvent,
  ParentVersions,
  BlendConfig,
} from '../contracts/composite.contract.js';

// Helper to get DB
async function getDb() {
  return getMongoDb();
}

const COLLECTION_SNAPSHOTS = 'composite_snapshots';
const COLLECTION_STATE = 'model_lifecycle_state';
const COLLECTION_EVENTS = 'model_lifecycle_events';

export const CompositeStore = {
  /**
   * Save composite snapshot (immutable)
   */
  async saveSnapshot(doc: CompositeSnapshotDoc): Promise<{ ok: boolean; insertedId?: string }> {
    const db = await getDb();
    try {
      const result = await db.collection(COLLECTION_SNAPSHOTS).insertOne(doc);
      return { ok: true, insertedId: result.insertedId.toString() };
    } catch (err: any) {
      console.error('[CompositeStore] saveSnapshot error:', err.message);
      return { ok: false };
    }
  },

  /**
   * Get composite snapshot by version
   */
  async getSnapshot(versionId: string, horizonDays: number): Promise<CompositeSnapshotDoc | null> {
    const db = await getDb();
    return db.collection(COLLECTION_SNAPSHOTS).findOne(
      { asset: 'CROSS_ASSET', versionId, horizonDays },
      { projection: { _id: 0 } }
    ) as Promise<CompositeSnapshotDoc | null>;
  },

  /**
   * Get latest composite snapshot for horizon
   */
  async getLatestSnapshot(horizonDays: number): Promise<CompositeSnapshotDoc | null> {
    const db = await getDb();
    return db.collection(COLLECTION_SNAPSHOTS).findOne(
      { asset: 'CROSS_ASSET', horizonDays },
      { sort: { createdAt: -1 }, projection: { _id: 0 } }
    ) as Promise<CompositeSnapshotDoc | null>;
  },

  /**
   * Get composite snapshots by parent versions
   */
  async getSnapshotsByParents(parentVersions: ParentVersions, horizonDays: number): Promise<CompositeSnapshotDoc[]> {
    const db = await getDb();
    return db.collection(COLLECTION_SNAPSHOTS).find(
      {
        asset: 'CROSS_ASSET',
        horizonDays,
        'parentVersions.BTC': parentVersions.BTC,
        'parentVersions.SPX': parentVersions.SPX,
        'parentVersions.DXY': parentVersions.DXY,
      },
      { projection: { _id: 0 } }
    ).toArray() as Promise<CompositeSnapshotDoc[]>;
  },

  /**
   * Get unresolved composite snapshots
   */
  async getUnresolvedSnapshots(): Promise<CompositeSnapshotDoc[]> {
    const db = await getDb();
    return db.collection(COLLECTION_SNAPSHOTS).find(
      { asset: 'CROSS_ASSET', resolved: false },
      { projection: { _id: 0 } }
    ).toArray() as Promise<CompositeSnapshotDoc[]>;
  },

  /**
   * Mark snapshot as resolved
   */
  async resolveSnapshot(
    versionId: string,
    horizonDays: number,
    realizedReturn: number,
    error: number
  ): Promise<{ ok: boolean }> {
    const db = await getDb();
    const result = await db.collection(COLLECTION_SNAPSHOTS).updateOne(
      { asset: 'CROSS_ASSET', versionId, horizonDays },
      {
        $set: {
          resolved: true,
          resolvedAt: new Date(),
          realizedReturn,
          error,
        },
      }
    );
    return { ok: result.modifiedCount > 0 };
  },

  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE STATE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get lifecycle state for CROSS_ASSET
   */
  async getState(): Promise<CompositeLifecycleState | null> {
    const db = await getDb();
    return db.collection(COLLECTION_STATE).findOne(
      { asset: 'CROSS_ASSET' },
      { projection: { _id: 0 } }
    ) as Promise<CompositeLifecycleState | null>;
  },

  /**
   * Update lifecycle state
   */
  async updateState(state: Partial<CompositeLifecycleState>): Promise<{ ok: boolean }> {
    const db = await getDb();
    const result = await db.collection(COLLECTION_STATE).updateOne(
      { asset: 'CROSS_ASSET' },
      {
        $set: {
          ...state,
          asset: 'CROSS_ASSET',
        },
      },
      { upsert: true }
    );
    return { ok: result.acknowledged };
  },

  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE EVENTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add lifecycle event
   */
  async addEvent(event: CompositeLifecycleEvent): Promise<{ ok: boolean }> {
    const db = await getDb();
    const result = await db.collection(COLLECTION_EVENTS).insertOne(event);
    return { ok: result.acknowledged };
  },

  /**
   * Get recent events
   */
  async getRecentEvents(limit: number = 10): Promise<CompositeLifecycleEvent[]> {
    const db = await getDb();
    return db.collection(COLLECTION_EVENTS).find(
      { asset: 'CROSS_ASSET' },
      { sort: { createdAt: -1 }, limit, projection: { _id: 0 } }
    ).toArray() as Promise<CompositeLifecycleEvent[]>;
  },

  // ═══════════════════════════════════════════════════════════════
  // AGGREGATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get outcome stats for composite
   */
  async getOutcomeStats(versionId?: string): Promise<{
    total: number;
    hits: number;
    hitRate: number;
    avgError: number;
  }> {
    const db = await getDb();
    const match: any = { asset: 'CROSS_ASSET', resolved: true };
    if (versionId) match.versionId = versionId;

    const snapshots = await db.collection(COLLECTION_SNAPSHOTS).find(
      match,
      { projection: { expectedReturn: 1, realizedReturn: 1, error: 1 } }
    ).toArray();

    if (snapshots.length === 0) {
      return { total: 0, hits: 0, hitRate: 0, avgError: 0 };
    }

    let hits = 0;
    let totalError = 0;

    for (const s of snapshots) {
      const expected = (s as any).expectedReturn || 0;
      const realized = (s as any).realizedReturn || 0;
      const error = (s as any).error || 0;

      // Hit = direction match
      if (Math.sign(expected) === Math.sign(realized)) hits++;
      totalError += Math.abs(error);
    }

    return {
      total: snapshots.length,
      hits,
      hitRate: hits / snapshots.length,
      avgError: totalError / snapshots.length,
    };
  },
};

export default CompositeStore;
