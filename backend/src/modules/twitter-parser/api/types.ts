/**
 * Twitter Parser Module — API Types
 * 
 * Request/Response types for REST API.
 * Based on: v4.2-final
 */

// === Common ===

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// === Sync Types ===

export interface PreflightRequest {
  cookies: Array<{ name: string; value: string; domain?: string; expires?: number }>;
  accountId?: string;
}

export interface PreflightResponse {
  ok: boolean;
  state: string;
  details: {
    hasAuth: boolean;
    cookiesCount: number;
    foundAuth: string[];
  };
  fixHint: string | null;
  canSync: boolean;
}

export interface SyncRequest {
  cookies: Array<{ name: string; value: string; domain?: string; expires?: number }>;
  accountId?: string;
  source?: 'chrome' | 'web' | 'zip';
}

export interface SyncResponse {
  ok: boolean;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  sessionId?: string;
  message: string;
}

// === Target Types ===

export interface TargetRequest {
  type: 'KEYWORD' | 'ACCOUNT';
  query: string;
  priority?: number;
  maxPostsPerRun?: number;
  cooldownMin?: number;
  enabled?: boolean;
}

export interface TargetResponse {
  id: string;
  type: 'KEYWORD' | 'ACCOUNT';
  query: string;
  enabled: boolean;
  priority: number;
  maxPostsPerRun: number;
  cooldownMin: number;
  lastPlannedAt?: string;
  stats: {
    totalRuns: number;
    totalPostsFetched: number;
    lastRunAt?: string;
  };
}

// === Status Types ===

export interface StatusResponse {
  parser: {
    status: 'UP' | 'DOWN' | 'DEGRADED';
    lastCheck: string;
  };
  session: {
    status: 'OK' | 'STALE' | 'EXPIRED' | 'NONE';
    riskScore?: number;
  };
  lastParse?: {
    at: string;
    fetched: number;
    target: string;
  };
  nextParse?: {
    at: string;
    target: string;
  };
  quality: {
    status: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
    score: number;
  };
}

// === Admin Types ===

export interface SessionAdminResponse {
  id: string;
  userId: string;
  accountId: string;
  username?: string;
  status: string;
  riskScore: number;
  version: number;
  isActive: boolean;
  lastSyncAt?: string;
  updatedAt: string;
}

export interface TaskAdminResponse {
  id: string;
  type: string;
  status: string;
  scope: string;
  targetId?: string;
  attempts: number;
  maxAttempts: number;
  priority: string;
  result?: any;
  lastError?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface HealthResponse {
  parser: 'UP' | 'DOWN' | 'DEGRADED';
  worker: 'ONLINE' | 'OFFLINE' | 'BUSY';
  queueSize: number;
  abortRate1h: number;
  abortRate24h: number;
}

export interface QualityResponse {
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unstable: number;
    avgScore: number;
    healthRate: number;
  };
  degradedTargets: Array<{
    targetId: string;
    status: string;
    emptyStreak: number;
    reason?: string;
  }>;
}
