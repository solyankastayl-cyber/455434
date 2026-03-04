/**
 * Twitter Parser Module — Admin Health Routes
 * 
 * System health monitoring.
 * Based on: v4.2-final
 */

import type { HealthResponse, ApiResponse } from '../types.js';

/**
 * Route handler types (framework-agnostic)
 */
export interface HealthAdminHandlers {
  /**
   * GET /admin/twitter/health
   * 
   * Get system health overview
   */
  get: () => Promise<ApiResponse<HealthResponse>>;
}

/**
 * Build health response from components
 */
export function buildHealthResponse(data: {
  parserStatus: 'UP' | 'DOWN' | 'DEGRADED';
  workerStatus: 'ONLINE' | 'OFFLINE' | 'BUSY';
  queueSize: number;
  abortRate1h: number;
  abortRate24h: number;
}): HealthResponse {
  return {
    parser: data.parserStatus,
    worker: data.workerStatus,
    queueSize: data.queueSize,
    abortRate1h: data.abortRate1h,
    abortRate24h: data.abortRate24h,
  };
}

/**
 * Determine parser status from health check
 */
export function determineParserStatus(isAlive: boolean, responseTimeMs?: number): 'UP' | 'DOWN' | 'DEGRADED' {
  if (!isAlive) return 'DOWN';
  if (responseTimeMs && responseTimeMs > 5000) return 'DEGRADED';
  return 'UP';
}

/**
 * Determine worker status from queue stats
 */
export function determineWorkerStatus(running: number, maxConcurrent: number): 'ONLINE' | 'OFFLINE' | 'BUSY' {
  if (running >= maxConcurrent) return 'BUSY';
  return 'ONLINE';
}
