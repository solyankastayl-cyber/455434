/**
 * Admin Jobs Service
 * 
 * Service layer for running admin jobs.
 * Used by the FractalModule public API.
 * 
 * @version v2.0-fractal-stable
 */

import { runResolveJob } from './resolve_matured_snapshots.job.js';
import { computeAllHealth } from '../health/model_health.service.js';

export interface AdminJobResult {
  success: boolean;
  processed?: number;
  resolved?: number;
  errors?: number;
  message?: string;
  details?: any;
}

/**
 * Run an admin job by name
 */
export async function runAdminJob(jobName: string): Promise<AdminJobResult> {
  switch (jobName) {
    case 'resolve_matured':
    case 'resolve': {
      const result = await runResolveJob();
      return {
        success: result.ok,
        resolved: result.totalResolved || 0,
        processed: result.totalProcessed || 0,
        message: result.ok ? 'Resolve job completed' : 'Resolve job failed'
      };
    }
    
    case 'health_check':
    case 'health': {
      const results = await computeAllHealth();
      return {
        success: true,
        processed: results.length,
        message: 'Health check completed',
        details: results.map(r => ({
          scope: r.scope,
          grade: r.state.grade,
          gradeChanged: r.gradeChanged
        }))
      };
    }
    
    case 'full': {
      // Run resolve then health check
      const resolveResult = await runResolveJob();
      const healthResults = await computeAllHealth();
      
      return {
        success: resolveResult.ok,
        resolved: resolveResult.totalResolved || 0,
        processed: healthResults.length,
        message: 'Full job completed (resolve + health)',
        details: {
          resolve: {
            totalResolved: resolveResult.totalResolved,
            durationMs: resolveResult.durationMs
          },
          health: healthResults.map(r => ({
            scope: r.scope,
            grade: r.state.grade
          }))
        }
      };
    }
    
    default:
      return {
        success: false,
        message: `Unknown job: ${jobName}. Allowed: resolve_matured, health, full`
      };
  }
}
