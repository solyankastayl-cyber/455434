/**
 * P4: Composite Lifecycle Routes
 * 
 * API endpoints for cross-asset composite lifecycle management.
 * 
 * Endpoints:
 * - POST /api/cross-asset/admin/lifecycle/promote - Create composite version
 * - POST /api/cross-asset/admin/lifecycle/rollback - Rollback to previous version
 * - GET /api/cross-asset/admin/lifecycle/status - Get lifecycle status
 * - GET /api/cross-asset/admin/audit/invariants - Audit composite invariants
 * - GET /api/cross-asset/snapshot - Get composite snapshot
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { CompositeStore } from '../store/composite.store.js';
import { promoteComposite, auditCompositeInvariants } from '../services/composite.promote.service.js';
import { DEFAULT_BLEND_CONFIG, type BlendConfig } from '../contracts/composite.contract.js';

interface PromoteBody {
  horizonDays?: number;
  blendConfig?: Partial<BlendConfig>;
  reason?: string;
}

interface StatusQuery {
  horizonDays?: string;
}

interface SnapshotQuery {
  horizonDays?: string;
  versionId?: string;
}

export async function compositeLifecycleRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/cross-asset/admin/lifecycle/promote
   * 
   * Create new composite version from current parent versions
   */
  fastify.post('/api/cross-asset/admin/lifecycle/promote', async (
    request: FastifyRequest<{ Body: PromoteBody; Querystring: { horizonDays?: string } }>
  ) => {
    const body = request.body || {};
    const horizonDays = body.horizonDays || parseInt(request.query.horizonDays || '90', 10);
    
    try {
      const result = await promoteComposite(horizonDays, body.blendConfig, 'admin');
      
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      
      return {
        ok: true,
        versionId: result.versionId,
        parentVersions: result.parentVersions,
        configHash: result.configHash,
        horizonDays,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/cross-asset/admin/lifecycle/rollback
   * 
   * Rollback to previous composite version
   */
  fastify.post('/api/cross-asset/admin/lifecycle/rollback', async (
    request: FastifyRequest<{ Body: { targetVersionId?: string; reason?: string } }>
  ) => {
    const body = request.body || {};
    
    try {
      // Get recent events to find previous version
      const events = await CompositeStore.getRecentEvents(10);
      const promoteEvents = events.filter((e) => e.type === 'PROMOTE');
      
      if (promoteEvents.length < 2 && !body.targetVersionId) {
        return { ok: false, error: 'No previous version to rollback to' };
      }
      
      const targetVersion = body.targetVersionId || promoteEvents[1]?.version;
      
      if (!targetVersion) {
        return { ok: false, error: 'Could not determine rollback target' };
      }
      
      // Find the target snapshot to get its config
      const targetSnapshot = await CompositeStore.getSnapshot(targetVersion, 90);
      
      if (!targetSnapshot) {
        return { ok: false, error: `Target version ${targetVersion} not found` };
      }
      
      // Update lifecycle state to point to old version
      await CompositeStore.updateState({
        activeVersion: targetVersion,
        activeConfigHash: targetSnapshot.blendConfig 
          ? JSON.stringify(targetSnapshot.blendConfig).slice(0, 16)
          : 'unknown',
        promotedAt: new Date(),
        promotedBy: 'admin:rollback',
        status: 'ACTIVE',
      });
      
      // Record rollback event
      await CompositeStore.addEvent({
        asset: 'CROSS_ASSET',
        version: targetVersion,
        type: 'ROLLBACK',
        parentVersions: targetSnapshot.parentVersions,
        blendConfig: targetSnapshot.blendConfig,
        createdAt: new Date(),
        createdBy: 'admin',
        reason: body.reason || 'Manual rollback',
      });
      
      return {
        ok: true,
        rolledBackTo: targetVersion,
        parentVersions: targetSnapshot.parentVersions,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/lifecycle/status
   * 
   * Get composite lifecycle status
   */
  fastify.get('/api/cross-asset/admin/lifecycle/status', async (
    request: FastifyRequest<{ Querystring: StatusQuery }>
  ) => {
    try {
      const state = await CompositeStore.getState();
      const events = await CompositeStore.getRecentEvents(5);
      const outcomeStats = await CompositeStore.getOutcomeStats(state?.activeVersion);
      
      const horizonDays = parseInt(request.query.horizonDays || '90', 10);
      const latestSnapshot = state?.activeVersion 
        ? await CompositeStore.getSnapshot(state.activeVersion, horizonDays)
        : null;
      
      return {
        ok: true,
        state: state || { asset: 'CROSS_ASSET', status: 'NOT_INITIALIZED' },
        latestSnapshot: latestSnapshot ? {
          versionId: latestSnapshot.versionId,
          horizonDays: latestSnapshot.horizonDays,
          parentVersions: latestSnapshot.parentVersions,
          computedWeights: latestSnapshot.computedWeights,
          expectedReturn: latestSnapshot.expectedReturn,
          confidence: latestSnapshot.confidence,
          stance: latestSnapshot.stance,
          createdAt: latestSnapshot.createdAt,
        } : null,
        recentEvents: events,
        outcomeStats,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/audit/invariants
   * 
   * Audit composite invariants for a version
   */
  fastify.get('/api/cross-asset/admin/audit/invariants', async (
    request: FastifyRequest<{ Querystring: { versionId?: string; horizonDays?: string } }>
  ) => {
    try {
      const result = await auditCompositeInvariants(request.query.versionId);
      return { ok: result.ok, audit: result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/snapshot
   * 
   * Get composite snapshot (public endpoint)
   */
  fastify.get('/api/cross-asset/snapshot', async (
    request: FastifyRequest<{ Querystring: SnapshotQuery }>
  ) => {
    const horizonDays = parseInt(request.query.horizonDays || '90', 10);
    const versionId = request.query.versionId;
    
    try {
      let snapshot;
      
      if (versionId) {
        snapshot = await CompositeStore.getSnapshot(versionId, horizonDays);
      } else {
        // Get active version
        const state = await CompositeStore.getState();
        if (state?.activeVersion) {
          snapshot = await CompositeStore.getSnapshot(state.activeVersion, horizonDays);
        }
      }
      
      if (!snapshot) {
        return { ok: false, error: 'No composite snapshot found' };
      }
      
      return {
        ok: true,
        asset: 'CROSS_ASSET',
        versionId: snapshot.versionId,
        horizonDays: snapshot.horizonDays,
        parentVersions: snapshot.parentVersions,
        weights: snapshot.computedWeights,
        forecast: {
          anchorPrice: snapshot.anchorPrice,
          path: snapshot.forecastPath,
          upperBand: snapshot.upperBand,
          lowerBand: snapshot.lowerBand,
          expectedReturn: snapshot.expectedReturn,
        },
        stance: snapshot.stance,
        confidence: snapshot.confidence,
        createdAt: snapshot.createdAt,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/config
   * 
   * Get default blend configuration
   */
  fastify.get('/api/cross-asset/config', async () => {
    return {
      ok: true,
      defaultConfig: DEFAULT_BLEND_CONFIG,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // P5-A: RESOLVE ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/cross-asset/admin/lifecycle/resolve
   * 
   * Resolve all mature composite snapshots
   */
  fastify.post('/api/cross-asset/admin/lifecycle/resolve', async () => {
    try {
      const { resolveAllMatureComposites } = await import('../services/composite.resolve.service.js');
      const result = await resolveAllMatureComposites();
      return {
        ok: result.ok,
        resolved: result.resolved,
        skipped: result.skipped,
        errors: result.errors,
        outcomes: result.outcomes.map(o => ({
          versionId: o.versionId,
          horizonDays: o.horizonDays,
          directionHit: o.directionHit,
          errorPct: o.errorPct,
          realizedReturnPct: o.realizedReturnPct,
          predictedReturnPct: o.predictedReturnPct,
        })),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/cross-asset/admin/lifecycle/force-resolve
   * 
   * Force resolve a specific snapshot (for testing)
   */
  fastify.post('/api/cross-asset/admin/lifecycle/force-resolve', async (
    request: FastifyRequest<{ Body: { versionId: string; horizonDays: number } }>
  ) => {
    const body = request.body || {};
    if (!body.versionId || !body.horizonDays) {
      return { ok: false, error: 'versionId and horizonDays required' };
    }
    
    try {
      const { forceResolveSnapshot } = await import('../services/composite.resolve.service.js');
      const result = await forceResolveSnapshot(body.versionId, body.horizonDays);
      return {
        ok: result.ok,
        error: result.error,
        outcome: result.outcome ? {
          directionHit: result.outcome.directionHit,
          errorPct: result.outcome.errorPct,
          realizedReturnPct: result.outcome.realizedReturnPct,
          predictedReturnPct: result.outcome.predictedReturnPct,
          components: result.outcome.components,
        } : null,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // P5-B: DRIFT ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/cross-asset/admin/drift
   * 
   * Get overall composite drift metrics
   */
  fastify.get('/api/cross-asset/admin/drift', async () => {
    try {
      const drift = await import('../services/composite.drift.service.js');
      const metrics = await drift.getCompositeDrift();
      return { ok: true, metrics };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/drift/by-version
   * 
   * Get drift metrics per version
   */
  fastify.get('/api/cross-asset/admin/drift/by-version', async () => {
    try {
      const drift = await import('../services/composite.drift.service.js');
      const versions = await drift.getDriftByVersion();
      return { ok: true, versions };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/drift/by-horizon
   * 
   * Get drift metrics per horizon
   */
  fastify.get('/api/cross-asset/admin/drift/by-horizon', async () => {
    try {
      const drift = await import('../services/composite.drift.service.js');
      const horizons = await drift.getDriftByHorizon();
      return { ok: true, horizons };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/drift/attribution
   * 
   * Get component attribution (BTC/SPX/DXY contributions)
   */
  fastify.get('/api/cross-asset/admin/drift/attribution', async () => {
    try {
      const drift = await import('../services/composite.drift.service.js');
      const attribution = await drift.getComponentAttribution();
      return { ok: true, attribution };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/drift/weights
   * 
   * Get weights diagnostics
   */
  fastify.get('/api/cross-asset/admin/drift/weights', async () => {
    try {
      const drift = await import('../services/composite.drift.service.js');
      const diagnostics = await drift.getWeightsDiagnostics();
      return { ok: true, diagnostics };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/drift/worst
   * 
   * Get worst performing snapshots
   */
  fastify.get('/api/cross-asset/admin/drift/worst', async (
    request: FastifyRequest<{ Querystring: { limit?: string } }>
  ) => {
    try {
      const drift = await import('../services/composite.drift.service.js');
      const limit = parseInt(request.query.limit || '10', 10);
      const snapshots = await drift.getWorstSnapshots(limit);
      return { 
        ok: true, 
        snapshots: snapshots.map(s => ({
          versionId: s.versionId,
          horizonDays: s.horizonDays,
          errorPct: s.errorPct,
          absErrorPct: s.absErrorPct,
          directionHit: s.directionHit,
          asOf: s.asOf,
          maturityAt: s.maturityAt,
        }))
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/cross-asset/admin/drift/best
   * 
   * Get best performing snapshots
   */
  fastify.get('/api/cross-asset/admin/drift/best', async (
    request: FastifyRequest<{ Querystring: { limit?: string } }>
  ) => {
    try {
      const drift = await import('../services/composite.drift.service.js');
      const limit = parseInt(request.query.limit || '10', 10);
      const snapshots = await drift.getBestSnapshots(limit);
      return { 
        ok: true, 
        snapshots: snapshots.map(s => ({
          versionId: s.versionId,
          horizonDays: s.horizonDays,
          errorPct: s.errorPct,
          absErrorPct: s.absErrorPct,
          realizedReturnPct: s.realizedReturnPct,
          asOf: s.asOf,
          maturityAt: s.maturityAt,
        }))
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  console.log('[CrossAsset] Lifecycle routes registered at /api/cross-asset/*');
}

export default compositeLifecycleRoutes;
