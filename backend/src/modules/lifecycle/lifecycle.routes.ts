/**
 * UNIFIED LIFECYCLE ROUTES
 * 
 * BLOCK L1 + L2 + L3 — API endpoints for lifecycle management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { getUnifiedLifecycleService } from './lifecycle.service.js';
import { ModelId, LifecycleStatus, DriftSeverity } from './lifecycle.types.js';
import { 
  applyConstitutionHook, 
  handleDriftUpdateHook, 
  checkAutoPromotionHook,
  incrementLiveSamplesHook 
} from './lifecycle.hooks.js';
import { assertActionAllowed, enforceIntegrity } from './lifecycle.integrity.js';

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerLifecycleRoutes(app: FastifyInstance): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    console.error('[Lifecycle] MongoDB not connected');
    return;
  }
  
  const service = getUnifiedLifecycleService(db);
  
  await service.ensureIndexes();
  
  // ═══════════════════════════════════════════════════════════════
  // L3 ENDPOINTS — Constitution & Drift Hooks
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/lifecycle/constitution/apply — L3.1 Constitution Binding
  app.post<{
    Body: { asset: ModelId; hash: string };
  }>('/api/lifecycle/constitution/apply', async (req, reply) => {
    try {
      const { asset, hash } = req.body || {};
      if (!asset || !hash) {
        return reply.code(400).send({ ok: false, error: 'asset and hash required' });
      }
      
      const currentState = await service.getState(asset);
      if (!currentState) {
        return reply.code(404).send({ ok: false, error: `Model ${asset} not found` });
      }
      
      // Check if action allowed
      const guard = assertActionAllowed(currentState, 'CONSTITUTION_APPLY', 'ADMIN');
      if (!guard.allowed) {
        return reply.code(403).send({ ok: false, error: guard.error });
      }
      
      const result = await applyConstitutionHook(db, asset, hash, currentState);
      const newState = await service.getState(asset);
      
      return { ok: true, data: { ...result, state: newState } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/drift/update — L3.2 Drift Update with Auto-Revoke
  app.post<{
    Body: { asset: ModelId; severity: DriftSeverity; deltaHitRate?: number; deltaSharpe?: number };
  }>('/api/lifecycle/drift/update', async (req, reply) => {
    try {
      const { asset, severity, deltaHitRate, deltaSharpe } = req.body || {};
      if (!asset || !severity) {
        return reply.code(400).send({ ok: false, error: 'asset and severity required' });
      }
      
      const result = await handleDriftUpdateHook(db, asset, severity, { deltaHitRate, deltaSharpe });
      const newState = await service.getState(asset);
      
      return { ok: true, data: { ...result, state: newState } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/samples/increment — L3.5 Increment Live Samples
  app.post<{
    Body: { asset: ModelId; count?: number };
  }>('/api/lifecycle/samples/increment', async (req, reply) => {
    try {
      const { asset, count } = req.body || {};
      if (!asset) {
        return reply.code(400).send({ ok: false, error: 'asset required' });
      }
      
      const result = await incrementLiveSamplesHook(db, asset, count || 1);
      const newState = await service.getState(asset);
      
      return { ok: true, data: { ...result, state: newState } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/check-promotion — L3.5 Check Auto-Promotion
  app.post<{
    Body: { asset: ModelId };
  }>('/api/lifecycle/check-promotion', async (req, reply) => {
    try {
      const { asset } = req.body || {};
      if (!asset) {
        return reply.code(400).send({ ok: false, error: 'asset required' });
      }
      
      const result = await checkAutoPromotionHook(db, asset);
      const newState = await service.getState(asset);
      
      return { ok: true, data: { ...result, state: newState } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/integrity/check — L3.4 Integrity Check
  app.post<{
    Body: { asset: ModelId };
  }>('/api/lifecycle/integrity/check', async (req, reply) => {
    try {
      const { asset } = req.body || {};
      if (!asset) {
        return reply.code(400).send({ ok: false, error: 'asset required' });
      }
      
      const currentState = await service.getState(asset);
      if (!currentState) {
        return reply.code(404).send({ ok: false, error: `Model ${asset} not found` });
      }
      
      const integrityResult = enforceIntegrity(null, currentState);
      
      // If fixes needed, apply them
      if (!integrityResult.valid) {
        await service.updateState(asset, integrityResult.state);
        await service.addEvent(asset, 'STATE_AUTOFIX' as any, 'SYSTEM', { fixes: integrityResult.fixes });
      }
      
      const newState = await service.getState(asset);
      
      return { ok: true, data: { integrityResult, state: newState } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // L2 ENDPOINTS — Lifecycle Observability
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/lifecycle/state — Combined state for UI
  app.get('/api/lifecycle/state', async (req, reply) => {
    try {
      const states = await service.getAllStates();
      const combined = await service.getCombinedReadiness();
      
      // Ensure we have default states for BTC and SPX
      const btc = states.find(s => s.modelId === 'BTC');
      const spx = states.find(s => s.modelId === 'SPX');
      
      return { 
        ok: true, 
        data: {
          states,
          btc: btc || null,
          spx: spx || null,
          combined,
        }
      };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // GET /api/lifecycle/events — All events for timeline
  app.get<{
    Querystring: { asset?: string; limit?: string };
  }>('/api/lifecycle/events', async (req, reply) => {
    try {
      const { asset, limit: limitStr } = req.query;
      const limit = parseInt(limitStr || '100', 10);
      
      let events;
      if (asset && (asset === 'BTC' || asset === 'SPX' || asset === 'COMBINED')) {
        events = await service.getEvents(asset as ModelId, limit);
      } else {
        events = await service.getAllEvents(limit);
      }
      
      return { ok: true, data: events };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // GET /api/lifecycle/diagnostics — Diagnostics for a model
  app.get<{
    Querystring: { asset: string };
  }>('/api/lifecycle/diagnostics', async (req, reply) => {
    try {
      const { asset } = req.query;
      if (!asset || (asset !== 'BTC' && asset !== 'SPX')) {
        return reply.code(400).send({ ok: false, error: 'asset must be BTC or SPX' });
      }
      
      const diagnostics = await service.getDiagnostics(asset as ModelId);
      return { ok: true, data: diagnostics };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // L2 ACTIONS — Admin controls
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/lifecycle/actions/force-warmup
  app.post<{
    Body: { asset: ModelId; targetDays?: number };
  }>('/api/lifecycle/actions/force-warmup', async (req, reply) => {
    try {
      const { asset, targetDays } = req.body || {};
      if (!asset) {
        return reply.code(400).send({ ok: false, error: 'asset is required' });
      }
      
      const result = await service.forceWarmup(asset, targetDays || 30);
      return { ok: result.success, data: result.state, error: result.error };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/actions/force-apply
  app.post<{
    Body: { asset: ModelId; reason: string };
  }>('/api/lifecycle/actions/force-apply', async (req, reply) => {
    try {
      const { asset, reason } = req.body || {};
      if (!asset) {
        return reply.code(400).send({ ok: false, error: 'asset is required' });
      }
      
      const result = await service.forceApply(asset, reason || 'Admin force apply');
      return { ok: result.success, data: result.state, error: result.error };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/actions/revoke
  app.post<{
    Body: { asset: ModelId; reason: string };
  }>('/api/lifecycle/actions/revoke', async (req, reply) => {
    try {
      const { asset, reason } = req.body || {};
      if (!asset) {
        return reply.code(400).send({ ok: false, error: 'asset is required' });
      }
      
      const result = await service.revoke(asset, reason || 'Admin revoke');
      return { ok: result.success, data: result.state };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/actions/reset-simulation
  app.post<{
    Body: { asset: ModelId; reason: string };
  }>('/api/lifecycle/actions/reset-simulation', async (req, reply) => {
    try {
      const { asset, reason } = req.body || {};
      if (!asset) {
        return reply.code(400).send({ ok: false, error: 'asset is required' });
      }
      
      const result = await service.resetSimulation(asset, reason || 'Admin reset');
      return { ok: result.success, data: result.state, error: result.error };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/actions/dev-truth-mode — DEV only
  app.post('/api/lifecycle/actions/dev-truth-mode', async (req, reply) => {
    try {
      await service.enableDevTruthMode();
      return { ok: true, message: 'DEV truth mode enabled for all models' };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/init — Initialize default states for BTC/SPX
  app.post('/api/lifecycle/init', async (req, reply) => {
    try {
      const btcState = await service.updateState('BTC', {
        modelId: 'BTC',
        engineVersion: 'v2.1',
        systemMode: 'DEV',
        status: 'SIMULATION',
      });
      
      const spxState = await service.updateState('SPX', {
        modelId: 'SPX',
        engineVersion: 'v2.1',
        systemMode: 'DEV',
        status: 'SIMULATION',
      });
      
      await service.addEvent('BTC', 'GENERATED', 'SYSTEM', { reason: 'Initial state created' });
      await service.addEvent('SPX', 'GENERATED', 'SYSTEM', { reason: 'Initial state created' });
      
      return { ok: true, data: { btc: btcState, spx: spxState } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // STATUS ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/lifecycle/:modelId/status
  app.get<{
    Params: { modelId: ModelId };
  }>('/api/lifecycle/:modelId/status', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const state = await service.getState(modelId);
      
      if (!state) {
        return reply.code(404).send({
          ok: false,
          error: `Model ${modelId} not found in lifecycle`,
        });
      }
      
      return { ok: true, data: state };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // GET /api/lifecycle/all
  app.get('/api/lifecycle/all', async (req, reply) => {
    try {
      const states = await service.getAllStates();
      return { ok: true, data: states };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // GET /api/lifecycle/combined-readiness
  app.get('/api/lifecycle/combined-readiness', async (req, reply) => {
    try {
      const result = await service.getCombinedReadiness();
      return { ok: true, data: result };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // TRANSITION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/lifecycle/:modelId/propose
  app.post<{
    Params: { modelId: ModelId };
  }>('/api/lifecycle/:modelId/propose', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const result = await service.transition(modelId, 'PROPOSED', 'WARMUP_START', 'ADMIN');
      
      if (!result.success) {
        return reply.code(400).send({ ok: false, error: result.error });
      }
      
      return { ok: true, data: result.state };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/:modelId/start-warmup
  app.post<{
    Params: { modelId: ModelId };
  }>('/api/lifecycle/:modelId/start-warmup', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const result = await service.startWarmup(modelId);
      
      if (!result.success) {
        return reply.code(400).send({ ok: false, error: result.error });
      }
      
      const state = await service.getState(modelId);
      return { ok: true, data: state };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/:modelId/force-apply
  app.post<{
    Params: { modelId: ModelId };
    Body: { note?: string };
  }>('/api/lifecycle/:modelId/force-apply', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const { note } = req.body || {};
      
      const result = await service.forceApply(modelId, note);
      
      if (!result.success) {
        return reply.code(400).send({ ok: false, error: result.error });
      }
      
      const state = await service.getState(modelId);
      return { ok: true, data: state };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/:modelId/force-revoke
  app.post<{
    Params: { modelId: ModelId };
    Body: { note?: string };
  }>('/api/lifecycle/:modelId/force-revoke', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const { note } = req.body || {};
      
      const result = await service.forceRevoke(modelId, note);
      
      if (!result.success) {
        return reply.code(400).send({ ok: false, error: result.error });
      }
      
      const state = await service.getState(modelId);
      return { ok: true, data: state };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // VALIDATION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/lifecycle/:modelId/validate
  app.post<{
    Params: { modelId: ModelId };
  }>('/api/lifecycle/:modelId/validate', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const result = await service.validateForPromotion(modelId);
      return { ok: true, data: result };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // POST /api/lifecycle/:modelId/check-promote
  app.post<{
    Params: { modelId: ModelId };
  }>('/api/lifecycle/:modelId/check-promote', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const result = await service.checkAndPromote(modelId);
      const state = await service.getState(modelId);
      return { ok: true, data: { ...result, state } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // EVENTS ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/lifecycle/:modelId/events
  app.get<{
    Params: { modelId: ModelId };
    Querystring: { limit?: string };
  }>('/api/lifecycle/:modelId/events', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const limit = parseInt(req.query.limit || '50', 10);
      
      const events = await service.getRecentEvents(modelId, limit);
      return { ok: true, data: events };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // DEV MODE ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/lifecycle/:modelId/simulate (DEV only)
  app.post<{
    Params: { modelId: ModelId };
    Body: { status: LifecycleStatus };
  }>('/api/lifecycle/:modelId/simulate', async (req, reply) => {
    try {
      const { modelId } = req.params;
      const { status } = req.body;
      
      const state = await service.simulateStatus(modelId, status);
      return { ok: true, data: state };
    } catch (err: any) {
      return reply.code(400).send({ ok: false, error: err.message });
    }
  });
  
  console.log('[Lifecycle] Routes registered at /api/lifecycle/*');
}

export default registerLifecycleRoutes;
