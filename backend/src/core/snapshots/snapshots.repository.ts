/**
 * Snapshots Repository
 */
import {
  ProfileSnapshotModel,
  IProfileSnapshot,
  SnapshotType,
  SNAPSHOT_TTL,
} from './snapshots.model.js';

/**
 * Get snapshot
 */
export async function getSnapshot(
  subjectId: string,
  snapshotType: SnapshotType
): Promise<IProfileSnapshot | null> {
  return ProfileSnapshotModel.findOne({
    subjectId: subjectId.toLowerCase(),
    snapshotType,
    expiresAt: { $gt: new Date() },
  }).lean();
}

/**
 * Get multiple snapshots by IDs
 */
export async function getSnapshots(
  subjectIds: string[],
  snapshotType: SnapshotType
): Promise<IProfileSnapshot[]> {
  const lowerIds = subjectIds.map(id => id.toLowerCase());
  
  return ProfileSnapshotModel.find({
    subjectId: { $in: lowerIds },
    snapshotType,
    expiresAt: { $gt: new Date() },
  }).lean();
}

/**
 * Upsert snapshot
 */
export async function upsertSnapshot(
  subjectId: string,
  subjectType: 'actor' | 'entity' | 'alert',
  snapshotType: SnapshotType,
  payload: Record<string, unknown>,
  ttlSeconds?: number
): Promise<IProfileSnapshot> {
  const ttl = ttlSeconds || SNAPSHOT_TTL[snapshotType] || 300;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  
  return ProfileSnapshotModel.findOneAndUpdate(
    {
      subjectId: subjectId.toLowerCase(),
      snapshotType,
    },
    {
      $set: {
        subjectType,
        payload,
        expiresAt,
      },
      $inc: { version: 1 },
    },
    { new: true, upsert: true }
  ).lean() as Promise<IProfileSnapshot>;
}

/**
 * Delete snapshot
 */
export async function deleteSnapshot(
  subjectId: string,
  snapshotType: SnapshotType
): Promise<boolean> {
  const result = await ProfileSnapshotModel.deleteOne({
    subjectId: subjectId.toLowerCase(),
    snapshotType,
  });
  return result.deletedCount > 0;
}

/**
 * Invalidate all snapshots for a subject
 */
export async function invalidateSnapshots(subjectId: string): Promise<number> {
  const result = await ProfileSnapshotModel.deleteMany({
    subjectId: subjectId.toLowerCase(),
  });
  return result.deletedCount;
}

/**
 * Get snapshot stats
 */
export async function getSnapshotStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  expired: number;
}> {
  const now = new Date();
  
  const [total, byTypeAgg, expired] = await Promise.all([
    ProfileSnapshotModel.countDocuments(),
    ProfileSnapshotModel.aggregate([
      { $group: { _id: '$snapshotType', count: { $sum: 1 } } },
    ]),
    ProfileSnapshotModel.countDocuments({ expiresAt: { $lt: now } }),
  ]);
  
  const byType: Record<string, number> = {};
  for (const item of byTypeAgg) {
    byType[item._id] = item.count;
  }
  
  return { total, byType, expired };
}
