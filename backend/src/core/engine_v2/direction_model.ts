/**
 * Engine V2: Direction Model
 * 
 * Extracts directional signal from D1 signals.
 * Uses explicit direction field or infers from signal type.
 */
import type { D1Signal, D1Direction, D1SignalType } from '../d1_signals/d1_signal.types.js';

// Direction to numeric value mapping
const DIRECTION_VALUE: Record<D1Direction, number> = {
  'inflow': +1,
  'outflow': -1,
  'bidirectional': 0,
  'neutral': 0,
};

// Signal type to direction mapping (fallback)
const TYPE_DIRECTION: Record<D1SignalType, number> = {
  'NEW_CORRIDOR': 0,
  'DENSITY_SPIKE': 0,
  'DIRECTION_IMBALANCE': 0, // Uses flows to determine
  'ACTOR_REGIME_CHANGE': 0,
  'NEW_BRIDGE': 0,
  'CLUSTER_RECONFIGURATION': 0,
};

/**
 * Get directional value for a signal
 * 
 * Priority:
 * 1. Explicit direction field (-1 to +1)
 * 2. Net flow ratio from metrics
 * 3. Direction from evidence
 * 4. Signal type inference
 */
export function getSignalDirection(signal: D1Signal): number {
  // 1. Check explicit direction
  if (signal.direction) {
    return DIRECTION_VALUE[signal.direction] ?? 0;
  }
  
  // 2. Check net flow ratio in metrics
  if (signal.metrics?.netFlowRatio !== undefined) {
    const ratio = signal.metrics.netFlowRatio;
    // Normalize to -1..+1
    return Math.max(-1, Math.min(1, ratio));
  }
  
  // 3. Check flows in metrics or evidence
  const inflowUsd = signal.metrics?.inflowUsd ?? signal.evidence?.flows?.inflowUsd ?? 0;
  const outflowUsd = signal.metrics?.outflowUsd ?? signal.evidence?.flows?.outflowUsd ?? 0;
  
  if (inflowUsd > 0 || outflowUsd > 0) {
    const total = inflowUsd + outflowUsd;
    if (total > 0) {
      const netFlow = inflowUsd - outflowUsd;
      return Math.max(-1, Math.min(1, netFlow / total));
    }
  }
  
  // 4. Check evidence direction
  if (signal.evidence?.current?.direction) {
    return DIRECTION_VALUE[signal.evidence.current.direction] ?? 0;
  }
  
  // 5. Check top edges for dominant direction
  const topEdges = signal.evidence?.topEdges ?? [];
  if (topEdges.length > 0) {
    let inflowCount = 0;
    let outflowCount = 0;
    
    for (const edge of topEdges) {
      if (edge.direction === 'inflow') inflowCount++;
      else if (edge.direction === 'outflow') outflowCount++;
    }
    
    if (inflowCount > outflowCount) return 0.5;
    if (outflowCount > inflowCount) return -0.5;
  }
  
  // 6. Fallback to signal type
  return TYPE_DIRECTION[signal.type] ?? 0;
}
