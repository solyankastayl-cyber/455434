/**
 * Twitter Parser Module — Scheduler Logic
 * 
 * Pure scheduling logic without mongoose dependencies.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY scheduling algorithm
 */

import type { 
  SchedulerTarget, 
  PlannedTask, 
  PlannedBatch, 
  SchedulerDecision,
  TaskKind,
} from './types.js';
import { 
  isTargetOnCooldown, 
  isTargetOnExplicitCooldown,
  calculateEffectivePriority,
  sortTargetsByPriority,
} from './adapters/legacy-target.adapter.js';

/**
 * Scheduler logic interface
 */
export interface ISchedulerLogic {
  /**
   * Plan tasks for a set of targets
   */
  planTasks(input: {
    ownerUserId: string;
    targets: SchedulerTarget[];
    pendingTargetIds: Set<string>;
    remainingBudget: number;
    qualityStatuses?: Map<string, 'HEALTHY' | 'DEGRADED' | 'UNSTABLE'>;
  }): PlannedBatch;
  
  /**
   * Check if target should be scheduled
   */
  shouldScheduleTarget(target: SchedulerTarget, context: {
    pendingTargetIds: Set<string>;
    qualityStatus?: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
    now?: Date;
  }): SchedulerDecision;
}

/**
 * Scheduler logic implementation
 */
export class SchedulerLogic implements ISchedulerLogic {
  
  planTasks(input: {
    ownerUserId: string;
    targets: SchedulerTarget[];
    pendingTargetIds: Set<string>;
    remainingBudget: number;
    qualityStatuses?: Map<string, 'HEALTHY' | 'DEGRADED' | 'UNSTABLE'>;
  }): PlannedBatch {
    const { ownerUserId, targets, pendingTargetIds, qualityStatuses } = input;
    let remainingBudget = input.remainingBudget;
    
    const batch: PlannedBatch = {
      ownerUserId,
      window: 'hour',
      totalPlannedPosts: 0,
      tasks: [],
      skipped: {
        cooldown: 0,
        alreadyPending: 0,
        disabled: 0,
        degradedQuality: 0,
      },
    };
    
    // Sort by priority
    const sortedTargets = sortTargetsByPriority(targets);
    const now = new Date();
    
    for (const target of sortedTargets) {
      if (remainingBudget <= 0) break;
      
      const qualityStatus = qualityStatuses?.get(target.id);
      const decision = this.shouldScheduleTarget(target, {
        pendingTargetIds,
        qualityStatus,
        now,
      });
      
      if (!decision.shouldPlan) {
        // Track skipped reason
        if (decision.reason === 'DISABLED') batch.skipped.disabled++;
        else if (decision.reason === 'ALREADY_PENDING') batch.skipped.alreadyPending++;
        else if (decision.reason === 'COOLDOWN' || decision.reason === 'EXPLICIT_COOLDOWN') batch.skipped.cooldown++;
        else if (decision.reason === 'DEGRADED_QUALITY' || decision.reason === 'UNSTABLE_QUALITY') batch.skipped.degradedQuality++;
        continue;
      }
      
      // Calculate posts for this task
      const postsForTask = Math.min(target.maxPostsPerRun, remainingBudget);
      
      if (postsForTask < 10) continue; // Minimum viable task
      
      // Add to plan
      batch.tasks.push({
        targetId: target.id,
        kind: this.mapTargetTypeToKind(target.type),
        query: target.query,
        estimatedPosts: postsForTask,
        priority: calculateEffectivePriority(target),
      });
      
      batch.totalPlannedPosts += postsForTask;
      remainingBudget -= postsForTask;
    }
    
    return batch;
  }
  
  shouldScheduleTarget(target: SchedulerTarget, context: {
    pendingTargetIds: Set<string>;
    qualityStatus?: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
    now?: Date;
  }): SchedulerDecision {
    const now = context.now || new Date();
    
    // Check disabled
    if (!target.enabled) {
      return { shouldPlan: false, reason: 'DISABLED' };
    }
    
    // Check already pending
    if (context.pendingTargetIds.has(target.id)) {
      return { shouldPlan: false, reason: 'ALREADY_PENDING' };
    }
    
    // Check explicit cooldown (Phase 4.2)
    if (isTargetOnExplicitCooldown(target, now)) {
      return {
        shouldPlan: false,
        reason: 'EXPLICIT_COOLDOWN',
        cooldownRemaining: new Date(target.cooldownUntil!).getTime() - now.getTime(),
      };
    }
    
    // Check scheduling cooldown
    if (isTargetOnCooldown(target, now)) {
      return { shouldPlan: false, reason: 'COOLDOWN' };
    }
    
    // Phase 5.3: Check quality status
    if (context.qualityStatus === 'UNSTABLE') {
      // Only run 1 in 3 times for unstable targets
      if (Math.random() > 0.33) {
        return {
          shouldPlan: false,
          reason: 'UNSTABLE_QUALITY',
          qualityStatus: 'UNSTABLE',
        };
      }
    }
    
    if (context.qualityStatus === 'DEGRADED') {
      // DEGRADED targets run at 70% frequency
      if (Math.random() > 0.7) {
        return {
          shouldPlan: false,
          reason: 'DEGRADED_QUALITY',
          qualityStatus: 'DEGRADED',
        };
      }
    }
    
    return {
      shouldPlan: true,
      reason: 'OK',
      qualityStatus: context.qualityStatus,
    };
  }
  
  private mapTargetTypeToKind(type: 'KEYWORD' | 'ACCOUNT'): TaskKind {
    switch (type) {
      case 'ACCOUNT':
        return 'account' as TaskKind;
      case 'KEYWORD':
        return 'search' as TaskKind;
      default:
        return 'search' as TaskKind;
    }
  }
}

export const schedulerLogic = new SchedulerLogic();
