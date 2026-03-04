/**
 * Twitter Parser Module — Targets Routes
 * 
 * Manage parsing targets (keywords, accounts).
 * Based on: v4.2-final
 * 
 * Uses: storage/ module
 */

import type { TargetRequest, TargetResponse, ApiResponse } from '../types.js';
import { extractApiKey, unauthorizedResponse } from '../middleware/api-key.guard.js';

/**
 * Route handler types (framework-agnostic)
 */
export interface TargetsRouteHandlers {
  /**
   * GET /twitter/targets
   * 
   * List user's parsing targets
   */
  list: (req: {
    headers: Record<string, string | undefined>;
    query: { type?: string; enabled?: string };
    userId: string;
  }) => Promise<ApiResponse<TargetResponse[]>>;
  
  /**
   * POST /twitter/targets
   * 
   * Create new parsing target
   */
  create: (req: {
    headers: Record<string, string | undefined>;
    body: TargetRequest;
    userId: string;
  }) => Promise<ApiResponse<TargetResponse>>;
  
  /**
   * PUT /twitter/targets/:id
   * 
   * Update existing target
   */
  update: (req: {
    headers: Record<string, string | undefined>;
    params: { id: string };
    body: Partial<TargetRequest>;
    userId: string;
  }) => Promise<ApiResponse<TargetResponse>>;
  
  /**
   * DELETE /twitter/targets/:id
   * 
   * Delete target
   */
  delete: (req: {
    headers: Record<string, string | undefined>;
    params: { id: string };
    userId: string;
  }) => Promise<ApiResponse<{ deleted: boolean }>>;
}

/**
 * Validate target request
 */
export function validateTargetRequest(body: TargetRequest): {
  valid: boolean;
  error?: string;
} {
  if (!body.type || !['KEYWORD', 'ACCOUNT'].includes(body.type)) {
    return { valid: false, error: 'Invalid target type' };
  }
  
  if (!body.query || body.query.length < 2) {
    return { valid: false, error: 'Query must be at least 2 characters' };
  }
  
  if (body.query.length > 100) {
    return { valid: false, error: 'Query must be at most 100 characters' };
  }
  
  if (body.priority !== undefined && (body.priority < 1 || body.priority > 5)) {
    return { valid: false, error: 'Priority must be between 1 and 5' };
  }
  
  if (body.maxPostsPerRun !== undefined && (body.maxPostsPerRun < 10 || body.maxPostsPerRun > 200)) {
    return { valid: false, error: 'maxPostsPerRun must be between 10 and 200' };
  }
  
  if (body.cooldownMin !== undefined && (body.cooldownMin < 5 || body.cooldownMin > 60)) {
    return { valid: false, error: 'cooldownMin must be between 5 and 60' };
  }
  
  return { valid: true };
}

/**
 * Map storage target to response
 */
export function mapTargetToResponse(target: any): TargetResponse {
  return {
    id: target._id?.toString() || target.id,
    type: target.type,
    query: target.query,
    enabled: target.enabled ?? true,
    priority: target.priority ?? 3,
    maxPostsPerRun: target.maxPostsPerRun ?? 50,
    cooldownMin: target.cooldownMin ?? 10,
    lastPlannedAt: target.lastPlannedAt?.toISOString(),
    stats: {
      totalRuns: target.stats?.totalRuns ?? 0,
      totalPostsFetched: target.stats?.totalPostsFetched ?? 0,
      lastRunAt: target.stats?.lastRunAt?.toISOString(),
    },
  };
}
