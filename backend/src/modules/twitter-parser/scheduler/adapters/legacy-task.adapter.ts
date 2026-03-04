/**
 * Twitter Parser Module — Legacy Task Adapter
 * 
 * Converts between legacy mongoose task and module task types.
 * Based on: v4.2-final
 */

import type { QueueTask, SchedulerTaskStatus, SchedulerTaskType, SchedulerTaskPriority, SchedulerScope } from '../types.js';

/**
 * Convert legacy mongoose task to module task
 */
export function fromLegacyTask(legacyTask: any): QueueTask {
  return {
    id: legacyTask._id?.toString() || legacyTask.id,
    type: legacyTask.type as SchedulerTaskType,
    status: legacyTask.status as SchedulerTaskStatus,
    scope: (legacyTask.scope || legacyTask.ownerType || 'SYSTEM') as SchedulerScope,
    ownerUserId: legacyTask.ownerUserId,
    payload: {
      query: legacyTask.payload?.query || legacyTask.payload?.keyword,
      targetId: legacyTask.payload?.targetId,
      maxTweets: legacyTask.payload?.maxTweets || legacyTask.payload?.limit,
      limit: legacyTask.payload?.limit,
    },
    priority: legacyTask.priority as SchedulerTaskPriority,
    priorityValue: legacyTask.priorityValue || 10,
    attempts: legacyTask.attempts || 0,
    maxAttempts: legacyTask.maxAttempts || 3,
    createdAt: legacyTask.createdAt,
    startedAt: legacyTask.startedAt,
    completedAt: legacyTask.completedAt,
    result: legacyTask.result,
    lastError: legacyTask.lastError,
  };
}

/**
 * Convert module task to legacy format for queue operations
 */
export function toLegacyTask(task: QueueTask): any {
  return {
    type: task.type,
    status: task.status,
    scope: task.scope,
    ownerType: task.scope,
    ownerUserId: task.ownerUserId,
    payload: {
      query: task.payload.query,
      targetId: task.payload.targetId,
      maxTweets: task.payload.maxTweets,
      limit: task.payload.limit,
    },
    priority: task.priority,
    priorityValue: task.priorityValue,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
  };
}

/**
 * Map task kind to task type
 */
export function kindToTaskType(kind: string): SchedulerTaskType {
  switch (kind) {
    case 'account':
      return 'ACCOUNT_TWEETS';
    case 'search':
      return 'SEARCH';
    case 'thread':
      return 'THREAD';
    default:
      return 'SEARCH';
  }
}

/**
 * Map task type to task kind
 */
export function taskTypeToKind(type: SchedulerTaskType): string {
  switch (type) {
    case 'ACCOUNT_TWEETS':
      return 'account';
    case 'SEARCH':
      return 'search';
    case 'THREAD':
      return 'thread';
    default:
      return 'search';
  }
}
