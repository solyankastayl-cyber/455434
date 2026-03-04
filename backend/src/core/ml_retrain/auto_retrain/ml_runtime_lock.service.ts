/**
 * ML v2.2: Runtime Lock Service
 * 
 * Prevents concurrent auto-retrain evaluations for same task+network.
 * Uses TTL-based lock in MongoDB.
 */

import mongoose from 'mongoose';

const LOCK_COLLECTION = 'ml_runtime_locks';

interface LockDocument {
  _id: string;
  lockedUntilTs: number;
  owner: string;
  meta: {
    runId: string;
  };
}

/**
 * Acquire a lock with TTL
 * Returns lock document if acquired, null if lock exists and not expired
 */
export async function acquireLock(
  lockId: string, 
  ttlSeconds: number
): Promise<LockDocument | null> {
  const now = Math.floor(Date.now() / 1000);
  const lockedUntilTs = now + ttlSeconds;
  const runId = `${now}_${Math.random().toString(36).slice(2, 8)}`;

  const db = mongoose.connection.db;
  
  try {
    const result = await db.collection(LOCK_COLLECTION).findOneAndUpdate(
      {
        _id: lockId,
        $or: [
          { lockedUntilTs: { $lte: now } },
          { lockedUntilTs: { $exists: false } }
        ]
      },
      {
        $set: {
          lockedUntilTs,
          owner: 'auto_retrain_scheduler',
          meta: { runId }
        }
      },
      {
        upsert: true,
        returnDocument: 'after'
      }
    );

    return result as unknown as LockDocument;
  } catch (err: any) {
    // Duplicate key error means lock exists and not expired
    if (err.code === 11000) {
      return null;
    }
    throw err;
  }
}

/**
 * Release a lock
 */
export async function releaseLock(lockId: string): Promise<void> {
  const db = mongoose.connection.db;
  await db.collection(LOCK_COLLECTION).deleteOne({ _id: lockId });
}

/**
 * Check if lock exists and is active
 */
export async function isLocked(lockId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const db = mongoose.connection.db;
  
  const lock = await db.collection(LOCK_COLLECTION).findOne({
    _id: lockId,
    lockedUntilTs: { $gt: now }
  });
  
  return !!lock;
}
