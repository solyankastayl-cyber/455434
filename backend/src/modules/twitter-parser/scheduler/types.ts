/**
 * Twitter Parser Module — Scheduler Types
 * 
 * Types for scheduler and worker.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY enums or interfaces
 */

// === Task Types ===

export type SchedulerTaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'COOLDOWN';
export type SchedulerTaskType = 'SEARCH' | 'ACCOUNT_TWEETS' | 'THREAD';
export type SchedulerTaskPriority = 'LOW' | 'NORMAL' | 'HIGH';
export type SchedulerScope = 'USER' | 'SYSTEM';

export enum TaskKind {
  SEARCH = 'search',
  ACCOUNT = 'account',
  THREAD = 'thread',
}

// === Scheduler Decisions ===

export interface SchedulerDecision {
  shouldPlan: boolean;
  reason: string;
  cooldownRemaining?: number;
  qualityStatus?: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
}

// === Planned Task ===

export interface PlannedTask {
  targetId: string;
  kind: TaskKind;
  query: string;
  estimatedPosts: number;
  priority: number;
}

// === Planned Batch ===

export interface PlannedBatch {
  ownerUserId: string;
  window: 'hour';
  totalPlannedPosts: number;
  tasks: PlannedTask[];
  skipped: {
    cooldown: number;
    alreadyPending: number;
    disabled: number;
    degradedQuality: number;
  };
}

// === Worker Status ===

export interface WorkerStatus {
  running: boolean;
  currentTasks: number;
  maxConcurrent: number;
  queueStats: {
    pending: number;
    running: number;
    done: number;
    failed: number;
  };
}

// === Dispatch Result ===

export interface DispatchResult {
  ok: boolean;
  data?: any;
  error?: string;
  errorCode?: string;
}

// === Queue Task ===

export interface QueueTask {
  id: string;
  type: SchedulerTaskType;
  status: SchedulerTaskStatus;
  scope: SchedulerScope;
  ownerUserId?: string;
  payload: {
    query?: string;
    targetId?: string;
    maxTweets?: number;
    limit?: number;
  };
  priority: SchedulerTaskPriority;
  priorityValue: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  lastError?: string;
}

// === Target for Scheduling ===

export interface SchedulerTarget {
  id: string;
  ownerUserId: string;
  type: 'KEYWORD' | 'ACCOUNT';
  query: string;
  enabled: boolean;
  priority: number;
  maxPostsPerRun: number;
  cooldownMin: number;
  lastPlannedAt?: Date;
  cooldownUntil?: Date;
  cooldownReason?: string;
}

// === Priority Configuration ===

export const PRIORITY_CONFIG = {
  TYPE_PRIORITY: {
    ACCOUNT: 100,
    KEYWORD: 50,
  },
  PRIORITY_VALUES: {
    LOW: 0,
    NORMAL: 10,
    HIGH: 20,
  },
} as const;

// === Worker Configuration ===

export const WORKER_CONFIG = {
  POLL_INTERVAL_MS: 500,
  MAX_CONCURRENT: 3,
  STALE_RECOVERY_INTERVAL: 60 * 1000,
  CLEANUP_INTERVAL: 10 * 60 * 1000,
} as const;
