/**
 * P1-A + P2: Lifecycle Routes
 * 
 * API endpoints for model lifecycle management.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { promoteModel, resolveSnapshots, getLifecycleStatus, rollbackModel, forceResolveSnapshots } from './lifecycle.service.js';
import { LifecycleStore } from './lifecycle.store.js';
import { AssetKey } from './lifecycle.contract.js';
import { HealthStore } from '../../health/model_health.service.js';

interface AssetQuery {
  asset?: string;
  force?: string;
}

interface PromoteBody {
  asset?: string;
  user?: string;
  note?: string;
}

interface RollbackBody {
  asset?: string;
  toVersion?: string;
  steps?: number;
  user?: string;
  note?: string;
  force?: boolean;  // Allow rollback even if not CRITICAL
}

export async function lifecycleAdminRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/lifecycle/status
   * 
   * Get full lifecycle status for asset
   */
  fastify.get('/api/fractal/v2.1/admin/lifecycle/status', async (
    request: FastifyRequest<{ Querystring: AssetQuery }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    
    try {
      const status = await getLifecycleStatus(asset);
      return {
        ok: true,
        asset,
        ...status,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/lifecycle/promote
   * 
   * Promote current model config to new version
   * Creates snapshots for tracking
   */
  fastify.post('/api/fractal/v2.1/admin/lifecycle/promote', async (
    request: FastifyRequest<{ Body: PromoteBody }>
  ) => {
    const body = request.body || {};
    const asset = (body.asset ?? 'BTC') as AssetKey;
    const user = body.user ?? 'admin';
    
    try {
      const result = await promoteModel(asset, user);
      return result;
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/lifecycle/resolve
   * 
   * P2: Resolve matured snapshots and create outcomes
   * Use force=1 query param for testing (resolves regardless of time)
   */
  fastify.post('/api/fractal/v2.1/admin/lifecycle/resolve', async (
    request: FastifyRequest<{ Querystring: AssetQuery }>
  ) => {
    const asset = request.query.asset as AssetKey | undefined;
    const force = request.query.force === '1' || request.query.force === 'true';
    
    try {
      const result = force ? 
        await forceResolveSnapshots(asset) : 
        await resolveSnapshots(asset);
      return {
        ok: true,
        forced: force,
        ...result,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/lifecycle/rollback
   * 
   * P2.5: Rollback to previous version
   * Does NOT delete data - only changes activeVersion and restores config
   * 
   * GUARD: Only allowed when health.grade === 'CRITICAL' (unless force=true)
   */
  fastify.post('/api/fractal/v2.1/admin/lifecycle/rollback', async (
    request: FastifyRequest<{ Body: RollbackBody }>
  ) => {
    const body = request.body || {};
    const asset = (body.asset ?? 'BTC') as AssetKey;
    const toVersion = body.toVersion;
    const steps = body.steps;
    const user = body.user ?? 'admin';
    const force = body.force ?? false;
    
    try {
      // GUARD: Check health grade (rollback only if CRITICAL or force)
      const healthState = await HealthStore.getState(asset as any);
      const grade = healthState?.grade ?? 'UNKNOWN';
      
      if (grade !== 'CRITICAL' && !force) {
        return {
          ok: false,
          error: `Rollback only allowed when health grade is CRITICAL. Current grade: ${grade}. Use force=true to override.`,
          grade,
          suggestion: 'Set force=true if you need to rollback anyway (audit logged)',
        };
      }
      
      // Log if force was used on non-CRITICAL
      if (force && grade !== 'CRITICAL') {
        console.log(`[Lifecycle] WARNING: Force rollback on ${asset} with grade ${grade} by ${user}`);
      }
      
      const result = await rollbackModel(asset, toVersion, steps, user);
      
      if (result.ok) {
        return {
          ...result,
          ts: new Date().toISOString(),
          forced: force && grade !== 'CRITICAL',
        };
      }
      
      return result;
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/lifecycle/rollback-info
   * 
   * Get info about available rollback (previous version)
   * Used by UI to show rollback button
   */
  fastify.get('/api/fractal/v2.1/admin/lifecycle/rollback-info', async (
    request: FastifyRequest<{ Querystring: AssetQuery }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    
    try {
      // Get current state
      const state = await LifecycleStore.getState(asset);
      if (!state?.activeVersion) {
        return { ok: true, canRollback: false, reason: 'No active version' };
      }
      
      // Get health grade
      const healthState = await HealthStore.getState(asset as any);
      const grade = healthState?.grade ?? 'UNKNOWN';
      
      // Get previous version
      const events = await LifecycleStore.getEvents(asset, 100);
      const promoteEvents = events.filter(e => e.type === 'PROMOTE');
      
      if (promoteEvents.length < 2) {
        return { 
          ok: true, 
          canRollback: false, 
          reason: 'No previous version available',
          currentVersion: state.activeVersion,
          grade,
        };
      }
      
      const currentIdx = promoteEvents.findIndex(e => e.version === state.activeVersion);
      const previousEvent = promoteEvents[currentIdx + 1];
      
      if (!previousEvent) {
        return { 
          ok: true, 
          canRollback: false, 
          reason: 'No previous version found',
          currentVersion: state.activeVersion,
          grade,
        };
      }
      
      return {
        ok: true,
        canRollback: true,
        rollbackAllowed: grade === 'CRITICAL',
        currentVersion: state.activeVersion,
        previousVersion: previousEvent.version,
        previousPromotedAt: previousEvent.createdAt,
        grade,
        message: grade === 'CRITICAL' 
          ? 'Rollback available (CRITICAL grade)' 
          : 'Rollback requires force=true (grade is not CRITICAL)',
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/lifecycle/events
   * 
   * Get lifecycle events history
   */
  fastify.get('/api/fractal/v2.1/admin/lifecycle/events', async (
    request: FastifyRequest<{ Querystring: AssetQuery & { limit?: string } }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    const limit = parseInt(request.query.limit ?? '50', 10);
    
    try {
      const events = await LifecycleStore.getEvents(asset, limit);
      return {
        ok: true,
        asset,
        count: events.length,
        events,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/lifecycle/snapshots
   * 
   * Get snapshots for current version
   */
  fastify.get('/api/fractal/v2.1/admin/lifecycle/snapshots', async (
    request: FastifyRequest<{ Querystring: AssetQuery }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    
    try {
      const state = await LifecycleStore.getState(asset);
      if (!state?.activeVersion) {
        return { ok: true, snapshots: [], message: 'No active version' };
      }
      
      const snapshots = await LifecycleStore.getSnapshotsByVersion(asset, state.activeVersion);
      return {
        ok: true,
        asset,
        version: state.activeVersion,
        count: snapshots.length,
        snapshots,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/lifecycle/outcomes
   * 
   * P2: Get decision outcomes with stats
   */
  fastify.get('/api/fractal/v2.1/admin/lifecycle/outcomes', async (
    request: FastifyRequest<{ Querystring: AssetQuery & { limit?: string } }>
  ) => {
    const asset = (request.query.asset ?? 'BTC') as AssetKey;
    const limit = parseInt(request.query.limit ?? '100', 10);
    
    try {
      const outcomes = await LifecycleStore.getOutcomes(asset, limit);
      const stats = await LifecycleStore.getOutcomeStats(asset);
      
      return {
        ok: true,
        asset,
        stats,
        count: outcomes.length,
        outcomes,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/lifecycle/all-states
   * 
   * Get lifecycle states for all assets
   */
  fastify.get('/api/fractal/v2.1/admin/lifecycle/all-states', async () => {
    try {
      const states = await LifecycleStore.getAllStates();
      return {
        ok: true,
        count: states.length,
        states,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  console.log('[Fractal] P1-A + P2: Lifecycle Admin routes registered');
  console.log('[Fractal]   - POST /api/fractal/v2.1/admin/lifecycle/promote');
  console.log('[Fractal]   - POST /api/fractal/v2.1/admin/lifecycle/resolve');
  console.log('[Fractal]   - POST /api/fractal/v2.1/admin/lifecycle/rollback (CRITICAL guard)');
  console.log('[Fractal]   - GET  /api/fractal/v2.1/admin/lifecycle/rollback-info');
  console.log('[Fractal]   - GET  /api/fractal/v2.1/admin/lifecycle/status');
}

export default lifecycleAdminRoutes;
