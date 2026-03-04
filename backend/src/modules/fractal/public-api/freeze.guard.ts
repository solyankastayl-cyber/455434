/**
 * FRACTAL MODULE — Freeze Guard
 * 
 * Exports freeze guard functionality for use by the core system.
 * The core can use this to enforce freeze restrictions at the router level.
 * 
 * @version v2.0-fractal-stable
 */

import type { FreezeGuard, FreezeManifest } from './types.js';
import freezeManifestJson from '../../../../freeze/freeze-manifest.json' assert { type: 'json' };

// ═══════════════════════════════════════════════════════════════
// BLOCKED PATTERNS
// ═══════════════════════════════════════════════════════════════

const BLOCKED_PATTERNS = [
  // Lifecycle mutations
  '/api/lifecycle/promote',
  '/api/lifecycle/rollback',
  '/api/*/lifecycle/promote',
  '/api/*/lifecycle/rollback',
  '/api/fractal/v2.1/admin/lifecycle/promote',
  '/api/fractal/v2.1/admin/lifecycle/rollback',
  '/api/fractal/v2.1/admin/lifecycle/initialize',
  '/api/fractal/v2.1/admin/lifecycle/init',
  
  // Config mutations
  '/api/*/model-config',
  '/api/fractal/v2.1/admin/model-config',
  '/api/admin/model-config',
  
  // Seed operations
  '/api/admin/jobs/run?job=seed',
  '/api/fractal/v2.1/admin/seed',
  
  // Dev controls
  '/api/*/lifecycle/dev',
  '/api/fractal/v2.1/admin/lifecycle/drift',
  '/api/fractal/v2.1/admin/lifecycle/samples',
  '/api/fractal/v2.1/admin/lifecycle/constitution',
  '/api/fractal/v2.1/admin/lifecycle/integrity',
  
  // Initialize states
  '/api/lifecycle/init',
  '/api/*/lifecycle/init',
];

const ALLOWED_JOBS = ['full', 'resolve_matured', 'health', 'health_check'];

// ═══════════════════════════════════════════════════════════════
// FREEZE STATE
// ═══════════════════════════════════════════════════════════════

let frozenState = process.env.SYSTEM_FROZEN === 'true' || process.env.FREEZE_MODE === 'true';

/**
 * Check if system is frozen
 */
export function isFrozen(): boolean {
  return frozenState;
}

/**
 * Set frozen state (for testing or dynamic control)
 */
export function setFrozen(frozen: boolean): void {
  frozenState = frozen;
}

// ═══════════════════════════════════════════════════════════════
// ROUTE BLOCKING
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a route is blocked in frozen state
 */
export function isBlockedRoute(url: string, method: string): boolean {
  // Only mutation methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return false;
  }
  
  // Special check for jobs — first, before pattern check
  if (url.includes('/api/admin/jobs/run')) {
    const jobMatch = url.match(/job=([^&]+)/);
    if (jobMatch) {
      const jobName = jobMatch[1];
      // Allow safe jobs
      if (ALLOWED_JOBS.includes(jobName)) {
        return false;
      }
      // Block seed and other dangerous jobs
      if (jobName.startsWith('seed') || jobName === 'backfill' || jobName === 'reset') {
        return true;
      }
      // Block unknown jobs
      return true;
    }
  }
  
  // Check patterns
  const normalizedUrl = url.split('?')[0];
  
  for (const pattern of BLOCKED_PATTERNS) {
    const patternBase = pattern.split('?')[0];
    
    // Simple comparison with wildcard
    if (patternBase.includes('*')) {
      const regex = new RegExp('^' + patternBase.replace(/\*/g, '[^/]+') + '$');
      if (regex.test(normalizedUrl)) {
        return true;
      }
    } else if (normalizedUrl === patternBase || normalizedUrl.startsWith(patternBase)) {
      return true;
    }
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════
// FREEZE GUARD EXPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Freeze guard for use by core system
 */
export const freezeGuard: FreezeGuard = {
  isFrozen,
  isBlocked: isBlockedRoute,
  getManifest: () => freezeManifestJson as FreezeManifest,
  getAllowedJobs: () => ALLOWED_JOBS,
  getBlockedPatterns: () => BLOCKED_PATTERNS
};

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE FACTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Create freeze middleware for Fastify
 * 
 * This can be used by the core system to add freeze protection
 * to its router. The middleware will block all mutation requests
 * when the system is frozen.
 * 
 * @example
 * ```typescript
 * import { createFreezeMiddleware } from '@modules/fractal';
 * 
 * app.addHook('preHandler', createFreezeMiddleware());
 * ```
 */
export function createFreezeMiddleware() {
  return async (request: any, reply: any) => {
    if (!isFrozen()) {
      return;
    }
    
    const url = request.url;
    const method = request.method;
    
    if (isBlockedRoute(url, method)) {
      console.log(`[FREEZE] Blocked: ${method} ${url}`);
      return reply.status(403).send({
        ok: false,
        error: 'SYSTEM_FROZEN',
        message: 'System is frozen. Mutation operations are blocked.',
        blockedRoute: url,
        hint: 'To unfreeze, set SYSTEM_FROZEN=false in .env'
      });
    }
  };
}
