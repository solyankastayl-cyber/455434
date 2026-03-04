/**
 * Twitter Parser Module — Legacy Target Adapter
 * 
 * Converts between legacy mongoose target and module target types.
 * Based on: v4.2-final
 */

import type { SchedulerTarget } from '../types.js';

/**
 * Convert legacy mongoose target to module target
 */
export function fromLegacyTarget(legacyTarget: any): SchedulerTarget {
  return {
    id: legacyTarget._id?.toString() || legacyTarget.id,
    ownerUserId: legacyTarget.ownerUserId?.toString() || legacyTarget.ownerUserId,
    type: legacyTarget.type,
    query: legacyTarget.query,
    enabled: legacyTarget.enabled ?? true,
    priority: legacyTarget.priority ?? 3,
    maxPostsPerRun: legacyTarget.maxPostsPerRun ?? 50,
    cooldownMin: legacyTarget.cooldownMin ?? 10,
    lastPlannedAt: legacyTarget.lastPlannedAt,
    cooldownUntil: legacyTarget.cooldownUntil,
    cooldownReason: legacyTarget.cooldownReason,
  };
}

/**
 * Check if target is on scheduling cooldown
 */
export function isTargetOnCooldown(target: SchedulerTarget, now: Date = new Date()): boolean {
  if (!target.lastPlannedAt) return false;
  
  const cooldownMs = target.cooldownMin * 60 * 1000;
  const elapsed = now.getTime() - new Date(target.lastPlannedAt).getTime();
  
  return elapsed < cooldownMs;
}

/**
 * Check if target is on explicit cooldown (Phase 4.2)
 */
export function isTargetOnExplicitCooldown(target: SchedulerTarget, now: Date = new Date()): boolean {
  if (!target.cooldownUntil) return false;
  return new Date(target.cooldownUntil) > now;
}

/**
 * Calculate effective priority for target
 */
export function calculateEffectivePriority(target: SchedulerTarget): number {
  const typePriority = target.type === 'ACCOUNT' ? 100 : 50;
  return target.priority * 20 + typePriority;
}

/**
 * Sort targets by effective priority
 */
export function sortTargetsByPriority(targets: SchedulerTarget[]): SchedulerTarget[] {
  return [...targets].sort((a, b) => {
    const prioA = calculateEffectivePriority(a);
    const prioB = calculateEffectivePriority(b);
    return prioB - prioA;
  });
}
