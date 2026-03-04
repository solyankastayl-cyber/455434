/**
 * Snapshot Invalidation Service
 * 
 * Handles automatic invalidation of snapshots when:
 * - Strategy shifts
 * - Score tier changes
 * - Alerts are acknowledged
 * 
 * This creates "living system" feel.
 */
import * as snapshotsRepo from './snapshots.repository.js';
import { ActorProfileModel } from '../profiles/actor_profiles.model.js';

/**
 * Invalidation event types
 */
export type InvalidationReason = 
  | 'strategy_shift'
  | 'score_tier_change'
  | 'alert_acknowledged'
  | 'profile_updated'
  | 'manual';

/**
 * Invalidation log entry
 */
export interface InvalidationLog {
  address: string;
  reason: InvalidationReason;
  snapshotsInvalidated: number;
  timestamp: Date;
}

// In-memory log (in production, could be persisted)
const invalidationLogs: InvalidationLog[] = [];
const MAX_LOG_SIZE = 1000;

/**
 * Invalidate snapshots for an address with reason tracking
 */
export async function invalidateForAddress(
  address: string,
  reason: InvalidationReason
): Promise<number> {
  const count = await snapshotsRepo.invalidateSnapshots(address);
  
  // Log invalidation
  invalidationLogs.push({
    address: address.toLowerCase(),
    reason,
    snapshotsInvalidated: count,
    timestamp: new Date(),
  });
  
  // Trim log
  if (invalidationLogs.length > MAX_LOG_SIZE) {
    invalidationLogs.shift();
  }
  
  console.log(`[Snapshot Invalidation] ${address}: ${reason} (${count} snapshots)`);
  
  return count;
}

/**
 * Called when strategy shifts
 */
export async function onStrategyShift(
  address: string,
  fromStrategy: string,
  toStrategy: string
): Promise<void> {
  await invalidateForAddress(address, 'strategy_shift');
}

/**
 * Called when score tier changes
 */
export async function onScoreTierChange(
  address: string,
  fromTier: string,
  toTier: string
): Promise<void> {
  await invalidateForAddress(address, 'score_tier_change');
}

/**
 * Called when alert is acknowledged
 */
export async function onAlertAcknowledged(
  alertId: string,
  address: string
): Promise<void> {
  await invalidateForAddress(address, 'alert_acknowledged');
}

/**
 * Called when profile is updated
 */
export async function onProfileUpdated(address: string): Promise<void> {
  await invalidateForAddress(address, 'profile_updated');
}

/**
 * Get recent invalidation logs
 */
export function getInvalidationLogs(limit: number = 50): InvalidationLog[] {
  return invalidationLogs.slice(-limit).reverse();
}

/**
 * Get invalidation stats
 */
export function getInvalidationStats(): {
  total: number;
  byReason: Record<string, number>;
  last24h: number;
} {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  
  const byReason: Record<string, number> = {};
  let last24h = 0;
  
  for (const log of invalidationLogs) {
    byReason[log.reason] = (byReason[log.reason] || 0) + 1;
    if (log.timestamp.getTime() > dayAgo) {
      last24h++;
    }
  }
  
  return {
    total: invalidationLogs.length,
    byReason,
    last24h,
  };
}
