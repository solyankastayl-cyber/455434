/**
 * Follows Repository
 * Data access layer for follows collection
 */
import { FollowModel, IFollow, FollowType, FollowSettings } from './follows.model.js';

export interface CreateFollowInput {
  userId: string;
  followType: FollowType;
  targetId: string;
  settings?: Partial<FollowSettings>;
  label?: string;
  notes?: string;
}

export interface UpdateFollowInput {
  settings?: Partial<FollowSettings>;
  label?: string;
  notes?: string;
}

/**
 * Create a new follow
 */
export async function createFollow(input: CreateFollowInput): Promise<IFollow> {
  const follow = new FollowModel({
    userId: input.userId,
    followType: input.followType,
    targetId: input.targetId.toLowerCase(),
    settings: {
      minSeverity: input.settings?.minSeverity ?? 30,
      minConfidence: input.settings?.minConfidence ?? 0.5,
      allowedTypes: input.settings?.allowedTypes ?? [],
      window: input.settings?.window ?? '7d',
      delivery: input.settings?.delivery ?? ['inApp'],
      muted: input.settings?.muted ?? false,
    },
    label: input.label,
    notes: input.notes,
  });
  
  return follow.save();
}

/**
 * Get follow by ID
 */
export async function getFollowById(id: string): Promise<IFollow | null> {
  return FollowModel.findById(id).lean();
}

/**
 * Get follow by user and target
 */
export async function getFollowByTarget(
  userId: string,
  followType: FollowType,
  targetId: string
): Promise<IFollow | null> {
  return FollowModel.findOne({
    userId,
    followType,
    targetId: targetId.toLowerCase(),
  }).lean();
}

/**
 * Get all follows for a user
 */
export async function getFollowsByUser(
  userId: string,
  followType?: FollowType
): Promise<IFollow[]> {
  const query: Record<string, unknown> = { userId };
  if (followType) query.followType = followType;
  
  return FollowModel
    .find(query)
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Get all followers of a target (for dispatch)
 */
export async function getFollowersByTarget(
  followType: FollowType,
  targetId: string,
  excludeMuted: boolean = true
): Promise<IFollow[]> {
  const query: Record<string, unknown> = {
    followType,
    targetId: targetId.toLowerCase(),
  };
  
  if (excludeMuted) {
    query['settings.muted'] = { $ne: true };
  }
  
  return FollowModel.find(query).lean();
}

/**
 * Get followers by strategy type
 */
export async function getFollowersByStrategyType(
  strategyType: string,
  excludeMuted: boolean = true
): Promise<IFollow[]> {
  const query: Record<string, unknown> = {
    followType: 'strategy',
    targetId: strategyType.toLowerCase(),
  };
  
  if (excludeMuted) {
    query['settings.muted'] = { $ne: true };
  }
  
  return FollowModel.find(query).lean();
}

/**
 * Update follow settings
 */
export async function updateFollow(
  id: string,
  update: UpdateFollowInput
): Promise<IFollow | null> {
  const updateDoc: Record<string, unknown> = {};
  
  if (update.settings) {
    for (const [key, value] of Object.entries(update.settings)) {
      updateDoc[`settings.${key}`] = value;
    }
  }
  if (update.label !== undefined) updateDoc.label = update.label;
  if (update.notes !== undefined) updateDoc.notes = update.notes;
  
  return FollowModel.findByIdAndUpdate(
    id,
    { $set: updateDoc },
    { new: true }
  ).lean();
}

/**
 * Delete follow
 */
export async function deleteFollow(id: string): Promise<boolean> {
  const result = await FollowModel.deleteOne({ _id: id });
  return result.deletedCount > 0;
}

/**
 * Delete follow by user and target
 */
export async function deleteFollowByTarget(
  userId: string,
  followType: FollowType,
  targetId: string
): Promise<boolean> {
  const result = await FollowModel.deleteOne({
    userId,
    followType,
    targetId: targetId.toLowerCase(),
  });
  return result.deletedCount > 0;
}

/**
 * Count follows for user
 */
export async function countFollowsByUser(
  userId: string,
  followType?: FollowType
): Promise<number> {
  const query: Record<string, unknown> = { userId };
  if (followType) query.followType = followType;
  
  return FollowModel.countDocuments(query);
}

/**
 * Check if user follows target
 */
export async function isFollowing(
  userId: string,
  followType: FollowType,
  targetId: string
): Promise<boolean> {
  const follow = await FollowModel.findOne({
    userId,
    followType,
    targetId: targetId.toLowerCase(),
  }).lean();
  
  return follow !== null;
}
