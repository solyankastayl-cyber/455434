/**
 * P1: Signal Lifecycle Types
 * 
 * FSM states and transition types for signal lifecycle management.
 * Signals are now living entities, not one-time events.
 */

export type SignalStatus =
  | 'NEW'       // Signal appeared for the first time
  | 'ACTIVE'    // Confirmed, currently valid
  | 'COOLDOWN'  // Not confirmed recently, but still alive
  | 'RESOLVED'  // Obsolete / lost relevance

export type ResolveReason =
  | 'inactivity'      // 3+ snapshots without trigger
  | 'confidence_drop' // Confidence fell below threshold
  | 'invalidated'     // External invalidation
  | 'manual'          // Manual resolution

export interface SignalLifecycleState {
  status: SignalStatus
  firstTriggeredAt: Date
  lastTriggeredAt: Date
  snapshotsWithoutTrigger: number
  cooldownUntil?: Date
  resolveReason?: ResolveReason
}

/**
 * Lifecycle transition parameters
 */
export interface LifecycleTransitionParams {
  triggered: boolean
  confidence: number
  now: Date
}

/**
 * Lifecycle thresholds (configurable)
 */
export const LIFECYCLE_THRESHOLDS = {
  // Minimum confidence to transition NEW → ACTIVE
  activationConfidence: 70,
  
  // Number of empty snapshots before auto-resolve
  maxSnapshotsWithoutTrigger: 3,
  
  // Cooldown duration in hours (optional time-based cooldown)
  cooldownHours: 24,
  
  // Confidence below which signal is auto-resolved
  minConfidenceForActive: 40,
} as const;
