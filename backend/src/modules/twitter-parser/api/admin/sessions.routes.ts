/**
 * Twitter Parser Module — Admin Sessions Routes
 * 
 * Session management for operators.
 * Based on: v4.2-final
 */

import type { SessionAdminResponse, ApiResponse } from '../types.js';

/**
 * Route handler types (framework-agnostic)
 */
export interface SessionsAdminHandlers {
  /**
   * GET /admin/twitter/sessions
   * 
   * List all sessions
   */
  list: (req: {
    query: { status?: string; userId?: string };
  }) => Promise<ApiResponse<SessionAdminResponse[]>>;
  
  /**
   * GET /admin/twitter/sessions/:id
   * 
   * Get session details
   */
  get: (req: {
    params: { id: string };
  }) => Promise<ApiResponse<SessionAdminResponse>>;
  
  /**
   * POST /admin/twitter/sessions/:id/resync
   * 
   * Mark session for resync (set status to STALE)
   */
  resync: (req: {
    params: { id: string };
  }) => Promise<ApiResponse<{ marked: boolean }>>;
  
  /**
   * POST /admin/twitter/sessions/:id/disable
   * 
   * Disable session
   */
  disable: (req: {
    params: { id: string };
  }) => Promise<ApiResponse<{ disabled: boolean }>>;
}

/**
 * Map storage session to admin response
 */
export function mapSessionToAdminResponse(session: any, account?: any): SessionAdminResponse {
  return {
    id: session._id?.toString() || session.id,
    userId: session.ownerUserId?.toString() || session.ownerUserId,
    accountId: session.accountId?.toString() || session.accountId,
    username: account?.username,
    status: session.status,
    riskScore: session.riskScore ?? 0,
    version: session.version ?? 1,
    isActive: session.isActive ?? true,
    lastSyncAt: session.lastSyncAt?.toISOString(),
    updatedAt: session.updatedAt?.toISOString() || new Date().toISOString(),
  };
}

/**
 * Filter sessions by query params
 */
export function buildSessionFilter(query: { status?: string; userId?: string }): Record<string, any> {
  const filter: Record<string, any> = { isActive: true };
  
  if (query.status) {
    filter.status = query.status;
  }
  
  if (query.userId) {
    filter.ownerUserId = query.userId;
  }
  
  return filter;
}
