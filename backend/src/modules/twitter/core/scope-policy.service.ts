// Scope-aware Policy Service
// Separate limits and policies for USER vs SYSTEM execution contexts

import { ExecutionScope, isSystemScope } from '../core/execution-scope.js';

// Default policy limits
export interface ScopePolicyLimits {
  maxTasksPerHour: number;
  maxPostsPerDay: number;
  cooldownMinutes: number;
  maxConcurrentTasks: number;
  maxRetries: number;
}

// Default USER limits
const USER_POLICY_LIMITS: ScopePolicyLimits = {
  maxTasksPerHour: 50,
  maxPostsPerDay: 500,
  cooldownMinutes: 5,
  maxConcurrentTasks: 2,
  maxRetries: 3,
};

// Default SYSTEM limits (more generous)
const SYSTEM_POLICY_LIMITS: ScopePolicyLimits = {
  maxTasksPerHour: 200,
  maxPostsPerDay: 5000,
  cooldownMinutes: 2,
  maxConcurrentTasks: 10,
  maxRetries: 5,
};

/**
 * Get policy limits for a given scope
 */
export function getPolicyLimits(scope: ExecutionScope): ScopePolicyLimits {
  return isSystemScope(scope) ? SYSTEM_POLICY_LIMITS : USER_POLICY_LIMITS;
}

/**
 * Check if task count is within limits for scope
 */
export function isWithinTaskLimit(scope: ExecutionScope, currentCount: number): boolean {
  const limits = getPolicyLimits(scope);
  return currentCount < limits.maxTasksPerHour;
}

/**
 * Check if posts count is within limits for scope
 */
export function isWithinPostLimit(scope: ExecutionScope, currentCount: number): boolean {
  const limits = getPolicyLimits(scope);
  return currentCount < limits.maxPostsPerDay;
}

/**
 * Get cooldown duration for scope
 */
export function getCooldownMinutes(scope: ExecutionScope): number {
  return getPolicyLimits(scope).cooldownMinutes;
}

/**
 * Get max concurrent tasks for scope
 */
export function getMaxConcurrentTasks(scope: ExecutionScope): number {
  return getPolicyLimits(scope).maxConcurrentTasks;
}

/**
 * Get max retries for scope
 */
export function getMaxRetries(scope: ExecutionScope): number {
  return getPolicyLimits(scope).maxRetries;
}

// Policy violation types
export enum PolicyViolationType {
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED',
  CONCURRENT_LIMIT_EXCEEDED = 'CONCURRENT_LIMIT_EXCEEDED',
  COOLDOWN_ACTIVE = 'COOLDOWN_ACTIVE',
}

export interface PolicyCheckResult {
  allowed: boolean;
  violation?: PolicyViolationType;
  message?: string;
  retryAfterMs?: number;
}

/**
 * Check if execution is allowed under current policy
 */
export async function checkPolicy(
  scope: ExecutionScope,
  context: {
    tasksInLastHour: number;
    postsToday: number;
    runningTasks: number;
    lastTaskCompletedAt?: Date;
  }
): Promise<PolicyCheckResult> {
  const limits = getPolicyLimits(scope);
  
  // Check hourly task limit
  if (context.tasksInLastHour >= limits.maxTasksPerHour) {
    return {
      allowed: false,
      violation: PolicyViolationType.RATE_LIMIT_EXCEEDED,
      message: `Hourly task limit reached (${limits.maxTasksPerHour})`,
      retryAfterMs: 60 * 60 * 1000, // 1 hour
    };
  }
  
  // Check daily post limit
  if (context.postsToday >= limits.maxPostsPerDay) {
    return {
      allowed: false,
      violation: PolicyViolationType.DAILY_LIMIT_EXCEEDED,
      message: `Daily post limit reached (${limits.maxPostsPerDay})`,
      retryAfterMs: 24 * 60 * 60 * 1000, // 24 hours
    };
  }
  
  // Check concurrent task limit
  if (context.runningTasks >= limits.maxConcurrentTasks) {
    return {
      allowed: false,
      violation: PolicyViolationType.CONCURRENT_LIMIT_EXCEEDED,
      message: `Concurrent task limit reached (${limits.maxConcurrentTasks})`,
      retryAfterMs: 30 * 1000, // 30 seconds
    };
  }
  
  // Check cooldown
  if (context.lastTaskCompletedAt) {
    const cooldownMs = limits.cooldownMinutes * 60 * 1000;
    const timeSinceLastTask = Date.now() - context.lastTaskCompletedAt.getTime();
    if (timeSinceLastTask < cooldownMs) {
      return {
        allowed: false,
        violation: PolicyViolationType.COOLDOWN_ACTIVE,
        message: `Cooldown active (${limits.cooldownMinutes} min)`,
        retryAfterMs: cooldownMs - timeSinceLastTask,
      };
    }
  }
  
  return { allowed: true };
}
