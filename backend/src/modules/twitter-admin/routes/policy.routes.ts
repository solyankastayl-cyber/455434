/**
 * A.3.3 - Policy Routes
 * 
 * Admin endpoints for policy management:
 * - Global policy CRUD
 * - User overrides management
 * - Policy evaluation
 * - Violation logs
 */

import type { FastifyInstance } from 'fastify';
import { requireAdmin, getRequestAdmin } from '../auth/require-admin.hook.js';
import { TwitterPolicyService } from '../services/policy.service.js';
import { PolicyEvaluatorService } from '../services/policy-evaluator.service.js';
import { PolicyViolationLogModel } from '../models/policy-violation-log.model.js';

export async function registerPolicyRoutes(app: FastifyInstance) {
  const policyService = new TwitterPolicyService();
  const evaluator = new PolicyEvaluatorService();
  
  // Admin auth is already applied by parent (admin.routes.ts)
  console.log('[BOOT] Registering policy routes');
  
  // ============================================
  // Global Policy
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/policies/global
   * Get global policy settings
   */
  app.get('/api/v4/admin/twitter/policies/global', async (req, reply) => {
    try {
      const policy = await policyService.getGlobalPolicy();
      
      return reply.send({
        ok: true,
        data: {
          id: policy._id.toString(),
          scope: policy.scope,
          limits: policy.limits,
          actions: policy.actions,
          enabled: policy.enabled,
          updatedAt: policy.updatedAt,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get global policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * PUT /api/v4/admin/twitter/policies/global
   * Update global policy settings
   */
  app.put('/api/v4/admin/twitter/policies/global', async (req, reply) => {
    try {
      const body = req.body as {
        maxAccounts?: number;
        maxTasksPerHour?: number;
        maxPostsPerDay?: number;
        maxAbortRatePct?: number;
        actions?: {
          onLimitExceeded?: 'WARN' | 'COOLDOWN' | 'DISABLE';
          cooldownMinutes?: number;
        };
        enabled?: boolean;
      };
      
      const policy = await policyService.updateGlobalPolicy(body);
      
      return reply.send({
        ok: true,
        data: {
          id: policy._id.toString(),
          scope: policy.scope,
          limits: policy.limits,
          actions: policy.actions,
          enabled: policy.enabled,
          updatedAt: policy.updatedAt,
        },
        message: 'Global policy updated',
      });
    } catch (err: any) {
      app.log.error(err, 'Update global policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // User Overrides
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/policies/overrides
   * List all user policy overrides
   */
  app.get('/api/v4/admin/twitter/policies/overrides', async (req, reply) => {
    try {
      const overrides = await policyService.getAllUserOverrides();
      
      return reply.send({
        ok: true,
        data: overrides.map(o => ({
          id: o._id.toString(),
          userId: o.userId,
          limits: o.limits,
          actions: o.actions,
          enabled: o.enabled,
          updatedAt: o.updatedAt,
        })),
      });
    } catch (err: any) {
      app.log.error(err, 'Get overrides error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/policies/users/:userId
   * Get effective policy for a user
   */
  app.get('/api/v4/admin/twitter/policies/users/:userId', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const effective = await policyService.getEffectivePolicy(userId);
      const override = await policyService.getUserOverride(userId);
      
      return reply.send({
        ok: true,
        data: {
          effective,
          hasOverride: !!override,
          override: override ? {
            id: override._id.toString(),
            limits: override.limits,
            actions: override.actions,
            enabled: override.enabled,
          } : null,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get user policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * PUT /api/v4/admin/twitter/policies/users/:userId
   * Set or update user policy override
   */
  app.put('/api/v4/admin/twitter/policies/users/:userId', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const body = req.body as {
        maxAccounts?: number;
        maxTasksPerHour?: number;
        maxPostsPerDay?: number;
        maxAbortRatePct?: number;
        actions?: {
          onLimitExceeded?: 'WARN' | 'COOLDOWN' | 'DISABLE';
          cooldownMinutes?: number;
        };
        enabled?: boolean;
      };
      
      const override = await policyService.setUserOverride(userId, body);
      
      return reply.send({
        ok: true,
        data: {
          id: override._id.toString(),
          userId: override.userId,
          limits: override.limits,
          actions: override.actions,
          enabled: override.enabled,
        },
        message: 'User policy override updated',
      });
    } catch (err: any) {
      app.log.error(err, 'Set user override error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * DELETE /api/v4/admin/twitter/policies/users/:userId
   * Remove user policy override (reset to global)
   */
  app.delete('/api/v4/admin/twitter/policies/users/:userId', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const removed = await policyService.removeUserOverride(userId);
      
      if (removed) {
        return reply.send({
          ok: true,
          message: 'User override removed, now using global policy',
        });
      } else {
        return reply.send({
          ok: false,
          error: 'NO_OVERRIDE',
          message: 'User has no policy override',
        });
      }
    } catch (err: any) {
      app.log.error(err, 'Remove user override error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Policy Evaluation
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/policies/evaluate/:userId
   * Evaluate user against policy (dry-run)
   */
  app.get('/api/v4/admin/twitter/policies/evaluate/:userId', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const evaluation = await evaluator.evaluate(userId);
      
      return reply.send({
        ok: true,
        data: evaluation,
      });
    } catch (err: any) {
      app.log.error(err, 'Evaluate policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * POST /api/v4/admin/twitter/policies/enforce/:userId
   * Manually enforce policy on a user
   */
  app.post('/api/v4/admin/twitter/policies/enforce/:userId', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const evaluation = await evaluator.evaluate(userId);
      
      if (evaluation.violations.length === 0) {
        return reply.send({
          ok: true,
          message: 'No violations detected, no action taken',
          data: evaluation,
        });
      }
      
      await evaluator.applyAction(evaluation);
      
      return reply.send({
        ok: true,
        message: `Policy enforced: ${evaluation.action}`,
        data: evaluation,
      });
    } catch (err: any) {
      app.log.error(err, 'Enforce policy error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  // ============================================
  // Violation Logs
  // ============================================
  
  /**
   * GET /api/v4/admin/twitter/policies/violations
   * Get all recent violations
   */
  app.get('/api/v4/admin/twitter/policies/violations', async (req, reply) => {
    try {
      const query = req.query as { limit?: string; userId?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      
      const filter: any = {};
      if (query.userId) filter.userId = query.userId;
      
      const violations = await PolicyViolationLogModel.find(
        filter,
        {},
        { sort: { createdAt: -1 }, limit }
      ).lean();
      
      return reply.send({
        ok: true,
        data: violations.map(v => ({
          id: v._id.toString(),
          userId: v.userId,
          type: v.violationType,
          currentValue: v.currentValue,
          limitValue: v.limitValue,
          action: v.actionTaken,
          cooldownUntil: v.cooldownUntil,
          metrics: v.metrics,
          notificationSent: v.notificationSent,
          createdAt: v.createdAt,
        })),
      });
    } catch (err: any) {
      app.log.error(err, 'Get violations error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/policies/users/:userId/violations
   * Get violations for a specific user
   */
  app.get('/api/v4/admin/twitter/policies/users/:userId/violations', async (req, reply) => {
    try {
      const { userId } = req.params as { userId: string };
      const violations = await evaluator.getRecentViolations(userId);
      
      return reply.send({
        ok: true,
        data: violations,
      });
    } catch (err: any) {
      app.log.error(err, 'Get user violations error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
