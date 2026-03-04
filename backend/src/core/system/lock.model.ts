/**
 * System Locks Model (Option B - B2)
 * 
 * Distributed locks for single-worker enforcement.
 */
import mongoose, { Schema, Document } from 'mongoose';
import * as os from 'os';

export interface ISystemLock extends Document {
  key: string;          // 'bootstrap_worker'
  lockedBy: string;     // 'pid@host'
  lockedAt: Date;
  ttlSec: number;
}

const SystemLockSchema = new Schema<ISystemLock>(
  {
    key: { type: String, required: true, unique: true },
    lockedBy: { type: String, required: true },
    lockedAt: { type: Date, required: true, default: Date.now },
    ttlSec: { type: Number, required: true, default: 120 },
  },
  { collection: 'system_locks' }
);

SystemLockSchema.index({ key: 1 }, { unique: true });

export const SystemLockModel = mongoose.model<ISystemLock>('SystemLock', SystemLockSchema);

/**
 * Get current identity (pid@hostname)
 */
function getIdentity(): string {
  return `${process.pid}@${os.hostname()}`;
}

/**
 * Try to acquire a lock
 * Returns true if lock acquired, false if held by another
 */
export async function acquireLock(key: string, ttlSec: number = 120): Promise<boolean> {
  const identity = getIdentity();
  const now = new Date();
  
  try {
    // Try to create new lock
    const result = await SystemLockModel.findOneAndUpdate(
      {
        key,
        $or: [
          // Lock doesn't exist
          { lockedAt: { $exists: false } },
          // Lock is stale (expired)
          { lockedAt: { $lt: new Date(now.getTime() - ttlSec * 1000) } },
          // We already hold the lock
          { lockedBy: identity },
        ],
      },
      {
        $set: {
          key,
          lockedBy: identity,
          lockedAt: now,
          ttlSec,
        },
      },
      { upsert: true, new: true }
    );
    
    // Check if we got the lock
    return result?.lockedBy === identity;
  } catch (err: any) {
    // Duplicate key error = lock held by another
    if (err.code === 11000) {
      return false;
    }
    throw err;
  }
}

/**
 * Refresh lock (extend TTL)
 */
export async function refreshLock(key: string): Promise<boolean> {
  const identity = getIdentity();
  
  const result = await SystemLockModel.updateOne(
    { key, lockedBy: identity },
    { $set: { lockedAt: new Date() } }
  );
  
  return result.modifiedCount > 0;
}

/**
 * Release lock
 */
export async function releaseLock(key: string): Promise<void> {
  const identity = getIdentity();
  await SystemLockModel.deleteOne({ key, lockedBy: identity });
}

/**
 * Get lock info
 */
export async function getLockInfo(key: string): Promise<{
  locked: boolean;
  lockedBy?: string;
  lockedAt?: Date;
  stale: boolean;
} | null> {
  const lock = await SystemLockModel.findOne({ key });
  if (!lock) {
    return { locked: false, stale: false };
  }
  
  const stale = Date.now() - lock.lockedAt.getTime() > lock.ttlSec * 1000;
  
  return {
    locked: true,
    lockedBy: lock.lockedBy,
    lockedAt: lock.lockedAt,
    stale,
  };
}
