/**
 * P1-A + P2: Lifecycle Store
 * 
 * MongoDB persistence for model lifecycle state and events.
 */

import { getDb } from '../../../db/mongodb.js';
import { 
  LifecycleStateDoc, 
  LifecycleEventDoc, 
  PredictionSnapshotDoc,
  DecisionOutcomeDoc,
  AssetKey 
} from './lifecycle.contract.js';

const STATE_COL = 'model_lifecycle_state';
const EVENTS_COL = 'model_lifecycle_events';
const SNAPSHOTS_COL = 'prediction_snapshots';
const OUTCOMES_COL = 'decision_outcomes';

export class LifecycleStore {
  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════
  
  static async getState(asset: AssetKey): Promise<LifecycleStateDoc | null> {
    try {
      const db = getDb();
      return await db.collection<LifecycleStateDoc>(STATE_COL).findOne(
        { asset },
        { projection: { _id: 0 } }
      );
    } catch (err) {
      console.error(`[LifecycleStore] Error getting state for ${asset}:`, err);
      return null;
    }
  }

  static async setState(doc: LifecycleStateDoc): Promise<boolean> {
    try {
      const db = getDb();
      await db.collection<LifecycleStateDoc>(STATE_COL).updateOne(
        { asset: doc.asset },
        { $set: doc },
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.error(`[LifecycleStore] Error setting state:`, err);
      return false;
    }
  }

  static async getAllStates(): Promise<LifecycleStateDoc[]> {
    try {
      const db = getDb();
      return await db.collection<LifecycleStateDoc>(STATE_COL)
        .find({}, { projection: { _id: 0 } })
        .toArray();
    } catch (err) {
      console.error('[LifecycleStore] Error getting all states:', err);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════

  static async insertEvent(doc: LifecycleEventDoc): Promise<boolean> {
    try {
      const db = getDb();
      await db.collection<LifecycleEventDoc>(EVENTS_COL).insertOne(doc as any);
      return true;
    } catch (err) {
      console.error('[LifecycleStore] Error inserting event:', err);
      return false;
    }
  }

  static async getEvents(asset: AssetKey, limit = 50): Promise<LifecycleEventDoc[]> {
    try {
      const db = getDb();
      return await db.collection<LifecycleEventDoc>(EVENTS_COL)
        .find({ asset }, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    } catch (err) {
      console.error('[LifecycleStore] Error getting events:', err);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SNAPSHOTS (P2)
  // ═══════════════════════════════════════════════════════════════

  static async insertSnapshot(doc: PredictionSnapshotDoc): Promise<boolean> {
    try {
      const db = getDb();
      await db.collection<PredictionSnapshotDoc>(SNAPSHOTS_COL).insertOne(doc as any);
      return true;
    } catch (err) {
      console.error('[LifecycleStore] Error inserting snapshot:', err);
      return false;
    }
  }

  static async getUnresolvedSnapshots(asset?: AssetKey): Promise<PredictionSnapshotDoc[]> {
    try {
      const db = getDb();
      const filter: any = { resolved: false };
      if (asset) filter.asset = asset;
      
      return await db.collection<PredictionSnapshotDoc>(SNAPSHOTS_COL)
        .find(filter, { projection: { _id: 0 } })
        .toArray();
    } catch (err) {
      console.error('[LifecycleStore] Error getting unresolved snapshots:', err);
      return [];
    }
  }

  static async resolveSnapshot(
    asset: AssetKey, 
    version: string, 
    horizon: string,
    resolution: {
      realizedReturn: number;
      expectedReturn: number;
      error: number;
    }
  ): Promise<boolean> {
    try {
      const db = getDb();
      await db.collection<PredictionSnapshotDoc>(SNAPSHOTS_COL).updateOne(
        { asset, version, horizon },
        { 
          $set: { 
            resolved: true, 
            resolvedAt: new Date(),
            ...resolution
          } 
        }
      );
      return true;
    } catch (err) {
      console.error('[LifecycleStore] Error resolving snapshot:', err);
      return false;
    }
  }

  static async getSnapshotsByVersion(asset: AssetKey, version: string): Promise<PredictionSnapshotDoc[]> {
    try {
      const db = getDb();
      return await db.collection<PredictionSnapshotDoc>(SNAPSHOTS_COL)
        .find({ asset, version }, { projection: { _id: 0 } })
        .toArray();
    } catch (err) {
      console.error('[LifecycleStore] Error getting snapshots by version:', err);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OUTCOMES (P2)
  // ═══════════════════════════════════════════════════════════════

  static async insertOutcome(doc: DecisionOutcomeDoc): Promise<boolean> {
    try {
      const db = getDb();
      await db.collection<DecisionOutcomeDoc>(OUTCOMES_COL).insertOne(doc as any);
      return true;
    } catch (err) {
      console.error('[LifecycleStore] Error inserting outcome:', err);
      return false;
    }
  }

  static async getOutcomes(asset: AssetKey, limit = 100): Promise<DecisionOutcomeDoc[]> {
    try {
      const db = getDb();
      return await db.collection<DecisionOutcomeDoc>(OUTCOMES_COL)
        .find({ asset }, { projection: { _id: 0 } })
        .sort({ resolvedAt: -1 })
        .limit(limit)
        .toArray();
    } catch (err) {
      console.error('[LifecycleStore] Error getting outcomes:', err);
      return [];
    }
  }

  static async getOutcomeStats(asset: AssetKey): Promise<{
    total: number;
    hits: number;
    hitRate: number;
    avgError: number;
  }> {
    try {
      const db = getDb();
      const outcomes = await db.collection<DecisionOutcomeDoc>(OUTCOMES_COL)
        .find({ asset })
        .toArray();
      
      if (outcomes.length === 0) {
        return { total: 0, hits: 0, hitRate: 0, avgError: 0 };
      }
      
      const hits = outcomes.filter(o => o.hit).length;
      const avgError = outcomes.reduce((sum, o) => sum + Math.abs(o.error), 0) / outcomes.length;
      
      return {
        total: outcomes.length,
        hits,
        hitRate: hits / outcomes.length,
        avgError,
      };
    } catch (err) {
      console.error('[LifecycleStore] Error getting outcome stats:', err);
      return { total: 0, hits: 0, hitRate: 0, avgError: 0 };
    }
  }
}
