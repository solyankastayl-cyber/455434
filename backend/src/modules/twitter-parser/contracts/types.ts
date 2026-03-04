/**
 * Twitter Parser Module — Type Definitions
 * 
 * Public types exported for external use.
 * Based on: v4.2-final
 */

// === Session Types ===

export type SessionStatus = 'OK' | 'STALE' | 'EXPIRED' | 'INVALID';

export interface TwitterSession {
  id: string;
  userId: string;
  accountId: string;
  status: SessionStatus;
  riskScore: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// === Task Types ===

export type TaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
export type TaskScope = 'USER' | 'SYSTEM';

export interface TwitterTask {
  id: string;
  scope: TaskScope;
  status: TaskStatus;
  targetId: string;
  sessionId?: string;
  attempt: number;
  result?: TaskResult;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskResult {
  fetched: number;
  saved: number;
  duplicates: number;
}

// === Preflight Types ===

export type PreflightStatus = 
  | 'READY'
  | 'NO_COOKIES'
  | 'SESSION_EXPIRED'
  | 'API_KEY_INVALID'
  | 'PARTIAL';

export interface PreflightResponse {
  status: PreflightStatus;
  message: string;
  action?: string;
  canSync: boolean;
}

// === Health Types ===

export type ParserStatus = 'UP' | 'DOWN' | 'DEGRADED';
export type WorkerStatus = 'ONLINE' | 'OFFLINE' | 'BUSY';

export interface SystemHealth {
  parser: ParserStatus;
  worker: WorkerStatus;
  queueSize: number;
  abortRate1h: number;
  abortRate24h: number;
}

// === Quality Types ===

export type QualityStatus = 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';

export interface QualityMetrics {
  targetId: string;
  status: QualityStatus;
  runsTotal: number;
  emptyStreak: number;
  avgFetched: number;
  qualityScore: number;
}

// === Event Types ===

export type TwitterEventType =
  // USER events
  | 'NEW_TWEETS'
  | 'SESSION_EXPIRED'
  | 'TARGET_COOLDOWN'
  | 'HIGH_RISK'
  | 'PARSE_ABORTED'
  // SYSTEM events
  | 'PARSER_DOWN'
  | 'PARSER_UP'
  | 'ABORT_RATE_HIGH';

export interface TwitterEvent {
  type: TwitterEventType;
  scope: 'USER' | 'SYSTEM';
  userId?: string;
  data: Record<string, any>;
  timestamp: Date;
}
