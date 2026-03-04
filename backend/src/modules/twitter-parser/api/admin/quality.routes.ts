/**
 * Twitter Parser Module — Admin Quality Routes
 * 
 * Parser quality monitoring.
 * Based on: v4.2-final
 */

import type { QualityResponse, ApiResponse } from '../types.js';

/**
 * Route handler types (framework-agnostic)
 */
export interface QualityAdminHandlers {
  /**
   * GET /admin/twitter/quality
   * 
   * Get parser quality overview
   */
  get: () => Promise<ApiResponse<QualityResponse>>;
}

/**
 * Build quality response from metrics
 */
export function buildQualityResponse(data: {
  totalTargets: number;
  healthyCount: number;
  degradedCount: number;
  unstableCount: number;
  avgScore: number;
  degradedTargets: Array<{
    targetId: string;
    status: string;
    emptyStreak: number;
    reason?: string;
  }>;
}): QualityResponse {
  const total = data.totalTargets || 1; // Avoid division by zero
  const healthRate = Math.round((data.healthyCount / total) * 100);
  
  return {
    summary: {
      total: data.totalTargets,
      healthy: data.healthyCount,
      degraded: data.degradedCount,
      unstable: data.unstableCount,
      avgScore: Math.round(data.avgScore),
      healthRate,
    },
    degradedTargets: data.degradedTargets,
  };
}

/**
 * Map quality metrics to degraded target info
 */
export function mapToDegradedTarget(metrics: any, target?: any): {
  targetId: string;
  status: string;
  emptyStreak: number;
  reason?: string;
} {
  return {
    targetId: metrics.targetId?.toString() || metrics.targetId,
    status: metrics.qualityStatus || 'DEGRADED',
    emptyStreak: metrics.emptyStreak || 0,
    reason: metrics.degradationReason,
  };
}
