/**
 * Twitter Parser Module — Worker Logic
 * 
 * Pure worker/dispatch logic without mongoose dependencies.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY error codes or dispatch logic
 */

import type { QueueTask, DispatchResult, WorkerStatus } from './types.js';
import { shouldRetry, RetryDecision, computeBackoff } from '../core/retry/index.js';

/**
 * Extract error code from error message
 */
export function extractErrorCode(message: string): string {
  if (message.includes('ECONNREFUSED') || message.includes('PARSER_DOWN')) return 'PARSER_DOWN';
  if (message.includes('ETIMEDOUT') || message.includes('timeout')) return 'ETIMEDOUT';
  if (message.includes('ECONNRESET')) return 'ECONNRESET';
  if (message.includes('SESSION_EXPIRED')) return 'SESSION_EXPIRED';
  if (message.includes('SESSION_INVALID')) return 'SESSION_INVALID';
  if (message.includes('DECRYPT')) return 'DECRYPT_FAILED';
  if (message.includes('ALL_SESSIONS_INVALID')) return 'ALL_SESSIONS_INVALID';
  return 'UNKNOWN';
}

/**
 * Determine what to do after task failure
 */
export function handleTaskFailure(task: QueueTask, errorCode: string): {
  decision: RetryDecision;
  nextRetryAt?: Date;
  shouldApplyCooldown: boolean;
  cooldownReason?: string;
} {
  const decision = shouldRetry(errorCode);
  
  if (decision === RetryDecision.RETRY) {
    const backoff = computeBackoff(task.attempts);
    if (backoff.canRetry) {
      return {
        decision,
        nextRetryAt: new Date(Date.now() + backoff.delayMs),
        shouldApplyCooldown: false,
      };
    }
    // Exhausted retries
    return {
      decision: RetryDecision.NO_RETRY,
      shouldApplyCooldown: false,
    };
  }
  
  if (decision === RetryDecision.COOLDOWN) {
    return {
      decision,
      shouldApplyCooldown: true,
      cooldownReason: errorCode,
    };
  }
  
  return {
    decision,
    shouldApplyCooldown: false,
  };
}

/**
 * Check if task execution should proceed
 */
export function canExecuteTask(task: QueueTask, currentTasks: number, maxConcurrent: number): {
  canExecute: boolean;
  reason?: string;
} {
  if (currentTasks >= maxConcurrent) {
    return { canExecute: false, reason: 'MAX_CONCURRENT_REACHED' };
  }
  
  if (task.status !== 'PENDING') {
    return { canExecute: false, reason: 'TASK_NOT_PENDING' };
  }
  
  return { canExecute: true };
}

/**
 * Determine task execution path
 */
export function getExecutionPath(task: QueueTask): 'USER' | 'SYSTEM' {
  if (task.scope === 'USER' || task.ownerUserId) {
    return 'USER';
  }
  return 'SYSTEM';
}

/**
 * Get descriptive error for no available slot
 */
export function getNoSlotError(diagnostics: {
  total: number;
  enabled: number;
  rateLimited: number;
  inCooldown: number;
}): string {
  if (diagnostics.total === 0) {
    return 'No parser instances configured';
  }
  if (diagnostics.enabled === 0) {
    return 'All parser instances are disabled';
  }
  if (diagnostics.rateLimited > 0 && diagnostics.inCooldown === 0) {
    return 'All instances have reached hourly rate limit';
  }
  if (diagnostics.inCooldown > 0) {
    return `All instances in cooldown (${diagnostics.inCooldown})`;
  }
  return 'No available parser instance';
}
