/**
 * Twitter Parser Module — Status Routes
 * 
 * Aggregated status for user dashboard.
 * Based on: v4.2-final
 */

import type { StatusResponse, ApiResponse } from '../types.js';

/**
 * Route handler types (framework-agnostic)
 */
export interface StatusRouteHandlers {
  /**
   * GET /twitter/status
   * 
   * Get aggregated parsing status
   */
  get: (req: {
    headers: Record<string, string | undefined>;
    userId: string;
  }) => Promise<ApiResponse<StatusResponse>>;
}

/**
 * Build status response from components
 */
export function buildStatusResponse(data: {
  parserStatus: 'UP' | 'DOWN' | 'DEGRADED';
  sessionStatus?: 'OK' | 'STALE' | 'EXPIRED';
  riskScore?: number;
  lastParse?: { at: Date; fetched: number; target: string };
  nextParse?: { at: Date; target: string };
  qualityStatus: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
  qualityScore: number;
}): StatusResponse {
  return {
    parser: {
      status: data.parserStatus,
      lastCheck: new Date().toISOString(),
    },
    session: {
      status: data.sessionStatus || 'NONE',
      riskScore: data.riskScore,
    },
    lastParse: data.lastParse ? {
      at: data.lastParse.at.toISOString(),
      fetched: data.lastParse.fetched,
      target: data.lastParse.target,
    } : undefined,
    nextParse: data.nextParse ? {
      at: data.nextParse.at.toISOString(),
      target: data.nextParse.target,
    } : undefined,
    quality: {
      status: data.qualityStatus,
      score: data.qualityScore,
    },
  };
}
