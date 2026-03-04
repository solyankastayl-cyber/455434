/**
 * Twitter Parser Module — Admin Tasks Routes
 * 
 * Task management for operators.
 * Based on: v4.2-final
 */

import type { TaskAdminResponse, ApiResponse } from '../types.js';

/**
 * Route handler types (framework-agnostic)
 */
export interface TasksAdminHandlers {
  /**
   * GET /admin/twitter/tasks
   * 
   * List tasks with filters
   */
  list: (req: {
    query: { status?: string; scope?: string; limit?: string };
  }) => Promise<ApiResponse<TaskAdminResponse[]>>;
  
  /**
   * GET /admin/twitter/tasks/:id
   * 
   * Get task details
   */
  get: (req: {
    params: { id: string };
  }) => Promise<ApiResponse<TaskAdminResponse>>;
  
  /**
   * POST /admin/twitter/tasks/:id/retry
   * 
   * Retry failed task
   */
  retry: (req: {
    params: { id: string };
  }) => Promise<ApiResponse<{ newTaskId: string }>>;
  
  /**
   * POST /admin/twitter/tasks/:id/abort
   * 
   * Abort running task
   */
  abort: (req: {
    params: { id: string };
  }) => Promise<ApiResponse<{ aborted: boolean }>>;
}

/**
 * Map storage task to admin response
 */
export function mapTaskToAdminResponse(task: any): TaskAdminResponse {
  return {
    id: task._id?.toString() || task.id,
    type: task.type,
    status: task.status,
    scope: task.scope || task.ownerType || 'SYSTEM',
    targetId: task.payload?.targetId,
    attempts: task.attempts ?? 0,
    maxAttempts: task.maxAttempts ?? 3,
    priority: task.priority || 'NORMAL',
    result: task.result,
    lastError: task.lastError,
    createdAt: task.createdAt?.toISOString() || new Date().toISOString(),
    startedAt: task.startedAt?.toISOString(),
    completedAt: task.completedAt?.toISOString(),
  };
}

/**
 * Filter tasks by query params
 */
export function buildTaskFilter(query: { status?: string; scope?: string }): Record<string, any> {
  const filter: Record<string, any> = {};
  
  if (query.status) {
    filter.status = query.status;
  }
  
  if (query.scope) {
    filter.scope = query.scope;
  }
  
  return filter;
}

/**
 * Get default limit for task queries
 */
export function getTaskLimit(limitStr?: string): number {
  const limit = parseInt(limitStr || '50', 10);
  return Math.min(Math.max(1, limit), 200);
}
