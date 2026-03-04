/**
 * P1: Signal Lifecycle State Machine
 * 
 * Manages state transitions for signals:
 * NEW → ACTIVE → COOLDOWN → RESOLVED
 * 
 * Rules:
 * - NEW → ACTIVE: triggered AND confidence >= 70
 * - ACTIVE → ACTIVE: triggered again (refresh)
 * - ACTIVE → COOLDOWN: 1 snapshot without trigger
 * - COOLDOWN → ACTIVE: triggered again (revival)
 * - COOLDOWN → RESOLVED: 3 snapshots without trigger
 * - Any → RESOLVED: confidence < 40 OR invalidated
 */

import { 
  SignalLifecycleState, 
  SignalStatus,
  LifecycleTransitionParams,
  LIFECYCLE_THRESHOLDS 
} from './lifecycle.types.js';

// Re-export types for convenience
export type { SignalLifecycleState, SignalStatus, LifecycleTransitionParams };
export { LIFECYCLE_THRESHOLDS };

/**
 * Create initial lifecycle state for a new signal
 */
export function createInitialLifecycleState(now = new Date()): SignalLifecycleState {
  return {
    status: 'NEW',
    firstTriggeredAt: now,
    lastTriggeredAt: now,
    snapshotsWithoutTrigger: 0,
  };
}

/**
 * Apply lifecycle state transition based on current state and params
 * 
 * @param state - Current lifecycle state
 * @param params - Transition parameters (triggered, confidence, now)
 * @returns Updated lifecycle state
 */
export function applyLifecycleTransition(
  state: SignalLifecycleState,
  params: LifecycleTransitionParams
): SignalLifecycleState {
  const { triggered, confidence, now } = params;
  const t = LIFECYCLE_THRESHOLDS;

  // RESOLVED is terminal - no transitions out
  if (state.status === 'RESOLVED') {
    return state;
  }

  // Hard stop: confidence drop below minimum
  if (confidence < t.minConfidenceForActive) {
    return {
      ...state,
      status: 'RESOLVED',
      resolveReason: 'confidence_drop',
    };
  }

  // NEW → ACTIVE
  if (state.status === 'NEW') {
    if (triggered && confidence >= t.activationConfidence) {
      return {
        ...state,
        status: 'ACTIVE',
        lastTriggeredAt: now,
        snapshotsWithoutTrigger: 0,
      };
    }
    // Stay NEW if not activated yet
    return state;
  }

  // ACTIVE logic
  if (state.status === 'ACTIVE') {
    if (triggered) {
      // Refresh: still active, update lastTriggeredAt
      return {
        ...state,
        lastTriggeredAt: now,
        snapshotsWithoutTrigger: 0,
      };
    }

    // No trigger → enter cooldown
    return {
      ...state,
      status: 'COOLDOWN',
      snapshotsWithoutTrigger: state.snapshotsWithoutTrigger + 1,
    };
  }

  // COOLDOWN logic
  if (state.status === 'COOLDOWN') {
    if (triggered) {
      // Revival: back to active
      return {
        ...state,
        status: 'ACTIVE',
        lastTriggeredAt: now,
        snapshotsWithoutTrigger: 0,
      };
    }

    const missed = state.snapshotsWithoutTrigger + 1;

    // Auto-resolve after max snapshots without trigger
    if (missed >= t.maxSnapshotsWithoutTrigger) {
      return {
        ...state,
        status: 'RESOLVED',
        resolveReason: 'inactivity',
        snapshotsWithoutTrigger: missed,
      };
    }

    // Stay in cooldown
    return {
      ...state,
      snapshotsWithoutTrigger: missed,
    };
  }

  return state;
}

/**
 * Check if signal should be visible in UI
 */
export function isSignalActive(status: SignalStatus): boolean {
  return status === 'NEW' || status === 'ACTIVE' || status === 'COOLDOWN';
}

/**
 * Get human-readable status label
 */
export function getStatusLabel(status: SignalStatus): string {
  const labels: Record<SignalStatus, string> = {
    NEW: 'New Signal',
    ACTIVE: 'Active',
    COOLDOWN: 'Cooling Down',
    RESOLVED: 'Resolved',
  };
  return labels[status] || status;
}

/**
 * Get status color for UI
 */
export function getStatusColor(status: SignalStatus): string {
  const colors: Record<SignalStatus, string> = {
    NEW: 'blue',
    ACTIVE: 'green',
    COOLDOWN: 'yellow',
    RESOLVED: 'gray',
  };
  return colors[status] || 'gray';
}
