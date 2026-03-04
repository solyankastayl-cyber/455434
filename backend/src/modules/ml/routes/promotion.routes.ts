/**
 * STEP 3 — ML Promotion Routes
 * ============================
 * API endpoints for promotion execution, validation, and rollback.
 */

import { FastifyInstance } from 'fastify';
import {
  validatePreconditions,
  executePromotion,
  getMetaBrainLockdownState,
  getAuditLog,
  checkCooldown,
  createAuditRecord,
  PromotionRequest,
} from '../services/promotion.execution.service.js';
import {
  runValidationCheck,
  getValidationStatus,
} from '../services/post.promotion.validator.js';
import {
  executeRollback,
  checkAndTriggerRollback,
  RollbackReason,
} from '../services/auto.rollback.service.js';
import { runAcceleratedSimulation, generateMarkdownReport } from '../services/shadow.simulation.service.js';
import { getDb } from '../../../db/connection.js';

export async function registerPromotionRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // PRECONDITIONS
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/mlops/promotion/preconditions — Check preconditions
  fastify.get('/api/v10/mlops/promotion/preconditions', async () => {
    const preconditions = await validatePreconditions();
    return { ok: true, data: preconditions };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PROMOTION EXECUTION
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/mlops/promotion/execute — Execute promotion
  fastify.post<{
    Body: {
      targetModel: string;
      promotionMode?: 'ACTIVE_SAFE' | 'ACTIVE_FULL';
      applyScope?: 'confidence_only' | 'full';
      constraints?: {
        onlyLowerConfidence?: boolean;
        respectMacroBlocks?: boolean;
        liveDataOnly?: boolean;
      };
      reason?: string;
      bypassPreconditions?: boolean;
    };
  }>('/api/v10/mlops/promotion/execute', async (request) => {
    const {
      targetModel,
      promotionMode = 'ACTIVE_SAFE',
      applyScope = 'confidence_only',
      constraints = {},
      reason,
      bypassPreconditions = false,
    } = request.body || {};
    
    if (!targetModel) {
      return { ok: false, error: 'targetModel required' };
    }
    
    const promotionRequest: PromotionRequest = {
      targetModel,
      promotionMode,
      applyScope,
      constraints: {
        onlyLowerConfidence: constraints.onlyLowerConfidence ?? true,
        respectMacroBlocks: constraints.respectMacroBlocks ?? true,
        liveDataOnly: constraints.liveDataOnly ?? true,
      },
      reason,
    };
    
    const result = await executePromotion(promotionRequest, bypassPreconditions);
    
    return { ok: result.success, data: result };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/mlops/promotion/validate — Run validation check
  fastify.post<{
    Body: { promotionId?: string };
  }>('/api/v10/mlops/promotion/validate', async (request) => {
    const db = await getDb();
    
    // Get current promotion ID if not provided
    let promotionId = request.body?.promotionId;
    if (!promotionId) {
      const state = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
      promotionId = state?.promotionId;
    }
    
    if (!promotionId) {
      return { ok: false, error: 'No active promotion found' };
    }
    
    const result = await runValidationCheck(promotionId);
    
    // Check if rollback needed
    if (result.shouldRollback) {
      const rollbackResult = await executeRollback(
        result.rollbackReason?.includes('CRITICAL') ? 'CRITICAL_EVENT' : 'DEGRADED_STREAK',
        result.rollbackReason
      );
      
      return {
        ok: true,
        data: {
          validation: result,
          rollbackTriggered: true,
          rollback: rollbackResult,
        },
      };
    }
    
    return { ok: true, data: { validation: result, rollbackTriggered: false } };
  });
  
  // GET /api/v10/mlops/promotion/validation/status — Get validation status
  fastify.get<{
    Querystring: { promotionId?: string };
  }>('/api/v10/mlops/promotion/validation/status', async (request) => {
    const db = await getDb();
    
    let promotionId = request.query?.promotionId;
    if (!promotionId) {
      const state = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
      promotionId = state?.promotionId;
    }
    
    if (!promotionId) {
      return { ok: false, error: 'No active promotion found' };
    }
    
    const status = await getValidationStatus(promotionId);
    return { ok: true, data: status };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // ROLLBACK
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/mlops/promotion/rollback — Execute rollback
  fastify.post<{
    Body: {
      reason?: RollbackReason;
      details?: string;
    };
  }>('/api/v10/mlops/promotion/rollback', async (request) => {
    const reason = request.body?.reason || 'MANUAL';
    const details = request.body?.details || 'Manual rollback from API';
    
    const result = await executeRollback(reason, details);
    return { ok: result.success, data: result };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // LOCKDOWN
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/mlops/promotion/lockdown — Get lockdown state
  fastify.get('/api/v10/mlops/promotion/lockdown', async () => {
    const state = await getMetaBrainLockdownState();
    return { ok: true, data: state };
  });
  
  // POST /api/v10/mlops/promotion/confirm — Confirm promotion after 24h validation
  fastify.post<{
    Body: { promotionId?: string };
  }>('/api/v10/mlops/promotion/confirm', async (request) => {
    const db = await getDb();
    
    // Get current promotion
    const state = await db.collection('mlops_promotion_state').findOne({ _id: 'current' });
    const promotionId = request.body?.promotionId || state?.promotionId;
    
    if (!promotionId) {
      return { ok: false, error: 'No active promotion found' };
    }
    
    // Check validation window passed
    const validationWindowEnds = state?.validationWindowEndsAt;
    if (validationWindowEnds && new Date() < validationWindowEnds) {
      return { 
        ok: false, 
        error: `Validation window not complete. Ends at ${validationWindowEnds.toISOString()}` 
      };
    }
    
    // Check no rollback triggered
    const status = await getValidationStatus(promotionId);
    if (status.shouldRollback) {
      return { ok: false, error: 'Rollback pending, cannot confirm' };
    }
    
    // Update state to STABLE
    await db.collection('mlops_promotion_state').updateOne(
      { _id: 'current' },
      {
        $set: {
          status: 'STABLE',
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    
    // Create audit record
    await createAuditRecord({
      event: 'ML_PROMOTION_CONFIRMED',
      modelId: state?.activeModelId || 'unknown',
      promotionTime: new Date(),
      regime: 'N/A',
      healthWindow: '24h',
      violations: 0,
      metadata: {
        promotionId,
        validationPassed: true,
        checksCompleted: status.checksCompleted,
      },
    });
    
    return {
      ok: true,
      data: {
        promotionId,
        status: 'STABLE',
        confirmedAt: new Date(),
        message: 'ML cycle closed successfully',
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // COOLDOWN
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/mlops/promotion/cooldown — Check cooldown status
  fastify.get('/api/v10/mlops/promotion/cooldown', async () => {
    const status = await checkCooldown();
    return { ok: true, data: status };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // AUDIT
  // ═══════════════════════════════════════════════════════════════
  
  // GET /api/v10/mlops/promotion/audit — Get audit log
  fastify.get<{
    Querystring: { limit?: number };
  }>('/api/v10/mlops/promotion/audit', async (request) => {
    const limit = request.query?.limit || 50;
    const log = await getAuditLog(limit);
    return { ok: true, data: log };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // SIMULATION (for testing)
  // ═══════════════════════════════════════════════════════════════
  
  // POST /api/v10/mlops/promotion/simulate — Run full promotion simulation
  fastify.post<{
    Body: {
      decisions?: number;
      durationHours?: number;
      autoPromote?: boolean;
    };
  }>('/api/v10/mlops/promotion/simulate', async (request) => {
    const { decisions = 500, durationHours = 72, autoPromote = false } = request.body || {};
    
    // Run shadow simulation
    const simulation = await runAcceleratedSimulation(decisions, durationHours);
    const report = generateMarkdownReport(simulation);
    
    // Store report
    const db = await getDb();
    await db.collection('mlops_shadow_reports').insertOne({
      ...simulation,
      verdict: simulation.promotionDecision.verdict,
      report,
      createdAt: new Date(),
    });
    
    // Auto-promote if enabled and verdict is PROMOTE
    if (autoPromote && simulation.promotionDecision.verdict === 'PROMOTE') {
      const promotionResult = await executePromotion({
        targetModel: `shadow_${Date.now()}`,
        promotionMode: 'ACTIVE_SAFE',
        applyScope: 'confidence_only',
        constraints: {
          onlyLowerConfidence: true,
          respectMacroBlocks: true,
          liveDataOnly: true,
        },
        reason: 'Auto-promoted from simulation',
      }, true);
      
      return {
        ok: true,
        data: {
          simulation: {
            verdict: simulation.promotionDecision.verdict,
            calibration: simulation.performanceMetrics.calibration,
            consistency: simulation.decisionConsistency,
          },
          autoPromoted: true,
          promotion: promotionResult,
        },
      };
    }
    
    return {
      ok: true,
      data: {
        simulation: {
          verdict: simulation.promotionDecision.verdict,
          calibration: simulation.performanceMetrics.calibration,
          consistency: simulation.decisionConsistency,
          compliance: simulation.macroCompliance,
        },
        autoPromoted: false,
        reportAvailable: true,
      },
    };
  });
  
  console.log('[STEP 3] ML Promotion Routes registered');
}
