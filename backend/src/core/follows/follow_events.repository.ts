/**
 * Follow Events Repository
 * Data access layer for follow_events collection
 */
import { FollowEventModel, IFollowEvent, FollowEventSourceType } from './follow_events.model.js';

export interface CreateFollowEventInput {
  userId: string;
  source: {
    sourceType: FollowEventSourceType;
    sourceId: string;
  };
  targetType: string;
  targetId: string;
  severity: number;
  confidence: number;
  title: string;
  message: string;
}

/**
 * Create a follow event
 */
export async function createFollowEvent(input: CreateFollowEventInput): Promise<IFollowEvent> {
  const event = new FollowEventModel(input);
  return event.save();
}

/**
 * Create multiple follow events (batch)
 */
export async function createManyFollowEvents(
  inputs: CreateFollowEventInput[]
): Promise<IFollowEvent[]> {
  if (inputs.length === 0) return [];
  
  // Use insertMany with ordered=false to continue on duplicates
  try {
    return await FollowEventModel.insertMany(inputs, { ordered: false });
  } catch (err: unknown) {
    // If some inserts failed due to duplicates, return successful ones
    if (err && typeof err === 'object' && 'insertedDocs' in err) {
      return (err as { insertedDocs: IFollowEvent[] }).insertedDocs;
    }
    throw err;
  }
}

/**
 * Get follow events for user
 */
export async function getFollowEventsByUser(
  userId: string,
  options: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<IFollowEvent[]> {
  const query: Record<string, unknown> = { userId };
  
  if (options.unreadOnly) {
    query.readAt = null;
  }
  
  return FollowEventModel
    .find(query)
    .sort({ createdAt: -1 })
    .skip(options.offset || 0)
    .limit(options.limit || 50)
    .lean();
}

/**
 * Get unread count for user
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return FollowEventModel.countDocuments({ userId, readAt: null });
}

/**
 * Mark event as read
 */
export async function markAsRead(eventId: string): Promise<IFollowEvent | null> {
  return FollowEventModel.findByIdAndUpdate(
    eventId,
    { $set: { readAt: new Date() } },
    { new: true }
  ).lean();
}

/**
 * Mark all events as read for user
 */
export async function markAllAsRead(userId: string): Promise<number> {
  const result = await FollowEventModel.updateMany(
    { userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return result.modifiedCount;
}

/**
 * Check if event exists (for dedup)
 */
export async function eventExists(
  userId: string,
  sourceType: FollowEventSourceType,
  sourceId: string
): Promise<boolean> {
  const event = await FollowEventModel.findOne({
    userId,
    'source.sourceType': sourceType,
    'source.sourceId': sourceId,
  }).lean();
  
  return event !== null;
}

/**
 * Delete old events (cleanup)
 */
export async function deleteOldEvents(olderThanDays: number = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  
  const result = await FollowEventModel.deleteMany({
    createdAt: { $lt: cutoff },
    readAt: { $ne: null }, // Only delete read events
  });
  
  return result.deletedCount;
}

/**
 * Get event stats for user
 */
export async function getEventStats(userId: string): Promise<{
  total: number;
  unread: number;
  last24h: number;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const [total, unread, last24h] = await Promise.all([
    FollowEventModel.countDocuments({ userId }),
    FollowEventModel.countDocuments({ userId, readAt: null }),
    FollowEventModel.countDocuments({ userId, createdAt: { $gte: yesterday } }),
  ]);
  
  return { total, unread, last24h };
}
