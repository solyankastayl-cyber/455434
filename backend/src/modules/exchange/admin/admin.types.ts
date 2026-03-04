/**
 * Y1 — Exchange Admin Types
 * ==========================
 * 
 * Admin Control Plane contracts for:
 * - Provider management
 * - Job management
 * - Health monitoring
 */

import { ProviderId, ProviderStatus } from '../providers/exchangeProvider.types.js';

// ═══════════════════════════════════════════════════════════════
// PROVIDER ADMIN DTOs
// ═══════════════════════════════════════════════════════════════

export interface ProviderAdminDTO {
  id: ProviderId;
  enabled: boolean;
  priority: number;
  health: {
    status: ProviderStatus;
    errorCount: number;
    lastError: string | null;
    lastOkAt: number | null;
    lastErrorAt: number | null;
  };
  updatedAt: number;
}

export interface ProviderPatchDTO {
  enabled?: boolean;
  priority?: number;
}

export interface ProviderTestResult {
  ok: boolean;
  providerId: ProviderId;
  symbol: string;
  latencyMs: number;
  error?: string;
  sample?: {
    mid?: number;
    bid?: number;
    ask?: number;
    timestamp?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// JOB ADMIN DTOs
// ═══════════════════════════════════════════════════════════════

export type JobId = 
  | 'exchangeTick'
  | 'whaleIngest'
  | 'indicatorCalculation'
  | 'regimeDetection'
  | 'patternDetection'
  | 'observationPersist';

export type JobStatus = 'RUNNING' | 'STOPPED' | 'ERROR' | 'IDLE';

export interface JobConfig {
  scheduleMs: number;
  trackedSymbols: string[];
  enabled: boolean;
  [key: string]: any;
}

export interface JobAdminDTO {
  id: JobId;
  displayName: string;
  enabled: boolean;
  running: boolean;
  status: JobStatus;
  scheduleMs: number;
  lastRunAt: number | null;
  lastRunStatus: 'OK' | 'ERROR' | null;
  lastError: string | null;
  config: JobConfig;
}

export interface JobPatchConfigDTO {
  scheduleMs?: number;
  trackedSymbols?: string[];
  enabled?: boolean;
  [key: string]: any;
}

export interface JobRunResult {
  ok: boolean;
  jobId: JobId;
  executionMs: number;
  error?: string;
  result?: any;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH OVERVIEW DTOs
// ═══════════════════════════════════════════════════════════════

export interface ExchangeHealthOverview {
  providers: {
    total: number;
    enabled: number;
    up: number;
    degraded: number;
    down: number;
  };
  jobs: {
    total: number;
    running: number;
    stopped: number;
    error: number;
  };
  dataStatus: {
    lastSnapshot: number | null;
    activeSymbols: number;
    mode: 'LIVE' | 'MOCK' | 'MIXED';
  };
  alerts: ExchangeAlert[];
}

export interface ExchangeAlert {
  level: 'INFO' | 'WARN' | 'ERROR';
  code: string;
  message: string;
  timestamp: number;
}

console.log('[Y1] Exchange Admin Types loaded');
