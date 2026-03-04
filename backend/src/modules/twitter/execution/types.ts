// B2 Execution Core - Types
// Base contracts for Parser Execution Layer

export type SlotKind = 'PROXY' | 'REMOTE_WORKER' | 'MOCK';

// Health status for slots (aligned with B3 Runtime)
export type EgressSlotHealthStatus =
  | 'UNKNOWN'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'ERROR';

// Task types supported by the parser
export type ParserTaskType =
  | 'SEARCH'
  | 'ACCOUNT_TWEETS'
  | 'ACCOUNT_FOLLOWERS'
  | 'ACCOUNT_SUMMARY';

// Account for execution (simplified view from B1)
export interface ExecutionAccount {
  id: string;
  label: string;
  enabled: boolean;
}

// Parser Instance (slot) for execution
export interface ParserInstance {
  id: string;
  label: string;
  kind: SlotKind;
  
  // Connection
  baseUrl?: string;     // for REMOTE_WORKER (Railway)
  proxyUrl?: string;    // for PROXY
  
  enabled: boolean;
  accountId?: string;
  
  // Rate limiting
  usedInWindow: number;
  windowStart: number;  // timestamp ms
  limitPerHour: number; // 200 by default
  
  // Cooldown
  cooldownUntil?: number; // timestamp ms
  
  // Health (updated by Runtime Layer)
  health?: EgressSlotHealthStatus;
}

// Task definition
export interface ParserTask {
  id: string;
  type: ParserTaskType;
  payload: Record<string, any>;
  
  // Execution state
  attempts: number;
  maxAttempts: number;
  status: 'PENDING' | 'RUNNING' | 'FAILED' | 'DONE';
  
  // Metadata
  accountId?: string;
  instanceId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  lastError?: string;
}

// Execution result
export interface ExecutionResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  meta?: {
    accountId: string;
    instanceId: string;
    taskId: string;
    duration: number;
  };
}

// Error codes
export const ExecutionErrorCodes = {
  NO_AVAILABLE_SLOT: 'NO_AVAILABLE_SLOT',
  NO_ACTIVE_ACCOUNT: 'NO_ACTIVE_ACCOUNT',
  SLOT_RATE_LIMITED: 'SLOT_RATE_LIMITED',
  SLOT_IN_COOLDOWN: 'SLOT_IN_COOLDOWN',
  REMOTE_ERROR: 'REMOTE_ERROR',
  REMOTE_TIMEOUT: 'REMOTE_TIMEOUT',
  PROXY_NOT_IMPLEMENTED: 'PROXY_NOT_IMPLEMENTED',
  MAX_RETRIES_EXCEEDED: 'MAX_RETRIES_EXCEEDED',
} as const;

// Task payload types
export interface SearchTaskPayload {
  query: string;
  maxResults?: number;
}

export interface AccountTweetsPayload {
  username: string;
  maxResults?: number;
}

export interface AccountFollowersPayload {
  username: string;
  maxResults?: number;
}

// Factory for creating tasks
export function createTask(
  type: ParserTaskType,
  payload: Record<string, any>,
  maxAttempts = 3
): ParserTask {
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    payload,
    attempts: 0,
    maxAttempts,
    status: 'PENDING',
    createdAt: Date.now(),
  };
}
