/**
 * Follows Service
 * Business logic for follows and follow events
 */
import { IFollow, FollowType, FollowSettings } from './follows.model.js';
import { IFollowEvent } from './follow_events.model.js';
import * as followsRepo from './follows.repository.js';
import * as eventsRepo from './follow_events.repository.js';
import { IStrategySignal } from '../strategy_signals/strategy_signals.model.js';

// ========== FOLLOWS ==========

/**
 * Create a new follow
 */
export async function createFollow(
  userId: string,
  followType: FollowType,
  targetId: string,
  settings?: Partial<FollowSettings>,
  label?: string,
  notes?: string
): Promise<IFollow> {
  // Check if already following
  const existing = await followsRepo.getFollowByTarget(userId, followType, targetId);
  if (existing) {
    throw new Error('Already following this target');
  }
  
  return followsRepo.createFollow({
    userId,
    followType,
    targetId,
    settings,
    label,
    notes,
  });
}

/**
 * Get user's follows
 */
export async function getUserFollows(
  userId: string,
  followType?: FollowType
): Promise<IFollow[]> {
  return followsRepo.getFollowsByUser(userId, followType);
}

/**
 * Update follow settings
 */
export async function updateFollow(
  followId: string,
  userId: string,
  update: followsRepo.UpdateFollowInput
): Promise<IFollow | null> {
  // Verify ownership
  const follow = await followsRepo.getFollowById(followId);
  if (!follow || follow.userId !== userId) {
    return null;
  }
  
  return followsRepo.updateFollow(followId, update);
}

/**
 * Delete follow
 */
export async function deleteFollow(
  followId: string,
  userId: string
): Promise<boolean> {
  // Verify ownership
  const follow = await followsRepo.getFollowById(followId);
  if (!follow || follow.userId !== userId) {
    return false;
  }
  
  return followsRepo.deleteFollow(followId);
}

/**
 * Check if user follows target
 */
export async function isFollowing(
  userId: string,
  followType: FollowType,
  targetId: string
): Promise<boolean> {
  return followsRepo.isFollowing(userId, followType, targetId);
}

// ========== FOLLOW EVENTS ==========

/**
 * Get user's follow events (inbox)
 */
export async function getUserEvents(
  userId: string,
  options: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<IFollowEvent[]> {
  return eventsRepo.getFollowEventsByUser(userId, options);
}

/**
 * Get unread count
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return eventsRepo.getUnreadCount(userId);
}

/**
 * Mark event as read
 */
export async function markEventAsRead(
  eventId: string,
  userId: string
): Promise<IFollowEvent | null> {
  // Note: In production, verify ownership
  return eventsRepo.markAsRead(eventId);
}

/**
 * Mark all events as read
 */
export async function markAllEventsAsRead(userId: string): Promise<number> {
  return eventsRepo.markAllAsRead(userId);
}

/**
 * Get event stats
 */
export async function getEventStats(userId: string) {
  return eventsRepo.getEventStats(userId);
}

// ========== DISPATCH ENGINE ==========

/**
 * Dispatch strategy signal to followers
 * Called by dispatch-follow-events job
 */
export async function dispatchStrategySignal(
  signal: IStrategySignal
): Promise<number> {
  let dispatched = 0;
  
  // 1. Find followers of this actor
  const actorFollowers = await followsRepo.getFollowersByTarget('actor', signal.actorAddress);
  
  // 2. Find followers of this strategy type
  const strategyFollowers = await followsRepo.getFollowersByStrategyType(signal.strategyType);
  
  // Combine and dedupe by userId
  const followersMap = new Map<string, IFollow>();
  for (const f of actorFollowers) {
    followersMap.set(f.userId, f);
  }
  for (const f of strategyFollowers) {
    if (!followersMap.has(f.userId)) {
      followersMap.set(f.userId, f);
    }
  }
  
  const followers = Array.from(followersMap.values());
  
  // 3. Filter by settings and create events
  const eventsToCreate: eventsRepo.CreateFollowEventInput[] = [];
  
  for (const follow of followers) {
    // Check filters
    if (signal.severity < follow.settings.minSeverity) continue;
    if (signal.confidence < follow.settings.minConfidence) continue;
    
    // Check allowed types
    if (
      follow.settings.allowedTypes.length > 0 &&
      !follow.settings.allowedTypes.includes(signal.type)
    ) {
      continue;
    }
    
    // Check window
    if (follow.settings.window !== signal.window) continue;
    
    // Check dedup
    const exists = await eventsRepo.eventExists(
      follow.userId,
      'strategy_signal',
      signal._id.toString()
    );
    if (exists) continue;
    
    // Create event
    eventsToCreate.push({
      userId: follow.userId,
      source: {
        sourceType: 'strategy_signal',
        sourceId: signal._id.toString(),
      },
      targetType: follow.followType,
      targetId: signal.actorAddress,
      severity: signal.severity,
      confidence: signal.confidence,
      title: `${signal.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
      message: signal.explanation,
    });
  }
  
  // 4. Batch insert events
  if (eventsToCreate.length > 0) {
    const created = await eventsRepo.createManyFollowEvents(eventsToCreate);
    dispatched = created.length;
  }
  
  return dispatched;
}
