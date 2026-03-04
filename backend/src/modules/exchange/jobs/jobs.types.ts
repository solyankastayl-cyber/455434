/**
 * Y1 — Jobs Types
 * ================
 * 
 * Job registry types for Exchange ingestion jobs.
 */

export type JobId = 
  | 'exchangeTick'
  | 'whaleIngest'
  | 'indicatorCalculation'
  | 'regimeDetection'
  | 'patternDetection'
  | 'observationPersist';

export type JobStatus = 'RUNNING' | 'STOPPED' | 'ERROR' | 'IDLE';

export interface JobDefinition {
  id: JobId;
  displayName: string;
  description: string;
  defaultScheduleMs: number;
  defaultSymbols: string[];
  handler: (config: JobRuntimeConfig) => Promise<JobExecutionResult>;
}

export interface JobRuntimeConfig {
  scheduleMs: number;
  trackedSymbols: string[];
  enabled: boolean;
  [key: string]: any;
}

export interface JobState {
  id: JobId;
  enabled: boolean;
  running: boolean;
  status: JobStatus;
  config: JobRuntimeConfig;
  lastRunAt: number | null;
  lastRunStatus: 'OK' | 'ERROR' | null;
  lastError: string | null;
  intervalHandle: NodeJS.Timeout | null;
}

export interface JobExecutionResult {
  ok: boolean;
  executionMs: number;
  processedCount?: number;
  error?: string;
  details?: any;
}

console.log('[Y1] Jobs Types loaded');
